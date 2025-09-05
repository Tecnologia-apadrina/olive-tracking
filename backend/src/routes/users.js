const express = require('express');
const router = express.Router();
const db = require('../db');
const { hashPassword } = require('../utils/password');

// Simple helpers
const requireAuth = (req, res, next) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  next();
};
const requireAdmin = (req, res, next) => {
  if (!req.userId || req.userRole !== 'admin') return res.status(403).json({ error: 'Requiere admin' });
  next();
};

// Create user (admin or if first user)
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username y password requeridos' });
  try {
    const row = await db.public.one(
      'INSERT INTO users(username, password_hash, role) VALUES($1, $2, $3) RETURNING id, username, role',
      [username, hashPassword(password), role || 'user']
    );
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ error: 'No se pudo crear (quizá username duplicado)' });
  }
});

// List users (admin)
router.get('/users', requireAuth, requireAdmin, async (_req, res) => {
  const rows = await db.public.many('SELECT id, username, role FROM users ORDER BY username');
  res.json(rows);
});

// Update user (admin)
router.patch('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { username, role, password } = req.body || {};
  try {
    // Build dynamic update
    const fields = [];
    const params = [];
    let idx = 1;
    if (username) { fields.push(`username = $${idx++}`); params.push(username); }
    if (role) { fields.push(`role = $${idx++}`); params.push(role); }
    if (password) { fields.push(`password_hash = $${idx++}`); params.push(hashPassword(password)); }
    if (fields.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(id);
    const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, username, role`;
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
// Current user info
router.get('/me', requireAuth, async (req, res) => {
  res.json({ id: req.userId, username: req.username, role: req.userRole });
});
