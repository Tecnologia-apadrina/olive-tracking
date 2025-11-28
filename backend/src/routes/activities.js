const express = require('express');
const router = express.Router();
const db = require('../db');
const { resolveRequestCountry } = require('../utils/country');

const requireAuth = (req, res, next) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  next();
};

const requireConserveraAccess = (req, res, next) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  if (!['admin', 'metricas', 'conservera'].includes(req.userRole)) {
    return res.status(403).json({ error: 'Requiere rol conservera' });
  }
  next();
};

const scopeForRole = (role) => {
  if (role === 'conservera') return 'conservera';
  if (role === 'campo') return 'campo';
  return null; // admin/metricas/others -> sin filtro
};

const mapConserveraActivity = (row) => ({
  id: row.id,
  activity_type_id: row.activity_type_id,
  activity_type_nombre: row.activity_type_nombre || '',
  activity_type_icono: row.activity_type_icono || '',
  started_at: row.started_at,
  finished_at: row.finished_at,
  duration_seconds: row.duration_seconds != null ? Number(row.duration_seconds) : null,
  created_by: row.created_by,
  created_by_username: row.created_by_username || null,
});

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
            COALESCE(op.name, par.nombre) AS parcela_nombre,
            COALESCE(op.common_name, par.nombre_interno) AS parcela_nombre_interno,
            par.sigpac_municipio,
            par.sigpac_poligono,
            par.sigpac_parcela,
            par.sigpac_recinto,
            COALESCE(op.landscape_id, par.paraje_id) AS parcela_paraje_id,
            COALESCE(ol.name, pj.nombre) AS parcela_paraje_nombre,
            pa.olivo_id,
            pa.activity_type_id,
            at.nombre AS activity_type_nombre,
            at.icono AS activity_type_icono,
            at.scope AS activity_type_scope,
            pa.personas,
            pa.notas,
            pa.created_at,
            pa.created_by,
            u.username AS created_by_username
       FROM parcela_activities pa
       JOIN parcelas par ON par.id = pa.parcela_id AND par.country_code = pa.country_code
       LEFT JOIN odoo_parcelas op ON op.id = par.id AND op.country_code = par.country_code
       LEFT JOIN odoo_landscapes ol ON ol.id = COALESCE(op.landscape_id, par.paraje_id) AND ol.country_code = par.country_code
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
         COALESCE(op.name, par.nombre) AS parcela_nombre,
         COALESCE(op.common_name, par.nombre_interno) AS parcela_nombre_interno,
         par.sigpac_municipio,
         par.sigpac_poligono,
         par.sigpac_parcela,
         par.sigpac_recinto,
         COALESCE(op.landscape_id, par.paraje_id) AS parcela_paraje_id,
         COALESCE(ol.name, pj.nombre) AS parcela_paraje_nombre,
         pa.olivo_id,
         pa.activity_type_id,
         at.nombre AS activity_type_nombre,
         at.icono AS activity_type_icono,
         at.scope AS activity_type_scope,
         pa.personas,
         pa.notas,
         pa.created_at,
         pa.created_by,
         u.username AS created_by_username
    FROM parcela_activities pa
    JOIN parcelas par ON par.id = pa.parcela_id AND par.country_code = pa.country_code
    LEFT JOIN odoo_parcelas op ON op.id = par.id AND op.country_code = par.country_code
    LEFT JOIN odoo_landscapes ol ON ol.id = COALESCE(op.landscape_id, par.paraje_id) AND ol.country_code = par.country_code
    LEFT JOIN parajes pj ON pj.id = par.paraje_id AND pj.country_code = par.country_code
    JOIN activity_types at ON at.id = pa.activity_type_id AND at.country_code = pa.country_code
    LEFT JOIN users u ON u.id = pa.created_by
