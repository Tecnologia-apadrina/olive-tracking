const express = require('express');
const router = express.Router();
const db = require('../db');

const toBool = (value) => {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['1', 'true', 't', 'yes', 'si', 'sí', 'y'].includes(normalized);
  }
  return Boolean(value);
};

// Assign a palot to a parcela
router.post('/parcelas/:parcelaId/palots', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  const { parcelaId } = req.params;
  const { palot_id, kgs, reservado_aderezo, notas } = req.body;
  if (!palot_id) {
    return res.status(400).json({ error: 'palot_id requerido' });
  }
  const userId = req.userId || null;
  const reservadoValue = toBool(reservado_aderezo);
  const result = await db.public.one(
    'INSERT INTO parcelas_palots(id_parcela, id_palot, id_usuario, kgs, reservado_aderezo, notas) VALUES($1, $2, $3, $4, $5, $6) RETURNING *',
    [parcelaId, palot_id, userId, kgs ?? null, reservadoValue, notas ?? null]
  );
  res.status(201).json(result);
});

// List palots for a parcela
router.get('/parcelas/:parcelaId/palots', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
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
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  const { parcelaId, palotId } = req.params;
  await db.public.none(
    'DELETE FROM parcelas_palots WHERE id_parcela = $1 AND id_palot = $2',
    [parcelaId, palotId]
  );
  res.status(204).end();
});

// List all parcela–palot relations
router.get('/parcelas-palots', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
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
              par.porcentaje AS parcela_porcentaje,
              par.nombre_interno AS parcela_nombre_interno,
              p.id     AS palot_id,
              p.codigo AS palot_codigo,
              p.procesado AS palot_procesado,
              pp.kgs   AS kgs,
              pp.reservado_aderezo AS reservado_aderezo,
              pp.notas AS notas,
              pp.id_usuario AS created_by,
              u.username AS created_by_username,
              pp.created_at AS created_at
         FROM parcelas_palots pp
         JOIN parcelas par ON par.id = pp.id_parcela
         JOIN palots   p   ON p.id = pp.id_palot
         LEFT JOIN users  u ON u.id = pp.id_usuario
        ORDER BY pp.created_at DESC NULLS LAST, pp.id DESC`
    );
    res.json(rows);
  } catch (e) {
    res.json([]);
  }
});

// Update relation attributes (e.g., kgs)
router.patch('/parcelas-palots/:id', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  const { id } = req.params;
  const { kgs, reservado_aderezo, notas } = req.body || {};

  const fields = [];
  const params = [];
  let idx = 1;

  if (kgs !== undefined) {
    let value = null;
    if (kgs !== null && String(kgs).trim() !== '') {
      const num = Number(kgs);
      if (Number.isNaN(num)) {
        return res.status(400).json({ error: 'kgs debe ser numérico' });
      }
      value = num;
    }
    fields.push(`kgs = $${idx++}`);
    params.push(value);
  }

  if (reservado_aderezo !== undefined) {
    fields.push(`reservado_aderezo = $${idx++}`);
    params.push(toBool(reservado_aderezo));
  }

  if (notas !== undefined) {
    fields.push(`notas = $${idx++}`);
    params.push(notas === null ? null : String(notas));
  }

  if (!fields.length) {
    return res.status(400).json({ error: 'Sin cambios' });
  }

  params.push(id);

  try {
    const updated = await db.public.one(
      `UPDATE parcelas_palots SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    res.json(updated);
  } catch (e) {
    res.status(404).json({ error: 'Relación no encontrada' });
  }
});

module.exports = router;
