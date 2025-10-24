const express = require('express');
const router = express.Router();
const db = require('../db');

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
  if (!nombre) {
    return res.status(400).json({ error: 'nombre requerido' });
  }
  // Insert without id_usuario (deprecated)
  const row = await db.public.one(
    'INSERT INTO parcelas(nombre, nombre_interno, porcentaje, num_olivos, hectareas) VALUES($1, $2, $3, $4, $5) RETURNING *',
    [
      nombre,
      nombre_interno ?? null,
      pctParsed.provided ? pctParsed.value : null,
      numOlivosParsed.provided ? numOlivosParsed.value : null,
      hectareasParsed.provided ? hectareasParsed.value : null,
    ]
  );
  res.status(201).json(row);
});

// List parcelas (admin only)
router.get('/parcelas', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const rows = await db.public.many('SELECT * FROM parcelas ORDER BY id');
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
  const params = [numericId];
  if (pctParsed.provided) {
    updates.push(`porcentaje = $${params.length + 1}`);
    params.push(pctParsed.value);
  }
  if (numOlivosParsed.provided) {
    updates.push(`num_olivos = $${params.length + 1}`);
    params.push(numOlivosParsed.value);
  }
  if (hectareasParsed.provided) {
    updates.push(`hectareas = $${params.length + 1}`);
    params.push(hectareasParsed.value);
  }
  if (updates.length === 0) {
    return res.status(400).json({ error: 'Sin cambios' });
  }
  try {
    const row = await db.public.one(
      `UPDATE parcelas SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
      params
    );
    res.json(row);
  } catch (e) {
    res.status(404).json({ error: 'Parcela no encontrada' });
  }
});

module.exports = router;
