const express = require('express');
const router = express.Router();
const db = require('../db');
const { resolveRequestCountry } = require('../utils/country');

const requireAuth = (req, res, next) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.userId || req.userRole !== 'admin') {
    return res.status(403).json({ error: 'Requiere admin' });
  }
  next();
};

const normalizeName = (value) => (value == null ? '' : String(value).trim());

const findOrCreateParaje = async (nombre, { cache, countryCode }) => {
  const key = normalizeName(nombre).toLocaleLowerCase('es-ES');
  const cacheKey = `${key}::${countryCode}`;
  if (!key) return null;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const existing = await db.public.many(
    'SELECT id, nombre FROM parajes WHERE lower(nombre) = lower($1) AND country_code = $2',
    [nombre, countryCode]
  );
  if (existing.length > 0) {
    const row = existing[0];
    cache.set(cacheKey, row);
    return row;
  }
  const inserted = await db.public.one(
    'INSERT INTO parajes(nombre, country_code) VALUES($1, $2) RETURNING id, nombre',
    [nombre, countryCode]
  );
  cache.set(cacheKey, inserted);
  return inserted;
};

router.get('/parajes', requireAuth, requireAdmin, async (req, res) => {
  const countryCode = resolveRequestCountry(req);
  try {
    const rows = await db.public.many(
      `SELECT ol.id,
              ol.name AS nombre,
              COUNT(par.id)::int AS parcelas_count
         FROM odoo_landscapes ol
         LEFT JOIN parcelas par ON par.paraje_id = ol.id AND par.country_code = ol.country_code
        WHERE ol.country_code = $1
        GROUP BY ol.id, ol.name
        ORDER BY lower(ol.name)`,
      [countryCode]
    );
    if (rows.length > 0) {
      return res.json(rows);
    }
    const legacy = await db.public.many(
      `SELECT p.id,
              p.nombre,
              COUNT(pa.id)::int AS parcelas_count
         FROM parajes p
         LEFT JOIN parcelas pa ON pa.paraje_id = p.id AND pa.country_code = p.country_code
        WHERE p.country_code = $1
        GROUP BY p.id, p.nombre
        ORDER BY lower(p.nombre)`,
      [countryCode]
    );
    res.json(legacy);
  } catch (error) {
    res.status(500).json({ error: 'No se pudieron listar los parajes' });
  }
});

router.post('/parajes', requireAuth, requireAdmin, async (req, res) => {
  return res.status(400).json({ error: 'Los parajes se gestionan en Odoo. Sincroniza con /odoo/parajes/sync.' });
});

router.patch('/parajes/:id', requireAuth, requireAdmin, async (req, res) => {
  return res.status(400).json({ error: 'Los parajes se gestionan en Odoo. Sincroniza con /odoo/parajes/sync.' });
});

router.delete('/parajes/:id', requireAuth, requireAdmin, async (req, res) => {
  return res.status(400).json({ error: 'Los parajes se gestionan en Odoo. Sincroniza con /odoo/parajes/sync.' });
});

router.post('/parajes/auto-assign', requireAuth, requireAdmin, async (req, res) => {
  return res.status(400).json({ error: 'Los parajes se gestionan en Odoo. Sincroniza con /odoo/parajes/sync.' });
});

module.exports = router;
