const express = require('express');
const router = express.Router();
const db = require('../db');
const { resolveRequestCountry } = require('../utils/country');

const normalizeEtiquetaIds = (value) => {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  const normalized = [];
  for (const item of arr) {
    const num = Number(item);
    if (Number.isInteger(num) && num > 0 && !normalized.includes(num)) {
      normalized.push(num);
    }
  }
  return normalized;
};

const fetchParcelTags = async (parcelaId, countryCode) => {
  if (!Number.isInteger(parcelaId)) return [];
  try {
    const rows = await db.public.many(
      `SELECT e.id, e.nombre
         FROM parcelas_etiquetas pe
         JOIN etiquetas e ON e.id = pe.id_etiqueta
        WHERE pe.id_parcela = $1
          AND e.country_code = $2
        ORDER BY e.nombre ASC`,
      [parcelaId, countryCode]
    );
    return rows;
  } catch (_) {
    return [];
  }
};

const setParcelTags = async (parcelaId, etiquetaIds, countryCode) => {
  if (!Number.isInteger(parcelaId)) return [];
  const ids = normalizeEtiquetaIds(etiquetaIds);
  if (!ids.length) {
    await db.public.none('DELETE FROM parcelas_etiquetas WHERE id_parcela = $1', [parcelaId]);
    return [];
  }
  const existing = await db.public.many(
    'SELECT id FROM etiquetas WHERE id = ANY($1::int[]) AND country_code = $2',
    [ids, countryCode]
  );
  const validIds = existing.map((row) => Number(row.id)).filter((id) => Number.isInteger(id));
  await db.public.none('DELETE FROM parcelas_etiquetas WHERE id_parcela = $1', [parcelaId]);
  if (validIds.length) {
    const values = validIds.map((_, idx) => `($1, $${idx + 2})`);
    await db.public.none(
      `INSERT INTO parcelas_etiquetas(id_parcela, id_etiqueta)
       VALUES ${values.join(', ')}
       ON CONFLICT DO NOTHING`,
      [parcelaId, ...validIds]
    );
  }
  return fetchParcelTags(parcelaId, countryCode);
};

const fetchRelationWithDetails = async (relationId, countryCode) => {
  return db.public.one(
    `SELECT pp.id,
            par.id   AS parcela_id,
            COALESCE(op.name, par.nombre) AS parcela_nombre,
            par.sigpac_municipio,
            par.sigpac_poligono,
            par.sigpac_parcela,
            par.sigpac_recinto,
            par.variedad   AS parcela_variedad,
            COALESCE(op.contract_percentage, par.porcentaje) AS parcela_porcentaje,
            par.num_olivos AS parcela_num_olivos,
            par.hectareas  AS parcela_hectareas,
            COALESCE(op.common_name, par.nombre_interno) AS parcela_nombre_interno,
            COALESCE(op.landscape_id, par.paraje_id) AS parcela_paraje_id,
            COALESCE(ols.name, pj.nombre) AS parcela_paraje_nombre,
            p.id     AS palot_id,
            p.codigo AS palot_codigo,
            p.procesado AS palot_procesado,
            pp.kgs   AS kgs,
            pp.reservado_aderezo AS reservado_aderezo,
            pp.notas AS notas,
            pp.id_usuario AS created_by,
            u.username AS created_by_username,
            pp.created_at AS created_at,
            COALESCE((
              SELECT json_agg(json_build_object('id', e.id, 'nombre', e.nombre) ORDER BY e.nombre)
                FROM parcelas_etiquetas pe
                JOIN etiquetas e ON e.id = pe.id_etiqueta AND e.country_code = par.country_code
               WHERE pe.id_parcela = par.id
            ), '[]'::json) AS parcela_etiquetas
       FROM parcelas_palots pp
       JOIN parcelas par ON par.id = pp.id_parcela AND par.country_code = pp.country_code
       LEFT JOIN odoo_parcelas op ON op.id = par.id AND op.country_code = par.country_code
       LEFT JOIN odoo_landscapes ols ON ols.id = COALESCE(op.landscape_id, par.paraje_id) AND ols.country_code = par.country_code
       LEFT JOIN parajes pj ON pj.id = par.paraje_id AND pj.country_code = par.country_code
       JOIN palots   p   ON p.id = pp.id_palot AND p.country_code = pp.country_code
       LEFT JOIN users  u ON u.id = pp.id_usuario
      WHERE pp.id = $1 AND pp.country_code = $2`,
    [relationId, countryCode]
  );
};

