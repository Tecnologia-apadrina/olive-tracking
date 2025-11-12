const express = require('express');
const router = express.Router();
const db = require('../db');
const { resolveRequestCountry } = require('../utils/country');

const requireAuth = (req, res, next) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  next();
};

const parseInteger = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.trunc(num);
};

const normalizeNotes = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length ? normalized : null;
};

const fetchActivityWithDetails = async (activityId, countryCode) => {
  return db.public.one(
    `SELECT pa.id,
            pa.parcela_id,
            par.nombre AS parcela_nombre,
            par.nombre_interno AS parcela_nombre_interno,
            par.sigpac_municipio,
            par.sigpac_poligono,
            par.sigpac_parcela,
            par.sigpac_recinto,
            par.paraje_id AS parcela_paraje_id,
            pj.nombre AS parcela_paraje_nombre,
            pa.olivo_id,
            pa.activity_type_id,
            at.nombre AS activity_type_nombre,
            at.icono AS activity_type_icono,
            pa.personas,
            pa.notas,
            pa.created_at,
            pa.created_by,
            u.username AS created_by_username
       FROM parcela_activities pa
       JOIN parcelas par ON par.id = pa.parcela_id AND par.country_code = pa.country_code
       LEFT JOIN parajes pj ON pj.id = par.paraje_id AND pj.country_code = par.country_code
       JOIN activity_types at ON at.id = pa.activity_type_id AND at.country_code = pa.country_code
       LEFT JOIN users u ON u.id = pa.created_by
      WHERE pa.id = $1 AND pa.country_code = $2`,
    [activityId, countryCode]
  );
};

const listActivitiesQueryBase = `
  SELECT pa.id,
         pa.parcela_id,
         par.nombre AS parcela_nombre,
         par.nombre_interno AS parcela_nombre_interno,
         par.sigpac_municipio,
         par.sigpac_poligono,
         par.sigpac_parcela,
         par.sigpac_recinto,
         par.paraje_id AS parcela_paraje_id,
         pj.nombre AS parcela_paraje_nombre,
         pa.olivo_id,
         pa.activity_type_id,
         at.nombre AS activity_type_nombre,
         at.icono AS activity_type_icono,
         pa.personas,
         pa.notas,
         pa.created_at,
         pa.created_by,
         u.username AS created_by_username
    FROM parcela_activities pa
    JOIN parcelas par ON par.id = pa.parcela_id AND par.country_code = pa.country_code
    LEFT JOIN parajes pj ON pj.id = par.paraje_id AND pj.country_code = par.country_code
    JOIN activity_types at ON at.id = pa.activity_type_id AND at.country_code = pa.country_code
    LEFT JOIN users u ON u.id = pa.created_by
`;

const buildListActivitiesQuery = (filters = {}) => {
  const { countryCode, parcelaId, olivoId } = filters;
  if (!countryCode) throw new Error('countryCode requerido');
  const conditions = ['pa.country_code = $1'];
  const params = [countryCode];
  if (parcelaId) {
    params.push(parcelaId);
    conditions.push(`pa.parcela_id = $${params.length}`);
  }
  if (olivoId) {
    params.push(olivoId);
    conditions.push(`pa.olivo_id = $${params.length}`);
  }
  let sql = listActivitiesQueryBase;
  if (conditions.length) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }
  sql += ' ORDER BY pa.created_at DESC, pa.id DESC';
  const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? Math.min(filters.limit, 200) : 100;
  params.push(limit);
  sql += ` LIMIT $${params.length}`;
  return { sql, params };
};

router.get('/activities', requireAuth, async (req, res) => {
  const parcelaId = parseInteger(req.query.parcelaId || req.query.parcela_id);
  const olivoId = parseInteger(req.query.olivoId || req.query.olivo_id);
  const limitRaw = parseInteger(req.query.limit);
  const countryCode = resolveRequestCountry(req);
  try {
    const { sql, params } = buildListActivitiesQuery({
      countryCode,
      parcelaId,
      olivoId,
      limit: limitRaw,
    });
    const rows = await db.public.many(sql, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'No se pudieron listar las actividades' });
  }
});

router.get('/parcelas/:parcelaId/activities', requireAuth, async (req, res) => {
  const parcelaId = parseInteger(req.params.parcelaId);
  if (!parcelaId) return res.status(400).json({ error: 'Parcela inválida' });
  const countryCode = resolveRequestCountry(req);
  try {
    const { sql, params } = buildListActivitiesQuery({
      countryCode,
      parcelaId,
      limit: 200,
    });
    const rows = await db.public.many(sql, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'No se pudieron listar las actividades de la parcela' });
  }
});

