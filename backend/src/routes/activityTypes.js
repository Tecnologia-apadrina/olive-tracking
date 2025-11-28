const express = require('express');
const router = express.Router();
const db = require('../db');
const { resolveRequestCountry } = require('../utils/country');

const requireAuth = (req, res, next) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  next();
};

const requireAdminOrMetrics = (req, res, next) => {
  if (!req.userId || (req.userRole !== 'admin' && req.userRole !== 'metricas')) {
    return res.status(403).json({ error: 'Requiere admin o métricas' });
  }
  next();
};

const normalizeText = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const allowedScopes = ['campo', 'conservera'];
const normalizeScope = (raw) => {
  const value = (raw || '').toString().trim().toLowerCase();
  return allowedScopes.includes(value) ? value : 'campo';
};

const scopeForRole = (role) => {
  if (role === 'conservera') return 'conservera';
  if (role === 'campo') return 'campo';
  return null; // admin/metricas or others -> no filter
};

const mapRow = (row) => ({
  id: row.id,
  nombre: row.nombre || '',
  icono: row.icono || '',
  scope: row.scope || 'campo',
});

router.get('/activity-types', requireAuth, async (req, res) => {
  const countryCode = resolveRequestCountry(req);
  const scopeFilter = scopeForRole(req.userRole);
  try {
    const params = [countryCode];
    let sql = 'SELECT id, nombre, icono, scope FROM activity_types WHERE country_code = $1';
    if (scopeFilter) {
      params.push(scopeFilter);
      sql += ` AND scope = $${params.length}`;
    }
    sql += ' ORDER BY nombre ASC';
    const rows = await db.public.many(sql, params);
    res.json(rows.map(mapRow));
  } catch (error) {
    res.status(500).json({ error: 'No se pudieron listar los tipos de actividad' });
  }
});

router.post('/activity-types', requireAuth, requireAdminOrMetrics, async (req, res) => {
  const countryCode = resolveRequestCountry(req);
  const nombre = normalizeText(req.body && req.body.nombre);
  const icono = normalizeText(req.body && req.body.icono);
  if (!nombre) {
    return res.status(400).json({ error: 'nombre requerido' });
  }
  const scope = normalizeScope(req.body && req.body.scope);
  try {
    const row = await db.public.one(
      'INSERT INTO activity_types(nombre, icono, scope, country_code) VALUES($1, $2, $3, $4) RETURNING id, nombre, icono, scope',
      [nombre, icono, scope, countryCode]
    );
    res.status(201).json(mapRow(row));
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Ya existe un tipo con ese nombre en ese ámbito' });
    }
    res.status(500).json({ error: 'No se pudo crear el tipo de actividad' });
  }
});

router.put('/activity-types/:typeId', requireAuth, requireAdminOrMetrics, async (req, res) => {
  const countryCode = resolveRequestCountry(req);
  const nombre = normalizeText(req.body && req.body.nombre);
  const icono = normalizeText(req.body && req.body.icono);
  if (!nombre) {
    return res.status(400).json({ error: 'nombre requerido' });
  }
  const typeId = Number(req.params.typeId);
  if (!Number.isInteger(typeId) || typeId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const scope = normalizeScope(req.body && req.body.scope);
  try {
    const row = await db.public.one(
      `UPDATE activity_types
          SET nombre = $1,
              icono = $2,
              scope = $3
        WHERE id = $4 AND country_code = $5
        RETURNING id, nombre, icono, scope`,
      [nombre, icono, scope, typeId, countryCode]
    );
    res.json(mapRow(row));
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Ya existe un tipo con ese nombre en ese ámbito' });
    }
    if (error.message && error.message.includes('No rows')) {
      return res.status(404).json({ error: 'Tipo de actividad no encontrado' });
    }
    res.status(500).json({ error: 'No se pudo actualizar el tipo de actividad' });
  }
});

router.delete('/activity-types/:typeId', requireAuth, requireAdminOrMetrics, async (req, res) => {
  const typeId = Number(req.params.typeId);
  const countryCode = resolveRequestCountry(req);
  if (!Number.isInteger(typeId) || typeId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    await db.public.one(
      'DELETE FROM activity_types WHERE id = $1 AND country_code = $2 RETURNING id',
      [typeId, countryCode]
    );
    res.status(204).end();
  } catch (error) {
    if (error.message && error.message.includes('No rows')) {
      return res.status(404).json({ error: 'Tipo de actividad no encontrado' });
    }
    if (error.code === '23503') {
      return res.status(400).json({ error: 'No se puede eliminar: existen actividades relacionadas' });
    }
    res.status(500).json({ error: 'No se pudo eliminar el tipo de actividad' });
  }
});

module.exports = router;
