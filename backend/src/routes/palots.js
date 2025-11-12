const express = require('express');
const router = express.Router();
const db = require('../db');
const { resolveRequestCountry } = require('../utils/country');

// List all palots (auth required)
router.get('/palots', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  const countryCode = resolveRequestCountry(req);
  try {
    const palots = await db.public.many(
      'SELECT * FROM palots WHERE country_code = $1 ORDER BY id',
      [countryCode]
    );
    res.json(palots);
  } catch (e) {
    res.json([]);
  }
});

// Create a new palot (auth required)
router.post('/palots', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  const countryCode = resolveRequestCountry(req);
  const { codigo } = req.body;
  if (!codigo) {
    return res.status(400).json({ error: 'codigo requerido' });
  }
  const userId = req.userId || null;
  const result = await db.public.one(
    'INSERT INTO palots(codigo, id_usuario, country_code) VALUES($1, $2, $3) RETURNING *',
    [codigo, userId, countryCode]
  );
  res.status(201).json(result);
});

// Update palot attributes (currently procesado)
router.patch('/palots/:id', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  if (!['admin', 'molino'].includes(req.userRole)) {
    return res.status(403).json({ error: 'Requiere permisos de molino o admin' });
  }
  const { id } = req.params;
  const countryCode = resolveRequestCountry(req);
  const { procesado } = req.body || {};
  if (procesado === undefined) {
    return res.status(400).json({ error: 'procesado requerido' });
  }
  const normalized = procesado === true || procesado === 'true' || procesado === 1 || procesado === '1';
  try {
    const result = await db.public.one(
      'UPDATE palots SET procesado = $2 WHERE id = $1 AND country_code = $3 RETURNING *',
      [id, normalized, countryCode]
    );
    res.json(result);
  } catch (e) {
    res.status(404).json({ error: 'Palot no encontrado' });
  }
});

// Delete palot (admin suggested)
router.delete('/palots/:id', async (req, res) => {
  if (!req.userId || req.userRole !== 'admin') return res.status(403).json({ error: 'Requiere admin' });
  const { id } = req.params;
  const countryCode = resolveRequestCountry(req);
  // Remove relations first to satisfy FK
  await db.public.none(
    'DELETE FROM parcelas_palots WHERE id_palot = $1 AND country_code = $2',
    [id, countryCode]
  );
  await db.public.one('DELETE FROM palots WHERE id = $1 AND country_code = $2 RETURNING id', [id, countryCode]);
  res.status(204).end();
});

module.exports = router;