// Garantiza que la parcela existe en la tabla principal.
// Si no existe, intenta crear un stub a partir de odoo_parcelas o de los datos de fallback.
const ensureParcelaExists = async (parcelaId, countryCode, fallback = {}) => {
  if (!Number.isInteger(parcelaId) || parcelaId <= 0) return false;
  try {
    await db.public.one(
      'SELECT id FROM parcelas WHERE id = $1 AND country_code = $2',
      [parcelaId, countryCode]
    );
    return true;
  } catch (_) {}

  // Buscar en tabla odoo_parcelas
  let odooRow = null;
  try {
    const rows = await db.public.many(
      'SELECT id, name, common_name, contract_percentage, landscape_id FROM odoo_parcelas WHERE id = $1 AND country_code = $2 LIMIT 1',
      [parcelaId, countryCode]
    );
    odooRow = Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (_) {
    odooRow = null;
  }

  const nombre = (odooRow && odooRow.name) || fallback.nombre || null;
  const nombreInterno = (odooRow && odooRow.common_name) || fallback.nombre_interno || null;
  const porcentaje = odooRow && odooRow.contract_percentage != null
    ? Number(odooRow.contract_percentage)
    : (fallback.porcentaje != null ? fallback.porcentaje : null);
  const landscapeId = odooRow && odooRow.landscape_id != null ? Number(odooRow.landscape_id) : null;
  if (Number.isInteger(landscapeId) && landscapeId > 0) {
    try {
      const landscapeRow = await db.public.one(
        'SELECT name FROM odoo_landscapes WHERE id = $1 AND country_code = $2',
        [landscapeId, countryCode]
      );
      await db.public.none(
        `INSERT INTO parajes(id, nombre, country_code)
         VALUES($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, country_code = EXCLUDED.country_code`,
        [landscapeId, landscapeRow?.name || '', countryCode]
      );
    } catch (_) {
      // ignorar errores al persistir el paraje
    }
  }

  try {
    await db.public.none(
      `INSERT INTO parcelas(id, nombre, nombre_interno, porcentaje, paraje_id, country_code)
       VALUES($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         nombre = COALESCE(EXCLUDED.nombre, parcelas.nombre),
         nombre_interno = COALESCE(EXCLUDED.nombre_interno, parcelas.nombre_interno),
         porcentaje = COALESCE(EXCLUDED.porcentaje, parcelas.porcentaje),
         paraje_id = COALESCE(EXCLUDED.paraje_id, parcelas.paraje_id),
         country_code = EXCLUDED.country_code`,
      [parcelaId, nombre, nombreInterno, porcentaje, landscapeId ?? null, countryCode]
    );
  } catch (_) {
    // Ignorar errores de inserción; volveremos a comprobar
  }

  try {
    await db.public.one(
      'SELECT id FROM parcelas WHERE id = $1 AND country_code = $2',
      [parcelaId, countryCode]
    );
    return true;
  } catch (_) {
    return false;
  }
};

const parseRequiredNumber = (value, field = 'valor') => {
  if (value === undefined || value === null) {
    return { error: `${field} requerido` };
  }
  const str = typeof value === 'string' ? value.trim() : String(value);
  if (str === '') {
    return { error: `${field} requerido` };
  }
  const normalized = str.replace(/\s+/g, '').replace(',', '.');
  const num = Number(normalized);
  if (!Number.isFinite(num)) {
    return { error: `${field} inválido` };
  }
  return { value: num };
};

const toBool = (value) => {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['1', 'true', 't', 'yes', 'si', 'sí', 'y'].includes(normalized);
  }
  return Boolean(value);
};

