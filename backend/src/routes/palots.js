const express = require('express');
const router = express.Router();
const db = require('../db');

// List all palots
router.get('/palots', async (req, res) => {
  try {
    const palots = await db.public.many('SELECT * FROM palots');
    res.json(palots);
  } catch (e) {
    res.json([]);
  }
});

// Create a new palot
router.post('/palots', async (req, res) => {
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

module.exports = router;
