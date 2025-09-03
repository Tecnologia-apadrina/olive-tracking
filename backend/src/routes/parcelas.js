const express = require('express');
const router = express.Router();
const db = require('../db');

// Create a new parcela
router.post('/parcelas', async (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre) {
    return res.status(400).json({ error: 'nombre requerido' });
  }
  const userId = req.userId || null;
  const row = await db.public.one(
    'INSERT INTO parcelas(nombre, id_usuario) VALUES($1, $2) RETURNING *',
    [nombre, userId]
  );
  res.status(201).json(row);
});

module.exports = router;
