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

// Create a new parcela (auth required)
router.post('/parcelas', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  const { nombre, nombre_interno, porcentaje } = req.body || {};
  if (!nombre) {
    return res.status(400).json({ error: 'nombre requerido' });
  }
  // Insert without id_usuario (deprecated)
  const row = await db.public.one(
    'INSERT INTO parcelas(nombre, nombre_interno, porcentaje) VALUES($1, $2, $3) RETURNING *',
    [nombre, nombre_interno ?? null, porcentaje ?? null]
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

module.exports = router;
