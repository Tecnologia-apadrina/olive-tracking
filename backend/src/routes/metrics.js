const express = require('express');
const router = express.Router();
const db = require('../db');

const LOW_KGS_THRESHOLD = 300;
const DEFAULT_LOW_KGS_PERCENT = 100;
const MAX_LOW_KGS_PERCENT = 500;

const requireAuth = (req, res, next) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  next();
};

const requireAdminOrMetrics = (req, res, next) => {
  if (!req.userId || (req.userRole !== 'admin' && req.userRole !== 'metricas')) {
    return res.status(403).json({ error: 'Requiere admin o métricas' });
  }
  next();
};

const MUNICIPIO_LABELS = {
  '181': 'Oliete',
  '81': 'Oliete',
  '006': 'Alacón',
  '6': 'Alacón',
  '022': 'Ariño',
  '22': 'Ariño',
  '025': 'Andorra',
  '25': 'Andorra',
};

const parseExcludeIds = (raw) => {
  if (!raw) return [];
  const parts = Array.isArray(raw) ? raw : String(raw).split(',');
  const ids = [];
  for (const part of parts) {
    if (part === undefined || part === null) continue;
    const trimmed = String(part).trim();
    if (trimmed === '') continue;
    const num = Number(trimmed);
    if (Number.isInteger(num) && num > 0 && !ids.includes(num)) {
      ids.push(num);
    }
  }
  return ids;
};

const parseMunicipioCodes = (raw) => {
  if (!raw) return [];
  const parts = Array.isArray(raw) ? raw : String(raw).split(',');
  const codes = [];
  for (const part of parts) {
    if (part === undefined || part === null) continue;
    const trimmed = String(part).trim();
    if (trimmed === '') continue;
    if (!codes.includes(trimmed)) {
      codes.push(trimmed);
    }
  }
  return codes;
};

