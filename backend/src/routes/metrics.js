const express = require('express');
const router = express.Router();
const db = require('../db');

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

router.get('/metrics/harvest', requireAuth, requireAdminOrMetrics, async (req, res) => {
  try {
    const excludeIds = parseExcludeIds(req.query.exclude);
    const excludeParajeIds = parseExcludeIds(req.query.excludeParajes || req.query.exclude_parajes);

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
    const dailySql = `
      WITH daily_parcelas AS (
        SELECT
          pp.created_at::date AS harvest_date,
          pp.id_parcela,
          COALESCE(par.num_olivos, 0) AS num_olivos,
          COALESCE(SUM(pp.kgs), 0) AS kgs_parcela
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
    const perParcelaSql = `
      SELECT
        par.id,
        par.nombre,
        COALESCE(par.num_olivos, 0) AS num_olivos,
        COALESCE(SUM(pp.kgs), 0) AS total_kgs
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

    res.json({ totalParcelas, totalOlivos, byDay, perParcela, parcelOptions, parajeOptions });
  } catch (error) {
    console.error('Metrics harvest error', error);
    res.status(500).json({ error: 'No se pudieron obtener las métricas' });
  }
});

module.exports = router;
