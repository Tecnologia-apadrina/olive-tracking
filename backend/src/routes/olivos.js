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

// Create a new olivo
router.post('/olivos', async (req, res) => {
  const { id_parcela } = req.body || {};
  const countryCode = resolveRequestCountry(req);
  if (!id_parcela) {
    return res.status(400).json({ error: 'id_parcela requerido' });
  }
  try {
    // Ensure parcela exists
    await db.public.one(
      'SELECT id FROM parcelas WHERE id = $1 AND country_code = $2',
      [id_parcela, countryCode]
    );
  } catch (e) {
    return res.status(400).json({ error: 'Parcela inexistente' });
  }
  const row = await db.public.one(
    'INSERT INTO olivos(id_parcela, country_code) VALUES($1, $2) RETURNING *',
    [id_parcela, countryCode]
  );
  res.status(201).json(row);
});

// List all olivos (admin only)
router.get('/olivos', requireAuth, requireAdmin, async (req, res) => {
  const countryCode = resolveRequestCountry(req);
  try {
    const rows = await db.public.many(
      'SELECT * FROM olivos WHERE country_code = $1 ORDER BY id',
      [countryCode]
    );
    res.json(rows);
  } catch (e) {
    res.json([]);
  }
});

// Get parcela info for a given olivo id
// Returns: { id, nombre, porcentaje } for the parcela
router.get('/olivos/:olivoId/parcela', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  const { olivoId } = req.params;
  const countryCode = resolveRequestCountry(req);
  try {
    const parcela = await db.public.one(
      `SELECT par.id, par.nombre, par.porcentaje
         FROM parcelas par
         JOIN olivos o ON o.id_parcela = par.id
        WHERE o.id = $1 AND o.country_code = $2 AND par.country_code = $2`,
      [olivoId, countryCode]
    );
    res.json(parcela);
  } catch (e) {
    return res.status(404).json({ error: 'Olivo o parcela no encontrada' });
  }
});

module.exports = router;
 
