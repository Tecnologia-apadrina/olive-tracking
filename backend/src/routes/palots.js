const express = require('express');
const router = express.Router();
const db = require('../db');

// List all palots (auth required)
router.get('/palots', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  try {
    const palots = await db.public.many('SELECT * FROM palots');
    res.json(palots);
  } catch (e) {
    res.json([]);
  }
});

// Create a new palot (auth required)
router.post('/palots', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  const { codigo } = req.body;
  if (!codigo) {
    return res.status(400).json({ error: 'codigo requerido' });
  }
  const userId = req.userId || null;
  const result = await db.public.one(
    'INSERT INTO palots(codigo, id_usuario) VALUES($1, $2) RETURNING *',
    [codigo, userId]
  );
  res.status(201).json(result);
});

// Delete palot (admin suggested)
router.delete('/palots/:id', async (req, res) => {
  if (!req.userId || req.userRole !== 'admin') return res.status(403).json({ error: 'Requiere admin' });
  const { id } = req.params;
  // Remove relations first to satisfy FK
  await db.public.none('DELETE FROM parcelas_palots WHERE id_palot = $1', [id]);
  await db.public.none('DELETE FROM palots WHERE id = $1', [id]);
  res.status(204).end();
});

module.exports = router;