router.get('/metrics/harvest', requireAuth, requireAdminOrMetrics, async (req, res) => {
  try {
    const excludeIds = parseExcludeIds(req.query.exclude);
    const excludeParajeIds = parseExcludeIds(req.query.excludeParajes || req.query.exclude_parajes);
    const excludeMunicipios = parseMunicipioCodes(
      req.query.excludeMunicipios
      || req.query.exclude_municipios
      || req.query.municipios
      || req.query.municipio
    );

    const lowKgsPercentRaw = req.query.lowKgsPercent
      || req.query.low_kgs_percent
      || req.query.lowWeightPercent
      || req.query.low_weight_percent;
    const parsedPercent = Number(lowKgsPercentRaw);
    const normalizedPercent = Number.isFinite(parsedPercent) ? parsedPercent : DEFAULT_LOW_KGS_PERCENT;
    const clampedPercent = Math.min(Math.max(normalizedPercent, 0), MAX_LOW_KGS_PERCENT);
    const lowKgsFactor = clampedPercent / 100;

    const makeAdjustedKgsExpr = (params, column = 'pp.kgs') => {
      if (lowKgsFactor === 1) return column;
      params.push(lowKgsFactor);
      const placeholder = `$${params.length}`;
      return `CASE WHEN ${column} IS NULL THEN 0 WHEN ${column} < ${LOW_KGS_THRESHOLD} THEN ${column} * ${placeholder} ELSE ${column} END`;
    };

    const buildFilterClause = (alias) => {
      const clauses = [];
      const params = [];
      if (excludeIds.length) {
        params.push(excludeIds);
        clauses.push(`NOT (${alias}.id = ANY($${params.length}::int[]))`);
      }
      if (excludeParajeIds.length) {
        params.push(excludeParajeIds);
        clauses.push(`(${alias}.paraje_id IS NULL OR NOT (${alias}.paraje_id = ANY($${params.length}::int[])))`);
      }
      if (excludeMunicipios.length) {
        params.push(excludeMunicipios);
        clauses.push(`(${alias}.sigpac_municipio IS NULL OR NOT (${alias}.sigpac_municipio = ANY($${params.length}::text[])))`);
      }
      return {
        where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
        params,
      };
    };

    const totalFilter = buildFilterClause('par');
    const totalRow = await db.public.one(
      `SELECT COUNT(*)::int AS total FROM parcelas par ${totalFilter.where}`,
      totalFilter.params
    );
    const totalParcelas = Number(totalRow.total) || 0;

    const totalOlivosFilter = buildFilterClause('par');
    const totalOlivosRow = await db.public.one(
      `SELECT COALESCE(SUM(par.num_olivos), 0)::bigint AS total FROM parcelas par ${totalOlivosFilter.where}`,
      totalOlivosFilter.params
    );
    const totalOlivos = Number(totalOlivosRow.total) || 0;

    const dailyFilter = buildFilterClause('par');
    const adjustedDailyKgsExpr = makeAdjustedKgsExpr(dailyFilter.params);
    const dailySql = `
      WITH daily_parcelas AS (
        SELECT
          pp.created_at::date AS harvest_date,
          pp.id_parcela,
          COALESCE(par.num_olivos, 0) AS num_olivos,
          COALESCE(SUM(${adjustedDailyKgsExpr}), 0) AS kgs_parcela
        FROM parcelas_palots pp
        JOIN parcelas par ON par.id = pp.id_parcela
        ${dailyFilter.where}
        GROUP BY pp.created_at::date, pp.id_parcela, par.num_olivos
      )
      SELECT
        harvest_date,
        COUNT(*) AS parcelas_cosechadas,
        COALESCE(SUM(num_olivos), 0) AS olivos_cosechados,
        COALESCE(SUM(kgs_parcela), 0) AS kgs_cosechados
      FROM daily_parcelas
      GROUP BY harvest_date
      ORDER BY harvest_date DESC`;

    const rows = await db.public.many(dailySql, dailyFilter.params);

    const byDay = rows.map((row) => {
      const harvested = Number(row.parcelas_cosechadas) || 0;
      const olivos = Number(row.olivos_cosechados) || 0;
      const kgs = Number(row.kgs_cosechados) || 0;
      const avgOlivos = harvested > 0 ? olivos / harvested : 0;
      return {
        harvest_date: row.harvest_date,
        parcelas_cosechadas: harvested,
        olivos_cosechados: olivos,
        kgs_cosechados: kgs,
        avg_olivos_por_parcela: avgOlivos,
      };
    });

    const perParcelaFilter = buildFilterClause('par');
    const adjustedPerParcelaKgsExpr = makeAdjustedKgsExpr(perParcelaFilter.params);
    const perParcelaSql = `
      SELECT
        par.id,
        par.nombre,
        COALESCE(par.num_olivos, 0) AS num_olivos,
        COALESCE(SUM(${adjustedPerParcelaKgsExpr}), 0) AS total_kgs
      FROM parcelas par
      LEFT JOIN parcelas_palots pp ON pp.id_parcela = par.id
      ${perParcelaFilter.where}
      GROUP BY par.id, par.nombre, par.num_olivos
      ORDER BY par.nombre`;

    const parcelaRows = await db.public.many(perParcelaSql, perParcelaFilter.params);

    const perParcela = parcelaRows
      .map((row) => {
        const numOlivos = Number(row.num_olivos) || 0;
        const totalKgs = Number(row.total_kgs) || 0;
        if (totalKgs <= 0) return null;
        const avgKgsPorOlivo = numOlivos > 0 ? totalKgs / numOlivos : null;
        return {
          parcela_id: row.id,
          nombre: row.nombre || '',
          num_olivos: numOlivos,
          total_kgs: totalKgs,
          media_kgs_por_olivo: avgKgsPorOlivo,
        };
      })
      .filter(Boolean);

    const parcelOptionsRaw = await db.public.many('SELECT id, nombre FROM parcelas ORDER BY nombre');
    const parcelOptions = parcelOptionsRaw
      .map((row) => {
        const id = Number(row.id);
        if (!Number.isInteger(id) || id <= 0) return null;
        return { id, nombre: row.nombre || '' };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const nameCmp = String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' });
        if (nameCmp !== 0) return nameCmp;
        return a.id - b.id;
      });

    const parajeOptionsRaw = await db.public.many('SELECT id, nombre FROM parajes ORDER BY nombre');
    const parajeOptions = parajeOptionsRaw
      .map((row) => {
        const id = Number(row.id);
        if (!Number.isInteger(id) || id <= 0) return null;
        return { id, nombre: row.nombre || '' };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const nameCmp = String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' });
        if (nameCmp !== 0) return nameCmp;
        return a.id - b.id;
      });

    const municipioOptionsRaw = await db.public.many(
      `SELECT DISTINCT sigpac_municipio AS code
         FROM parcelas
        WHERE sigpac_municipio IS NOT NULL
          AND sigpac_municipio <> ''
        ORDER BY sigpac_municipio`
    );
    const municipioOptions = municipioOptionsRaw
      .map((row) => {
        const rawCode = row.code;
        if (rawCode === undefined || rawCode === null) return null;
        const code = String(rawCode).trim();
        if (!code) return null;
        const normalized = code.replace(/^0+/, '') || '0';
        const label = MUNICIPIO_LABELS[code]
          || MUNICIPIO_LABELS[normalized]
          || `Municipio ${code}`;
        return { code, nombre: label };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const nameCmp = String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' });
        if (nameCmp !== 0) return nameCmp;
        return String(a.code || '').localeCompare(String(b.code || ''));
      });

    res.json({
      totalParcelas,
      totalOlivos,
      byDay,
      perParcela,
      parcelOptions,
      parajeOptions,
      municipioOptions,
    });
  } catch (error) {
    console.error('Metrics harvest error', error);
    res.status(500).json({ error: 'No se pudieron obtener las métricas' });
  }
});

module.exports = router;