router.post('/activities', requireAuth, async (req, res) => {
  const body = req.body || {};
  const activityTypeId = parseInteger(body.activity_type_id);
  const olivoId = parseInteger(body.olivo_id);
  const personas = parseInteger(body.personas) || 1;
  const notas = normalizeNotes(body.notas);
  let parcelaId = parseInteger(body.parcela_id);
  const countryCode = resolveRequestCountry(req);

  if (!activityTypeId) {
    return res.status(400).json({ error: 'activity_type_id requerido' });
  }
  if (!olivoId) {
    return res.status(400).json({ error: 'olivo_id requerido' });
  }
  try {
    const type = await db.public.one(
      'SELECT id FROM activity_types WHERE id = $1 AND country_code = $2',
      [activityTypeId, countryCode]
    );
    if (!type) throw new Error('Tipo no encontrado');
  } catch (error) {
    return res.status(400).json({ error: 'Tipo de actividad inexistente' });
  }
  let olivoRow;
  try {
    olivoRow = await db.public.one(
      `SELECT o.id, o.id_parcela, par.nombre
         FROM olivos o
         JOIN parcelas par ON par.id = o.id_parcela AND par.country_code = o.country_code
        WHERE o.id = $1 AND o.country_code = $2`,
      [olivoId, countryCode]
    );
  } catch (error) {
    return res.status(400).json({ error: 'Olivo inexistente' });
  }
  if (!parcelaId) {
    parcelaId = olivoRow.id_parcela;
  }
  if (olivoRow.id_parcela !== parcelaId) {
    return res.status(400).json({ error: 'El olivo no pertenece a la parcela indicada' });
  }
  const userId = req.userId || null;
  try {
    const inserted = await db.public.one(
      `INSERT INTO parcela_activities(
         parcela_id,
         olivo_id,
         activity_type_id,
         personas,
         notas,
         created_by,
         country_code
       ) VALUES($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [parcelaId, olivoId, activityTypeId, personas > 0 ? personas : 1, notas, userId, countryCode]
    );
    const activity = await fetchActivityWithDetails(inserted.id, countryCode);
    res.status(201).json(activity);
  } catch (error) {
    res.status(500).json({ error: 'No se pudo registrar la actividad' });
  }
});

router.patch('/activities/:id', requireAuth, async (req, res) => {
  const activityId = parseInteger(req.params.id);
  if (!activityId) return res.status(400).json({ error: 'Actividad inválida' });
  const { activity_type_id, personas, notas } = req.body || {};
  const countryCode = resolveRequestCountry(req);
  const fields = [];
  const values = [];

  if (activity_type_id !== undefined) {
    const typeId = parseInteger(activity_type_id);
    if (!typeId) return res.status(400).json({ error: 'Tipo de actividad inválido' });
    try {
      await db.public.one(
        'SELECT id FROM activity_types WHERE id = $1 AND country_code = $2',
        [typeId, countryCode]
      );
    } catch (_) {
      return res.status(400).json({ error: 'Tipo de actividad inexistente' });
    }
    fields.push(`activity_type_id = $${values.length + 1}`);
    values.push(typeId);
  }

  if (personas !== undefined) {
    const parsedPersonas = parseInteger(personas);
    if (!parsedPersonas || parsedPersonas < 1) return res.status(400).json({ error: 'Número de personas inválido' });
    fields.push(`personas = $${values.length + 1}`);
    values.push(parsedPersonas);
  }

  if (notas !== undefined) {
    fields.push(`notas = $${values.length + 1}`);
    values.push(normalizeNotes(notas));
  }

  if (!fields.length) {
    return res.status(400).json({ error: 'Sin cambios' });
  }

  try {
    const idIdx = values.length + 1;
    const countryIdx = values.length + 2;
    const result = await db.public.result(
      `UPDATE parcela_activities
          SET ${fields.join(', ')}
        WHERE id = $${idIdx} AND country_code = $${countryIdx}`,
      [...values, activityId, countryCode],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Actividad no encontrada' });
    const updated = await fetchActivityWithDetails(activityId, countryCode);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'No se pudo actualizar la actividad' });
  }
});

router.delete('/activities/:id', requireAuth, async (req, res) => {
  const activityId = parseInteger(req.params.id);
  if (!activityId) return res.status(400).json({ error: 'Actividad inválida' });
  const countryCode = resolveRequestCountry(req);
  try {
    const result = await db.public.result(
      'DELETE FROM parcela_activities WHERE id = $1 AND country_code = $2',
      [activityId, countryCode]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Actividad no encontrada' });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'No se pudo eliminar la actividad' });
  }
});

module.exports = router;
