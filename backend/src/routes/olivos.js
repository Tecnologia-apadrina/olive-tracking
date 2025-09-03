const express = require('express');
const router = express.Router();
const db = require('../db');

// Create a new olivo
router.post('/olivos', async (req, res) => {
  const { id_parcela, variedad } = req.body || {};
  if (!id_parcela) {
    return res.status(400).json({ error: 'id_parcela requerido' });
  }
  const userId = req.userId || null;
  try {
    // Ensure parcela exists
    await db.public.one('SELECT id FROM parcelas WHERE id = $1', [id_parcela]);
  } catch (e) {
    return res.status(400).json({ error: 'Parcela inexistente' });
  }
  const row = await db.public.one(
    'INSERT INTO olivos(id_parcela, variedad, id_usuario) VALUES($1, $2, $3) RETURNING *',
    [id_parcela, variedad || null, userId]
  );
  res.status(201).json(row);
});

// Get parcela info for a given olivo id
// Returns: { id, nombre } for the parcela
router.get('/olivos/:olivoId/parcela', async (req, res) => {
  const { olivoId } = req.params;
  try {
    const parcela = await db.public.one(
      'SELECT par.id, par.nombre FROM parcelas par JOIN olivos o ON o.id_parcela = par.id WHERE o.id = $1',
      [olivoId]
    );
    res.json(parcela);
  } catch (e) {
    return res.status(404).json({ error: 'Olivo o parcela no encontrada' });
  }
});

module.exports = router;
 
