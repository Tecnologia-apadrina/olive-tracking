const express = require('express');
const router = express.Router();
const db = require('../db');
const { resolveRequestCountry } = require('../utils/country');

const requireAuth = (req, res, next) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  next();
};
const requireAdmin = (req, res, next) => {
  if (!req.userId || req.userRole !== 'admin') return res.status(403).json({ error: 'Requiere admin' });
  next();
};

function parseNullableNumberInput(value, { integer = false, field = 'valor' } = {}) {
  if (value === undefined) {
    return { provided: false };
  }
  if (value === null || value === '') {
    return { provided: true, value: null };
  }
  const str = typeof value === 'string' ? value.trim() : String(value);
  if (str === '') {
    return { provided: true, value: null };
  }
  const normalized = str.replace(/\s+/g, '').replace(',', '.');
  const num = Number(normalized);
  if (!Number.isFinite(num)) {
    return { provided: true, error: `${field} inválido` };
  }
  if (integer && !Number.isInteger(num)) {
    return { provided: true, error: `${field} inválido` };
  }
  return { provided: true, value: num };
}

// Create a new parcela (auth required)
router.post('/parcelas', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  const countryCode = resolveRequestCountry(req);
  const { nombre, nombre_interno } = req.body || {};
  const pctParsed = parseNullableNumberInput(req.body?.porcentaje, { field: 'porcentaje' });
  if (pctParsed.error) {
    return res.status(400).json({ error: pctParsed.error });
  }
  const numOlivosParsed = parseNullableNumberInput(req.body?.num_olivos, { field: 'num_olivos', integer: true });
  if (numOlivosParsed.error) {
    return res.status(400).json({ error: numOlivosParsed.error });
  }
  const hectareasParsed = parseNullableNumberInput(req.body?.hectareas, { field: 'hectareas' });
  if (hectareasParsed.error) {
    return res.status(400).json({ error: hectareasParsed.error });
  }
  const parajeIdRaw = req.body?.paraje_id;
  if (parajeIdRaw !== undefined && parajeIdRaw !== null && parajeIdRaw !== '') {
    const parsed = Number(parajeIdRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return res.status(400).json({ error: 'paraje_id inválido' });
    }
  }
  const parajeId = parajeIdRaw === undefined || parajeIdRaw === null || parajeIdRaw === '' ? null : Number(parajeIdRaw);
  if (parajeId) {
    try {
      await db.public.one(
        'SELECT id FROM parajes WHERE id = $1 AND country_code = $2',
        [parajeId, countryCode]
      );
    } catch (_) {
      return res.status(400).json({ error: 'Paraje inexistente para este país' });
    }
  }
  if (!nombre) {
    return res.status(400).json({ error: 'nombre requerido' });
  }
  // Insert without id_usuario (deprecated)
  const inserted = await db.public.one(
    `INSERT INTO parcelas(
       nombre,
       nombre_interno,
       country_code,
       porcentaje,
       num_olivos,
       hectareas,
       paraje_id
     ) VALUES($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      nombre,
      nombre_interno ?? null,
      countryCode,
      pctParsed.provided ? pctParsed.value : null,
      numOlivosParsed.provided ? numOlivosParsed.value : null,
      hectareasParsed.provided ? hectareasParsed.value : null,
      parajeId,
    ]
  );
  const enriched = await db.public.one(
    `SELECT par.*, pj.nombre AS paraje_nombre
       FROM parcelas par
       LEFT JOIN parajes pj ON pj.id = par.paraje_id AND pj.country_code = par.country_code
      WHERE par.id = $1 AND par.country_code = $2`,
    [inserted.id, countryCode]
  );
  res.status(201).json(enriched);
});

// List parcelas (admin only)
router.get('/parcelas', requireAuth, requireAdmin, async (req, res) => {
  const countryCode = resolveRequestCountry(req);
  try {
    const rows = await db.public.many(
      `SELECT par.*, pj.nombre AS paraje_nombre
         FROM parcelas par
         LEFT JOIN parajes pj ON pj.id = par.paraje_id AND pj.country_code = par.country_code
        WHERE par.country_code = $1
        ORDER BY par.id`,
      [countryCode]
    );
    res.json(rows);
  } catch (e) {
    res.json([]);
  }
});

// Update parcela fields (admin only)
router.patch('/parcelas/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const numericId = Number(id);
  const countryCode = resolveRequestCountry(req);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return res.status(400).json({ error: 'id inválido' });
  }
  const pctParsed = parseNullableNumberInput(body.porcentaje, { field: 'porcentaje' });
  if (pctParsed.error) {
    return res.status(400).json({ error: pctParsed.error });
  }
  const numOlivosParsed = parseNullableNumberInput(body.num_olivos, { field: 'num_olivos', integer: true });
  if (numOlivosParsed.error) {
    return res.status(400).json({ error: numOlivosParsed.error });
  }
  const hectareasParsed = parseNullableNumberInput(body.hectareas, { field: 'hectareas' });
  if (hectareasParsed.error) {
    return res.status(400).json({ error: hectareasParsed.error });
  }
  const updates = [];
  const values = [];
  if (pctParsed.provided) {
    updates.push(`porcentaje = $${values.length + 1}`);
    values.push(pctParsed.value);
  }
  if (numOlivosParsed.provided) {
    updates.push(`num_olivos = $${values.length + 1}`);
    values.push(numOlivosParsed.value);
  }
  if (hectareasParsed.provided) {
    updates.push(`hectareas = $${values.length + 1}`);
    values.push(hectareasParsed.value);
  }
  if (body.paraje_id !== undefined) {
    const rawParaje = body.paraje_id;
    if (rawParaje === null || rawParaje === '') {
      updates.push(`paraje_id = $${values.length + 1}`);
      values.push(null);
    } else {
      const parsedParaje = Number(rawParaje);
      if (!Number.isInteger(parsedParaje) || parsedParaje <= 0) {
        return res.status(400).json({ error: 'paraje_id inválido' });
      }
      try {
        await db.public.one(
          'SELECT id FROM parajes WHERE id = $1 AND country_code = $2',
          [parsedParaje, countryCode]
        );
      } catch (_) {
        return res.status(400).json({ error: 'Paraje inexistente para este país' });
      }
      updates.push(`paraje_id = $${values.length + 1}`);
      values.push(parsedParaje);
    }
  }
  if (updates.length === 0) {
    return res.status(400).json({ error: 'Sin cambios' });
  }
  try {
    const idParamIndex = values.length + 1;
    const countryParamIndex = values.length + 2;
    const sql = `UPDATE parcelas SET ${updates.join(', ')} WHERE id = $${idParamIndex} AND country_code = $${countryParamIndex} RETURNING id`;
    await db.public.one(sql, [...values, numericId, countryCode]);
    const updated = await db.public.one(
      `SELECT par.*, pj.nombre AS paraje_nombre
         FROM parcelas par
         LEFT JOIN parajes pj ON pj.id = par.paraje_id AND pj.country_code = par.country_code
        WHERE par.id = $1 AND par.country_code = $2`,
      [numericId, countryCode]
    );
    res.json(updated);
  } catch (e) {
    res.status(404).json({ error: 'Parcela no encontrada' });
  }
});

// Delete parcela (admin only)
router.delete('/parcelas/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const rawForce = req.query.force;
  const numericId = Number(id);
  const countryCode = resolveRequestCountry(req);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return res.status(400).json({ error: 'id inválido' });
  }
  let relationCount = 0;
  try {
    const result = await db.public.one(
      'SELECT COUNT(*)::int AS count FROM parcelas_palots WHERE id_parcela = $1 AND country_code = $2',
      [numericId, countryCode]
    );
    relationCount = Number(result?.count ?? 0);
  } catch (_) {
    relationCount = 0;
  }
  const normalizedForce = typeof rawForce === 'string'
    ? ['1', 'true', 'si', 'sí', 'yes', 'y'].includes(rawForce.trim().toLowerCase())
    : false;
  if (relationCount > 0 && !normalizedForce) {
    return res.status(409).json({
      error: 'La parcela tiene relaciones con palots',
      relations: relationCount,
    });
  }
  try {
    // Remove dependent records before deleting the parcela to satisfy FK constraints.
    await db.public.none('DELETE FROM parcelas_palots WHERE id_parcela = $1 AND country_code = $2', [numericId, countryCode]);
    await db.public.none('DELETE FROM olivos WHERE id_parcela = $1 AND country_code = $2', [numericId, countryCode]);
    await db.public.one('DELETE FROM parcelas WHERE id = $1 AND country_code = $2 RETURNING id', [numericId, countryCode]);
    return res.status(204).end();
  } catch (e) {
    return res.status(404).json({ error: 'Parcela no encontrada' });
  }
});

module.exports = router;
