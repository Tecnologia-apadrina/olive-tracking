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

function parseNullableNumberInput(value, { integer = false, field = 'valor' } = {}) {
  if (value === undefined) {
    return { provided: false };
  }
  if (value === null || value === '') {
    return { provided: true, value: null };
  }
  const str = typeof value === 'string' ? value.trim() : String(value);
  if (str === '') {
    return { provided: true, value: null };
  }
  const normalized = str.replace(/\s+/g, '').replace(',', '.');
  const num = Number(normalized);
  if (!Number.isFinite(num)) {
    return { provided: true, error: `${field} inválido` };
  }
  if (integer && !Number.isInteger(num)) {
    return { provided: true, error: `${field} inválido` };
  }
  return { provided: true, value: num };
}

// Create a new parcela (auth required)
router.post('/parcelas', async (req, res) => {
  return res.status(400).json({ error: 'Las parcelas se gestionan en Odoo. Sincroniza con /odoo/parcelas/sync.' });
});

// List parcelas (admin only)
router.get('/parcelas', requireAuth, requireAdmin, async (req, res) => {
  const countryCode = resolveRequestCountry(req);
  try {
    const rows = await db.public.many(
      `SELECT
          par.id,
          COALESCE(op.name, par.nombre) AS nombre,
          COALESCE(op.common_name, par.nombre_interno) AS nombre_interno,
          par.sigpac_municipio,
          par.sigpac_poligono,
          par.sigpac_parcela,
          par.sigpac_recinto,
          par.variedad,
          COALESCE(op.contract_percentage, par.porcentaje) AS porcentaje,
          par.num_olivos,
          par.hectareas,
          COALESCE(op.landscape_id, par.paraje_id) AS paraje_id,
          COALESCE(ol.name, pj.nombre) AS paraje_nombre,
          par.country_code
       FROM parcelas par
       LEFT JOIN odoo_parcelas op ON op.id = par.id AND op.country_code = par.country_code
       LEFT JOIN odoo_landscapes ol ON ol.id = COALESCE(op.landscape_id, par.paraje_id) AND ol.country_code = par.country_code
       LEFT JOIN parajes pj ON pj.id = par.paraje_id AND pj.country_code = par.country_code
      WHERE par.country_code = $1
      ORDER BY par.id`,
      [countryCode]
    );
    res.json(rows);
  } catch (e) {
    res.json([]);
  }
});

// Update parcela fields (admin only)
router.patch('/parcelas/:id', requireAuth, requireAdmin, async (req, res) => {
  return res.status(400).json({ error: 'Las parcelas se gestionan en Odoo. Sincroniza con /odoo/parcelas/sync.' });
});

// Delete parcela (admin only)
router.delete('/parcelas/:id', requireAuth, requireAdmin, async (req, res) => {
  return res.status(400).json({ error: 'Las parcelas se gestionan en Odoo. Sincroniza con /odoo/parcelas/sync.' });
});

module.exports = router;
