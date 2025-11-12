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

router.get('/etiquetas', requireAuth, async (req, res) => {
  const countryCode = resolveRequestCountry(req);
  try {
    const rows = await db.public.many(
      'SELECT id, nombre FROM etiquetas WHERE country_code = $1 ORDER BY nombre ASC',
      [countryCode]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'No se pudieron listar las etiquetas' });
  }
});

router.post('/etiquetas', requireAuth, requireAdmin, async (req, res) => {
  const countryCode = resolveRequestCountry(req);
  const { nombre } = req.body || {};
  if (!nombre || !String(nombre).trim()) {
    return res.status(400).json({ error: 'nombre requerido' });
  }
  const value = String(nombre).trim();
  try {
    const row = await db.public.one(
      'INSERT INTO etiquetas(nombre, country_code) VALUES($1, $2) RETURNING id, nombre',
      [value, countryCode]
    );
    res.status(201).json(row);
  } catch (error) {
    if (error && error.message && error.message.includes('duplicate')) {
      res.status(409).json({ error: 'Etiqueta duplicada' });
      return;
    }
    res.status(500).json({ error: 'No se pudo crear la etiqueta' });
  }
});

router.delete('/etiquetas/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const countryCode = resolveRequestCountry(req);
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return res.status(400).json({ error: 'id inválido' });
  }
  try {
    await db.public.one('DELETE FROM etiquetas WHERE id = $1 AND country_code = $2 RETURNING id', [parsed, countryCode]);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'No se pudo eliminar la etiqueta' });
  }
});

module.exports = router;
