const express = require('express');
const router = express.Router();
const db = require('../db');

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

const fetchActivityWithDetails = async (activityId) => {
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
       JOIN parcelas par ON par.id = pa.parcela_id
       LEFT JOIN parajes pj ON pj.id = par.paraje_id
       JOIN activity_types at ON at.id = pa.activity_type_id
       LEFT JOIN users u ON u.id = pa.created_by
      WHERE pa.id = $1`,
    [activityId]
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
    JOIN parcelas par ON par.id = pa.parcela_id
    LEFT JOIN parajes pj ON pj.id = par.paraje_id
    JOIN activity_types at ON at.id = pa.activity_type_id
    LEFT JOIN users u ON u.id = pa.created_by
`;

const buildListActivitiesQuery = (filters = {}) => {
  const conditions = [];
  const params = [];
  if (filters.parcelaId) {
    params.push(filters.parcelaId);
    conditions.push(`pa.parcela_id = $${params.length}`);
  }
  if (filters.olivoId) {
    params.push(filters.olivoId);
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
  try {
    const { sql, params } = buildListActivitiesQuery({
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
  try {
    const { sql, params } = buildListActivitiesQuery({ parcelaId, limit: 200 });
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

  if (!activityTypeId) {
    return res.status(400).json({ error: 'activity_type_id requerido' });
  }
  if (!olivoId) {
    return res.status(400).json({ error: 'olivo_id requerido' });
  }
  try {
    const type = await db.public.one('SELECT id FROM activity_types WHERE id = $1', [activityTypeId]);
    if (!type) throw new Error('Tipo no encontrado');
  } catch (error) {
    return res.status(400).json({ error: 'Tipo de actividad inexistente' });
  }
  let olivoRow;
  try {
    olivoRow = await db.public.one(
      `SELECT o.id, o.id_parcela, par.nombre
         FROM olivos o
         JOIN parcelas par ON par.id = o.id_parcela
        WHERE o.id = $1`,
      [olivoId]
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
      `INSERT INTO parcela_activities(parcela_id, olivo_id, activity_type_id, personas, notas, created_by)
       VALUES($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [parcelaId, olivoId, activityTypeId, personas > 0 ? personas : 1, notas, userId]
    );
    const activity = await fetchActivityWithDetails(inserted.id);
    res.status(201).json(activity);
  } catch (error) {
    res.status(500).json({ error: 'No se pudo registrar la actividad' });
  }
});

router.patch('/activities/:id', requireAuth, async (req, res) => {
  const activityId = parseInteger(req.params.id);
  if (!activityId) return res.status(400).json({ error: 'Actividad inválida' });
  const { activity_type_id, personas, notas } = req.body || {};
  const fields = [];
  const params = [];
  let idx = 1;

  if (activity_type_id !== undefined) {
    const typeId = parseInteger(activity_type_id);
    if (!typeId) return res.status(400).json({ error: 'Tipo de actividad inválido' });
    try {
      await db.public.one('SELECT id FROM activity_types WHERE id = $1', [typeId]);
    } catch (_) {
      return res.status(400).json({ error: 'Tipo de actividad inexistente' });
    }
    fields.push(`activity_type_id = $${idx++}`);
    params.push(typeId);
  }

  if (personas !== undefined) {
    const parsedPersonas = parseInteger(personas);
    if (!parsedPersonas || parsedPersonas < 1) return res.status(400).json({ error: 'Número de personas inválido' });
    fields.push(`personas = $${idx++}`);
    params.push(parsedPersonas);
  }

  if (notas !== undefined) {
    fields.push(`notas = $${idx++}`);
    params.push(normalizeNotes(notas));
  }

  if (!fields.length) {
    return res.status(400).json({ error: 'Sin cambios' });
  }

  try {
    params.push(activityId);
    const result = await db.public.result(
      `UPDATE parcela_activities SET ${fields.join(', ')} WHERE id = $${idx}`,
      params,
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Actividad no encontrada' });
    const updated = await fetchActivityWithDetails(activityId);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'No se pudo actualizar la actividad' });
  }
});

router.delete('/activities/:id', requireAuth, async (req, res) => {
  const activityId = parseInteger(req.params.id);
  if (!activityId) return res.status(400).json({ error: 'Actividad inválida' });
  try {
    const result = await db.public.result('DELETE FROM parcela_activities WHERE id = $1', [activityId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Actividad no encontrada' });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'No se pudo eliminar la actividad' });
  }
});

module.exports = router;
