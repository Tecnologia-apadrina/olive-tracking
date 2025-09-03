const express = require('express');
const router = express.Router();
const db = require('../db');

// List all palots
router.get('/palots', (req, res) => {
  let palots = [];
  try {
    palots = db.public.many("SELECT * FROM palots");
  } catch (e) {
    palots = [];
  }
  res.json(palots);
});

// Create a new palot
router.post('/palots', (req, res) => {
  const { codigo } = req.body;
  if (!codigo) {
    return res.status(400).json({ error: 'codigo requerido' });
  }
  const userId = req.userId || null;
  const result = db.public.one(
    'INSERT INTO palots(codigo, id_usuario) VALUES($1, $2) RETURNING *',
    [codigo, userId]
  );
  res.status(201).json(result);
});

module.exports = router;
