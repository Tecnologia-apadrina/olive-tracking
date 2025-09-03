const express = require('express');
const router = express.Router();
const db = require('../db');

// Assign a palot to a parcela
router.post('/parcelas/:parcelaId/palots', (req, res) => {
  const { parcelaId } = req.params;
  const { palot_id } = req.body;
  if (!palot_id) {
    return res.status(400).json({ error: 'palot_id requerido' });
  }
  const userId = req.userId || null;
  const result = db.public.one(
    'INSERT INTO parcelas_palots(id_parcela, id_palot, id_usuario) VALUES($1, $2, $3) RETURNING *',
    [parcelaId, palot_id, userId]
  );
  res.status(201).json(result);
});

// List palots for a parcela
router.get('/parcelas/:parcelaId/palots', (req, res) => {
  const { parcelaId } = req.params;
  let rows = [];
  try {
    rows = db.public.many(
      'SELECT p.* FROM palots p JOIN parcelas_palots pp ON p.id = pp.id_palot WHERE pp.id_parcela = $1',
      [parcelaId]
    );
  } catch (e) {
    rows = [];
  }
  res.json(rows);
});

// Remove relation between parcela and palot
router.delete('/parcelas/:parcelaId/palots/:palotId', (req, res) => {
  const { parcelaId, palotId } = req.params;
  db.public.none(
    'DELETE FROM parcelas_palots WHERE id_parcela = $1 AND id_palot = $2',
    [parcelaId, palotId]
  );
  res.status(204).end();
});

module.exports = router;
