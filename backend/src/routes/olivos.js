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
      `SELECT
          oo.id,
          oo.parcel_id AS id_parcela,
          oo.default_code,
          oo.name,
          oo.updated_at
       FROM odoo_olivos oo
       WHERE oo.country_code = $1
       ORDER BY oo.id`,
      [countryCode]
    );
    const lastSyncRow = await db.public.one(
      'SELECT MAX(updated_at) AS last_sync FROM odoo_olivos WHERE country_code = $1',
      [countryCode]
    );
    res.json({
      items: rows,
      count: rows.length,
      last_sync_at: lastSyncRow?.last_sync || null,
    });
  } catch (e) {
    res.json({ items: [], count: 0, last_sync_at: null });
  }
});

// Get parcela info for a given olivo id
// Returns: { id, nombre, porcentaje } for the parcela
router.get('/olivos/:olivoId/parcela', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  const countryCode = resolveRequestCountry(req);
  const rawParam = typeof req.params.olivoId === 'string' ? req.params.olivoId.trim() : '';
  if (!rawParam) {
    return res.status(400).json({ error: 'Referencia de olivo requerida' });
  }
  const candidates = [];
  candidates.push(rawParam);
  const withoutZeros = rawParam.replace(/^0+/, '');
  if (withoutZeros && withoutZeros !== rawParam) {
    candidates.push(withoutZeros);
  }
  const numericId = Number(rawParam);
  const hasNumeric = Number.isInteger(numericId) && numericId > 0;
  if (hasNumeric) {
    const padded = String(numericId).padStart(Math.max(rawParam.length, 5), '0');
    if (!candidates.includes(padded)) candidates.push(padded);
  }
  try {
    let olivoRow = null;
    for (const candidate of candidates) {
      const byCode = await db.public.many(
        `SELECT id, parcel_id
           FROM odoo_olivos
          WHERE country_code = $1 AND lower(default_code) = lower($2)
          LIMIT 1`,
        [countryCode, candidate]
      );
      if (byCode && byCode[0]) {
        olivoRow = byCode[0];
        break;
      }
    }
    if (!olivoRow && hasNumeric) {
      const byIdRows = await db.public.many(
        `SELECT id, parcel_id
           FROM odoo_olivos
          WHERE country_code = $1 AND id = $2
          LIMIT 1`,
        [countryCode, numericId]
      );
      olivoRow = byIdRows && byIdRows[0] ? byIdRows[0] : null;
    }
    if (!olivoRow && hasNumeric) {
      const fallback = await db.public.many(
        `SELECT id, id_parcela AS parcel_id
           FROM olivos
          WHERE country_code = $1 AND id = $2
          LIMIT 1`,
        [countryCode, numericId]
      );
      olivoRow = fallback && fallback[0] ? fallback[0] : null;
    }
    if (!olivoRow || !Number.isInteger(Number(olivoRow.parcel_id))) {
      return res.status(404).json({ error: 'Olivo o parcela no encontrada' });
    }
    const parcela = await db.public.one(
      `SELECT par.id,
              COALESCE(op.name, par.nombre) AS nombre,
              COALESCE(op.contract_percentage, par.porcentaje) AS porcentaje,
              COALESCE(op.common_name, par.nombre_interno) AS nombre_interno,
              COALESCE(op.landscape_id, par.paraje_id) AS paraje_id,
              COALESCE(ols.name, pj.nombre) AS paraje_nombre
         FROM parcelas par
         LEFT JOIN odoo_parcelas op ON op.id = par.id AND op.country_code = par.country_code
         LEFT JOIN odoo_landscapes ols ON ols.id = COALESCE(op.landscape_id, par.paraje_id) AND ols.country_code = par.country_code
         LEFT JOIN parajes pj ON pj.id = par.paraje_id AND pj.country_code = par.country_code
        WHERE par.id = $1 AND par.country_code = $2`,
      [olivoRow.parcel_id, countryCode]
    );
    res.json(parcela);
  } catch (e) {
    return res.status(404).json({ error: 'Olivo o parcela no encontrada' });
  }
});

module.exports = router;
 