// Assign a palot to a parcela
router.post('/parcelas/:parcelaId/palots', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  const countryCode = resolveRequestCountry(req);
  const { parcelaId } = req.params;
  const { palot_id, kgs, reservado_aderezo, notas, etiquetas } = req.body || {};
  const parcelaNumericId = Number(parcelaId);
  if (!Number.isInteger(parcelaNumericId) || parcelaNumericId <= 0) {
    return res.status(400).json({ error: 'parcelaId inválido' });
  }
  if (!palot_id) {
    return res.status(400).json({ error: 'palot_id requerido' });
  }
  const parsedKgs = parseRequiredNumber(kgs, 'kgs');
  if (parsedKgs.error) {
    return res.status(400).json({ error: parsedKgs.error });
  }
  let palotNumericId = Number(palot_id);
  if (!Number.isInteger(palotNumericId) || palotNumericId <= 0) {
    return res.status(400).json({ error: 'palot_id inválido' });
  }
  const ensuredParcela = await ensureParcelaExists(parcelaNumericId, countryCode, {
    nombre: (req.body && req.body.parcela_nombre) || null,
    nombre_interno: (req.body && req.body.parcela_nombre_interno) || null,
    porcentaje: req.body && req.body.parcela_porcentaje != null ? req.body.parcela_porcentaje : null,
  });
  if (!ensuredParcela) {
    return res.status(404).json({ error: 'Parcela no encontrada' });
  }
  try {
    await db.public.one(
      'SELECT id FROM palots WHERE id = $1 AND country_code = $2',
      [palotNumericId, countryCode]
    );
  } catch (_) {
    return res.status(404).json({ error: 'Palot no encontrado' });
  }
  const userId = req.userId || null;
  const reservadoValue = toBool(reservado_aderezo);
  const result = await db.public.one(
    `INSERT INTO parcelas_palots(
       id_parcela,
       id_palot,
       id_usuario,
       kgs,
       reservado_aderezo,
       notas,
       country_code
     ) VALUES($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [parcelaNumericId, palotNumericId, userId, parsedKgs.value, reservadoValue, notas ?? null, countryCode]
  );
  let tags = [];
  if (etiquetas !== undefined) {
    try {
      tags = await setParcelTags(parcelaNumericId, etiquetas, countryCode);
    } catch (_) {
      // Silently ignore tag assignment errors but continue
      tags = [];
    }
  }
  let enriched;
  try {
    enriched = await fetchRelationWithDetails(result.id, countryCode);
  } catch (_) {
    enriched = { ...result, parcela_etiquetas: tags };
  }
  res.status(201).json({
    ...enriched,
    parcela_etiquetas: enriched.parcela_etiquetas != null ? enriched.parcela_etiquetas : tags,
  });
});

// List palots for a parcela
router.get('/parcelas/:parcelaId/palots', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  const { parcelaId } = req.params;
  const countryCode = resolveRequestCountry(req);
  const parcelaNumericId = Number(parcelaId);
  if (!Number.isInteger(parcelaNumericId) || parcelaNumericId <= 0) {
    return res.status(400).json({ error: 'parcelaId inválido' });
  }
  try {
    const rows = await db.public.many(
      `SELECT p.*
         FROM palots p
         JOIN parcelas_palots pp ON p.id = pp.id_palot
        WHERE pp.id_parcela = $1
          AND pp.country_code = $2
          AND p.country_code = $2
        ORDER BY p.id`,
      [parcelaNumericId, countryCode]
    );
    res.json(rows);
  } catch (e) {
    res.json([]);
  }
});

// Remove relation between parcela and palot
router.delete('/parcelas/:parcelaId/palots/:palotId', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  const { parcelaId, palotId } = req.params;
  const countryCode = resolveRequestCountry(req);
  const parcelaNumericId = Number(parcelaId);
  const palotNumericId = Number(palotId);
  if (!Number.isInteger(parcelaNumericId) || !Number.isInteger(palotNumericId)) {
    return res.status(400).json({ error: 'IDs inválidos' });
  }
  await db.public.none(
    'DELETE FROM parcelas_palots WHERE id_parcela = $1 AND id_palot = $2 AND country_code = $3',
    [parcelaNumericId, palotNumericId, countryCode]
  );
  res.status(204).end();
});

// List all parcela–palot relations
router.get('/parcelas-palots', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  const countryCode = resolveRequestCountry(req);
  try {
    const rows = await db.public.many(
      `SELECT pp.id,
              par.id   AS parcela_id,
              COALESCE(op.name, par.nombre) AS parcela_nombre,
              par.sigpac_municipio,
              par.sigpac_poligono,
              par.sigpac_parcela,
              par.sigpac_recinto,
              par.variedad   AS parcela_variedad,
              COALESCE(op.contract_percentage, par.porcentaje) AS parcela_porcentaje,
              par.num_olivos AS parcela_num_olivos,
              par.hectareas AS parcela_hectareas,
              COALESCE(op.common_name, par.nombre_interno) AS parcela_nombre_interno,
              COALESCE(op.landscape_id, par.paraje_id) AS parcela_paraje_id,
              COALESCE(ols.name, pj.nombre) AS parcela_paraje_nombre,
              p.id     AS palot_id,
              p.codigo AS palot_codigo,
              p.procesado AS palot_procesado,
              pp.kgs   AS kgs,
              pp.reservado_aderezo AS reservado_aderezo,
              pp.notas AS notas,
              pp.id_usuario AS created_by,
              u.username AS created_by_username,
              pp.created_at AS created_at,
              COALESCE((
                SELECT json_agg(json_build_object('id', e.id, 'nombre', e.nombre) ORDER BY e.nombre)
                  FROM parcelas_etiquetas pe
                  JOIN etiquetas e ON e.id = pe.id_etiqueta
                 WHERE pe.id_parcela = par.id
              ), '[]'::json) AS parcela_etiquetas
         FROM parcelas_palots pp
         JOIN parcelas par ON par.id = pp.id_parcela AND par.country_code = pp.country_code
         LEFT JOIN odoo_parcelas op ON op.id = par.id AND op.country_code = par.country_code
         LEFT JOIN odoo_landscapes ols ON ols.id = COALESCE(op.landscape_id, par.paraje_id) AND ols.country_code = par.country_code
         LEFT JOIN parajes pj ON pj.id = par.paraje_id AND pj.country_code = par.country_code
         JOIN palots   p   ON p.id = pp.id_palot AND p.country_code = pp.country_code
         LEFT JOIN users  u ON u.id = pp.id_usuario
        WHERE pp.country_code = $1
        ORDER BY pp.created_at DESC NULLS LAST, pp.id DESC`,
      [countryCode]
    );
    res.json(rows);
  } catch (e) {
    res.json([]);
  }
});

// Update relation attributes (e.g., kgs)
router.patch('/parcelas-palots/:id', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  const { id } = req.params;
  const { kgs, reservado_aderezo, notas, etiquetas } = req.body || {};
  const countryCode = resolveRequestCountry(req);
  const relationId = Number(id);
  if (!Number.isInteger(relationId) || relationId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const fields = [];
  const params = [];
  let idx = 1;

  if (kgs !== undefined) {
    const parsed = parseRequiredNumber(kgs, 'kgs');
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    fields.push(`kgs = $${idx++}`);
    params.push(parsed.value);
  }

  if (reservado_aderezo !== undefined) {
    fields.push(`reservado_aderezo = $${idx++}`);
    params.push(toBool(reservado_aderezo));
  }

  if (notas !== undefined) {
    fields.push(`notas = $${idx++}`);
    params.push(notas === null ? null : String(notas));
  }

  const etiquetasProvided = etiquetas !== undefined;

  if (!fields.length && !etiquetasProvided) {
    return res.status(400).json({ error: 'Sin cambios' });
  }

  try {
    let updated;
    if (fields.length) {
      params.push(relationId);
      params.push(countryCode);
      await db.public.one(
        `UPDATE parcelas_palots
            SET ${fields.join(', ')}
          WHERE id = $${idx} AND country_code = $${idx + 1}
          RETURNING id`,
        params
      );
    }
    updated = await fetchRelationWithDetails(relationId, countryCode);
    const rawParcelaId = Number(updated?.parcela_id);
    const parcelaId = Number.isInteger(rawParcelaId) ? rawParcelaId : null;
    let tags = [];
    if (etiquetasProvided && parcelaId !== null) {
      try {
        tags = await setParcelTags(parcelaId, etiquetas, countryCode);
      } catch (_) {
        tags = await fetchParcelTags(parcelaId, countryCode);
      }
    } else if (parcelaId !== null) {
      tags = await fetchParcelTags(parcelaId, countryCode);
    }
    res.json({
      ...updated,
      parcela_etiquetas: tags,
    });
  } catch (e) {
    res.status(404).json({ error: 'Relación no encontrada' });
  }
});

module.exports = router;
