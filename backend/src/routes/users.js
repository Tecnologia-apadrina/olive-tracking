const express = require('express');
const router = express.Router();
const db = require('../db');
const { hashPassword } = require('../utils/password');
const { isValidCountryCode, normalizeCountryCode } = require('../utils/country');

const allowedRoles = ['campo', 'conservera', 'patio', 'molino', 'metricas', 'admin'];
const normalizeRole = (role) => {
  const normalized = (role || '').toString().trim().toLowerCase() || 'campo';
  return allowedRoles.includes(normalized) ? normalized : 'campo';
};

// Simple helpers
const requireAuth = (req, res, next) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  next();
};
const requireAdmin = (req, res, next) => {
  if (!req.userId || req.userRole !== 'admin') return res.status(403).json({ error: 'Requiere admin' });
  next();
};

// Current user info (simple health of auth)
router.get('/me', requireAuth, async (req, res) => {
  res.json({ id: req.userId, username: req.username, role: req.userRole, country_code: req.userCountry || 'ES' });
});

// Create user (admin)
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, role, country_code } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username y password requeridos' });
  if (!isValidCountryCode(country_code)) {
    return res.status(400).json({ error: 'country_code inválido (usa ES o PT)' });
  }
  try {
    const normalizedCountry = normalizeCountryCode(country_code);
    const row = await db.public.one(
      'INSERT INTO users(username, password_hash, role, country_code) VALUES($1, $2, $3, $4) RETURNING id, username, role, country_code',
      [username, hashPassword(password), normalizeRole(role), normalizedCountry]
    );
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ error: 'No se pudo crear (quizá username duplicado)' });
  }
});

// List users (admin)
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  const rawCountry = req.query && (req.query.country_code || req.query.country);
  const normalizedCountry = isValidCountryCode(rawCountry) ? normalizeCountryCode(rawCountry) : null;
  const query = normalizedCountry
    ? 'SELECT id, username, role, country_code FROM users WHERE country_code = $1 ORDER BY username'
    : 'SELECT id, username, role, country_code FROM users ORDER BY username';
  const params = normalizedCountry ? [normalizedCountry] : [];
  const rows = await db.public.many(query, params);
  res.json(rows);
});

// Update user (admin)
router.patch('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { username, role, password, country_code } = req.body || {};
  try {
    // Build dynamic update
    const fields = [];
    const params = [];
    let idx = 1;
    if (username) { fields.push(`username = $${idx++}`); params.push(username); }
    if (role) { fields.push(`role = $${idx++}`); params.push(normalizeRole(role)); }
    if (password) { fields.push(`password_hash = $${idx++}`); params.push(hashPassword(password)); }
    if (country_code !== undefined) {
      if (!isValidCountryCode(country_code)) {
        return res.status(400).json({ error: 'country_code inválido' });
      }
      fields.push(`country_code = $${idx++}`);
      params.push(normalizeCountryCode(country_code));
    }
    if (fields.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(id);
    const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, username, role, country_code`;
    const row = await db.public.one(sql, params);
    res.json(row);
  } catch (e) {
    res.status(404).json({ error: 'Usuario no encontrado' });
  }
});

// Delete user (admin)
router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  await db.public.none('DELETE FROM users WHERE id = $1', [id]);
  res.status(204).end();
});

module.exports = router;