`;

const buildListActivitiesQuery = (filters = {}) => {
  const { countryCode, parcelaId, olivoId, scope } = filters;
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
  if (scope) {
    params.push(scope);
    conditions.push(`at.scope = $${params.length}`);
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
  const scope = scopeForRole(req.userRole);
  try {
    const { sql, params } = buildListActivitiesQuery({
      countryCode,
      parcelaId,
      olivoId,
      scope,
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
  const scope = scopeForRole(req.userRole);
  try {
    const { sql, params } = buildListActivitiesQuery({
      countryCode,
      parcelaId,
      scope,
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
  const scope = scopeForRole(req.userRole);

  if (!activityTypeId) {
    return res.status(400).json({ error: 'activity_type_id requerido' });
  }
  if (!olivoId) {
    return res.status(400).json({ error: 'olivo_id requerido' });
  }
  try {
    const params = [activityTypeId, countryCode];
    let sql = 'SELECT id FROM activity_types WHERE id = $1 AND country_code = $2';
    if (scope) {
      params.push(scope);
      sql += ` AND scope = $${params.length}`;
    }
    const type = await db.public.one(sql, params);
    if (!type) throw new Error('Tipo no encontrado');
  } catch (error) {
    return res.status(400).json({ error: 'Tipo de actividad inexistente' });
  }
  let olivoRow;
  try {
    olivoRow = await db.public.one(
      `SELECT oo.id,
              COALESCE(oo.parcel_id, o.id_parcela) AS id_parcela
         FROM odoo_olivos oo
         LEFT JOIN olivos o ON o.id = oo.id AND o.country_code = $2
        WHERE oo.id = $1 AND oo.country_code = $2`,
      [olivoId, countryCode]
    ).catch(async () => db.public.one(
      `SELECT o.id, o.id_parcela
         FROM olivos o
        WHERE o.id = $1 AND o.country_code = $2`,
      [olivoId, countryCode]
    ));
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
  const scope = scopeForRole(req.userRole);
  const fields = [];
  const values = [];

  if (scope) {
    try {
      await db.public.one(
        `SELECT pa.id
           FROM parcela_activities pa
           JOIN activity_types at ON at.id = pa.activity_type_id AND at.country_code = pa.country_code
          WHERE pa.id = $1 AND pa.country_code = $2 AND at.scope = $3`,
        [activityId, countryCode, scope]
      );
    } catch (_) {
      return res.status(404).json({ error: 'Actividad no encontrada en tu ámbito' });
    }
  }

  if (activity_type_id !== undefined) {
    const typeId = parseInteger(activity_type_id);
    if (!typeId) return res.status(400).json({ error: 'Tipo de actividad inválido' });
    try {
      const params = [typeId, countryCode];
      let sql = 'SELECT id FROM activity_types WHERE id = $1 AND country_code = $2';
      if (scope) {
        params.push(scope);
        sql += ` AND scope = $${params.length}`;
      }
      await db.public.one(sql, params);
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
  const scope = scopeForRole(req.userRole);
  try {
    if (scope) {
      await db.public.one(
        `SELECT pa.id
           FROM parcela_activities pa
           JOIN activity_types at ON at.id = pa.activity_type_id AND at.country_code = pa.country_code
          WHERE pa.id = $1 AND pa.country_code = $2 AND at.scope = $3`,
        [activityId, countryCode, scope]
      );
    }
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

// --- Actividades conservera (scope específico) ---

router.get('/activities/conservera', requireConserveraAccess, async (req, res) => {
  const countryCode = resolveRequestCountry(req);
  try {
    const rows = await db.public.many(
      `SELECT ca.id,
              ca.activity_type_id,
              at.nombre AS activity_type_nombre,
              at.icono AS activity_type_icono,
              ca.started_at,
              ca.finished_at,
              ca.duration_seconds,
              ca.created_by,
              u.username AS created_by_username
         FROM conservera_activities ca
         JOIN activity_types at ON at.id = ca.activity_type_id AND at.country_code = ca.country_code
         LEFT JOIN users u ON u.id = ca.created_by
        WHERE ca.country_code = $1 AND at.scope = 'conservera'
        ORDER BY ca.started_at DESC
        LIMIT 200`,
      [countryCode]
    );
    res.json(rows.map(mapConserveraActivity));
  } catch (error) {
    res.status(500).json({ error: 'No se pudieron listar las actividades de conservera' });
  }
});

router.post('/activities/conservera/start', requireConserveraAccess, async (req, res) => {
  const countryCode = resolveRequestCountry(req);
  const typeId = parseInteger(req.body && req.body.activity_type_id);
  const userId = req.userId || null;
  if (!typeId) return res.status(400).json({ error: 'Tipo de actividad requerido' });
  try {
    await db.public.one(
      'SELECT id FROM activity_types WHERE id = $1 AND country_code = $2 AND scope = $3',
      [typeId, countryCode, 'conservera']
    );
  } catch (_) {
    return res.status(400).json({ error: 'Tipo de actividad de conservera inexistente' });
  }
  // Bloquea iniciar si el usuario ya tiene una actividad en curso
  if (userId) {
    const openRows = await db.public.many(
      `SELECT id FROM conservera_activities
        WHERE country_code = $1 AND created_by = $2 AND finished_at IS NULL
        LIMIT 1`,
      [countryCode, userId]
    );
    if (openRows && openRows[0]) {
      return res.status(400).json({ error: 'Tienes una actividad en curso. Finalízala antes de iniciar otra.' });
    }
  }
  try {
    const inserted = await db.public.one(
      `INSERT INTO conservera_activities(activity_type_id, created_by, country_code)
       VALUES($1, $2, $3)
       RETURNING id, activity_type_id, started_at, finished_at, duration_seconds, created_by`,
      [typeId, userId, countryCode]
    );
    const row = await db.public.one(
      `SELECT ca.id,
              ca.activity_type_id,
              at.nombre AS activity_type_nombre,
              at.icono AS activity_type_icono,
              ca.started_at,
              ca.finished_at,
              ca.duration_seconds,
              ca.created_by,
              u.username AS created_by_username
         FROM conservera_activities ca
         JOIN activity_types at ON at.id = ca.activity_type_id AND at.country_code = ca.country_code
         LEFT JOIN users u ON u.id = ca.created_by
        WHERE ca.id = $1 AND ca.country_code = $2`,
      [inserted.id, countryCode]
    );
    res.status(201).json(mapConserveraActivity(row));
  } catch (error) {
    res.status(500).json({ error: 'No se pudo iniciar la actividad de conservera' });
  }
});

router.post('/activities/conservera/:id/finish', requireConserveraAccess, async (req, res) => {
  const activityId = parseInteger(req.params.id);
  const countryCode = resolveRequestCountry(req);
  if (!activityId) return res.status(400).json({ error: 'Actividad inválida' });
  let existing;
  try {
    // Verifica que existe y pertenece al scope conservera
    existing = await db.public.one(
      `SELECT ca.id, ca.created_by
         FROM conservera_activities ca
         JOIN activity_types at ON at.id = ca.activity_type_id AND at.country_code = ca.country_code
        WHERE ca.id = $1 AND ca.country_code = $2 AND at.scope = 'conservera'`,
      [activityId, countryCode]
    );
  } catch (_) {
    return res.status(404).json({ error: 'Actividad de conservera no encontrada' });
  }
  // Sólo el creador o un admin puede finalizar
  if (req.userRole !== 'admin') {
    if (!existing || !existing.created_by || existing.created_by !== req.userId) {
      return res.status(403).json({ error: 'Solo el creador o un admin puede finalizar esta actividad' });
    }
  }
  try {
    const updated = await db.public.one(
      `UPDATE conservera_activities
          SET finished_at = now(),
              duration_seconds = CAST(EXTRACT(EPOCH FROM (now() - started_at)) AS INTEGER)
        WHERE id = $1 AND country_code = $2 AND finished_at IS NULL
        RETURNING id`,
      [activityId, countryCode]
    ).catch(() => null);
    if (!updated) return res.status(400).json({ error: 'La actividad ya estaba finalizada' });
    const row = await db.public.one(
      `SELECT ca.id,
              ca.activity_type_id,
              at.nombre AS activity_type_nombre,
              at.icono AS activity_type_icono,
              ca.started_at,
              ca.finished_at,
              ca.duration_seconds,
              ca.created_by,
              u.username AS created_by_username
         FROM conservera_activities ca
         JOIN activity_types at ON at.id = ca.activity_type_id AND at.country_code = ca.country_code
         LEFT JOIN users u ON u.id = ca.created_by
        WHERE ca.id = $1 AND ca.country_code = $2`,
      [activityId, countryCode]
    );
    res.json(mapConserveraActivity(row));
  } catch (error) {
    res.status(500).json({ error: 'No se pudo finalizar la actividad de conservera' });
  }
});

module.exports = router;
