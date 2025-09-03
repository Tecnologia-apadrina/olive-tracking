const express = require('express');
const router = express.Router();
const db = require('../db');

// Assign a palot to a parcela
router.post('/parcelas/:parcelaId/palots', async (req, res) => {
  const { parcelaId } = req.params;
  const { palot_id } = req.body;
  if (!palot_id) {
    return res.status(400).json({ error: 'palot_id requerido' });
  }
  const userId = req.userId || null;
  const result = await db.public.one(
    'INSERT INTO parcelas_palots(id_parcela, id_palot, id_usuario) VALUES($1, $2, $3) RETURNING *',
    [parcelaId, palot_id, userId]
  );
  res.status(201).json(result);
});

// List palots for a parcela
router.get('/parcelas/:parcelaId/palots', async (req, res) => {
  const { parcelaId } = req.params;
  try {
    const rows = await db.public.many(
      'SELECT p.* FROM palots p JOIN parcelas_palots pp ON p.id = pp.id_palot WHERE pp.id_parcela = $1',
      [parcelaId]
    );
    res.json(rows);
  } catch (e) {
    res.json([]);
  }
});

// Remove relation between parcela and palot
router.delete('/parcelas/:parcelaId/palots/:palotId', async (req, res) => {
  const { parcelaId, palotId } = req.params;
  await db.public.none(
    'DELETE FROM parcelas_palots WHERE id_parcela = $1 AND id_palot = $2',
    [parcelaId, palotId]
  );
  res.status(204).end();
});

// List all parcela–palot relations
router.get('/parcelas-palots', async (_req, res) => {
  try {
    const rows = await db.public.many(
      `SELECT pp.id,
              par.id   AS parcela_id,
              par.nombre AS parcela_nombre,
              par.sigpac_municipio,
              par.sigpac_poligono,
              par.sigpac_parcela,
              par.sigpac_recinto,
              par.variedad   AS parcela_variedad,
              p.id     AS palot_id,
              p.codigo AS palot_codigo
         FROM parcelas_palots pp
         JOIN parcelas par ON par.id = pp.id_parcela
         JOIN palots   p   ON p.id = pp.id_palot
        ORDER BY par.nombre NULLS LAST, p.codigo NULLS LAST`
    );
    res.json(rows);
  } catch (e) {
    res.json([]);
  }
});

module.exports = router;
