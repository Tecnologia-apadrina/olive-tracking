const express = require('express');
const router = express.Router();
const db = require('../db');

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

const findOrCreateParaje = async (nombre, { cache }) => {
  const key = normalizeName(nombre).toLocaleLowerCase('es-ES');
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);

  const existing = await db.public.many(
    'SELECT id, nombre FROM parajes WHERE lower(nombre) = lower($1)',
    [nombre]
  );
  if (existing.length > 0) {
    const row = existing[0];
    cache.set(key, row);
    return row;
  }
  const inserted = await db.public.one(
    'INSERT INTO parajes(nombre) VALUES($1) RETURNING id, nombre',
    [nombre]
  );
  cache.set(key, inserted);
  return inserted;
};

router.get('/parajes', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const rows = await db.public.many(
      `SELECT p.id,
              p.nombre,
              COUNT(pa.id)::int AS parcelas_count
         FROM parajes p
         LEFT JOIN parcelas pa ON pa.paraje_id = p.id
        GROUP BY p.id, p.nombre
        ORDER BY lower(p.nombre)`
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'No se pudieron listar los parajes' });
  }
});

router.post('/parajes', requireAuth, requireAdmin, async (req, res) => {
  const nombre = normalizeName(req.body?.nombre);
  if (!nombre) {
    return res.status(400).json({ error: 'nombre requerido' });
  }
  try {
    const row = await db.public.one(
      'INSERT INTO parajes(nombre) VALUES($1) RETURNING *',
      [nombre]
    );
    res.status(201).json(row);
  } catch (error) {
    if (error.message && error.message.includes('duplicate')) {
      return res.status(409).json({ error: 'El paraje ya existe' });
    }
    res.status(500).json({ error: 'No se pudo crear el paraje' });
  }
});

router.patch('/parajes/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return res.status(400).json({ error: 'id inválido' });
  }
  const updates = [];
  const values = [];
  let idx = 1;
  if (req.body?.nombre !== undefined) {
    const nombre = normalizeName(req.body.nombre);
    if (!nombre) {
      return res.status(400).json({ error: 'nombre requerido' });
    }
    updates.push(`nombre = $${idx++}`);
    values.push(nombre);
  }
  if (!updates.length) {
    return res.status(400).json({ error: 'Sin cambios' });
  }
  values.push(numericId);
  try {
    const row = await db.public.one(
      `UPDATE parajes SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    res.json(row);
  } catch (error) {
    if (error.message && error.message.includes('duplicate')) {
      return res.status(409).json({ error: 'El paraje ya existe' });
    }
    res.status(500).json({ error: 'No se pudo actualizar el paraje' });
  }
});

router.delete('/parajes/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return res.status(400).json({ error: 'id inválido' });
  }
  try {
    await db.public.none('UPDATE parcelas SET paraje_id = NULL WHERE paraje_id = $1', [numericId]);
    await db.public.none('DELETE FROM parajes WHERE id = $1', [numericId]);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'No se pudo eliminar el paraje' });
  }
});

router.post('/parajes/auto-assign', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const parcelas = await db.public.many(
      'SELECT id, nombre, paraje_id FROM parcelas ORDER BY id'
    );
    const cache = new Map();
    let assigned = 0;
    const ensureCache = async (nombre) => findOrCreateParaje(nombre, { cache });

    for (const parcela of parcelas) {
      if (parcela.paraje_id) continue;
      const rawName = normalizeName(parcela.nombre);
      if (!rawName.includes('-')) continue;
      const [parajePart, ...restParts] = rawName.split('-');
      const parajeName = normalizeName(parajePart);
      if (!parajeName || restParts.length === 0) continue;
      const paraje = await ensureCache(parajeName);
      if (!paraje) continue;
      await db.public.none('UPDATE parcelas SET paraje_id = $1 WHERE id = $2', [paraje.id, parcela.id]);
      assigned += 1;
    }

    const totalParajesRow = await db.public.one('SELECT COUNT(*)::int AS total FROM parajes');
    const totalParajes = Number(totalParajesRow.total) || cache.size;
    res.json({ assigned, parajesRegistrados: totalParajes });
  } catch (error) {
    console.error('Auto assign parajes error', error);
    res.status(500).json({ error: 'No se pudieron asignar los parajes automáticamente' });
  }
});

module.exports = router;
