const express = require('express');
const router = express.Router();
const db = require('../db');

const normalizeEtiquetaIds = (value) => {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  const normalized = [];
  for (const item of arr) {
    const num = Number(item);
    if (Number.isInteger(num) && num > 0 && !normalized.includes(num)) {
      normalized.push(num);
    }
  }
  return normalized;
};

const fetchParcelTags = async (parcelaId) => {
  if (!Number.isInteger(parcelaId)) return [];
  try {
    const rows = await db.public.many(
      `SELECT e.id, e.nombre
         FROM parcelas_etiquetas pe
         JOIN etiquetas e ON e.id = pe.id_etiqueta
        WHERE pe.id_parcela = $1
        ORDER BY e.nombre ASC`,
      [parcelaId]
    );
    return rows;
  } catch (_) {
    return [];
  }
};

const setParcelTags = async (parcelaId, etiquetaIds) => {
  if (!Number.isInteger(parcelaId)) return [];
  const ids = normalizeEtiquetaIds(etiquetaIds);
  if (!ids.length) {
    await db.public.none('DELETE FROM parcelas_etiquetas WHERE id_parcela = $1', [parcelaId]);
    return [];
  }
  const existing = await db.public.many(
    'SELECT id FROM etiquetas WHERE id = ANY($1::int[])',
    [ids]
  );
  const validIds = existing.map((row) => Number(row.id)).filter((id) => Number.isInteger(id));
  await db.public.none('DELETE FROM parcelas_etiquetas WHERE id_parcela = $1', [parcelaId]);
  if (validIds.length) {
    const values = validIds.map((_, idx) => `($1, $${idx + 2})`);
    await db.public.none(
      `INSERT INTO parcelas_etiquetas(id_parcela, id_etiqueta)
       VALUES ${values.join(', ')}
       ON CONFLICT DO NOTHING`,
      [parcelaId, ...validIds]
    );
  }
  return fetchParcelTags(parcelaId);
};

const fetchRelationWithDetails = async (relationId) => {
  return db.public.one(
    `SELECT pp.id,
            par.id   AS parcela_id,
            par.nombre AS parcela_nombre,
            par.sigpac_municipio,
            par.sigpac_poligono,
            par.sigpac_parcela,
            par.sigpac_recinto,
            par.variedad   AS parcela_variedad,
            par.porcentaje AS parcela_porcentaje,
            par.num_olivos AS parcela_num_olivos,
            par.hectareas  AS parcela_hectareas,
            par.nombre_interno AS parcela_nombre_interno,
            par.paraje_id AS parcela_paraje_id,
            pj.nombre AS parcela_paraje_nombre,
            p.id     AS palot_id,
            p.codigo AS palot_codigo,
            p.procesado AS palot_procesado,
            pp.kgs   AS kgs,
            pp.reservado_aderezo AS reservado_aderezo,
            pp.notas AS notas,
            pp.id_usuario AS created_by,
            u.username AS created_by_username,
            pp.created_at AS created_at,
            COALESCE((
              SELECT json_agg(json_build_object('id', e.id, 'nombre', e.nombre) ORDER BY e.nombre)
                FROM parcelas_etiquetas pe
                JOIN etiquetas e ON e.id = pe.id_etiqueta
               WHERE pe.id_parcela = par.id
            ), '[]'::json) AS parcela_etiquetas
       FROM parcelas_palots pp
       JOIN parcelas par ON par.id = pp.id_parcela
       LEFT JOIN parajes pj ON pj.id = par.paraje_id
       JOIN palots   p   ON p.id = pp.id_palot
       LEFT JOIN users  u ON u.id = pp.id_usuario
      WHERE pp.id = $1`,
    [relationId]
  );
};

const parseRequiredNumber = (value, field = 'valor') => {
  if (value === undefined || value === null) {
    return { error: `${field} requerido` };
  }
  const str = typeof value === 'string' ? value.trim() : String(value);
  if (str === '') {
    return { error: `${field} requerido` };
  }
  const normalized = str.replace(/\s+/g, '').replace(',', '.');
  const num = Number(normalized);
  if (!Number.isFinite(num)) {
    return { error: `${field} inválido` };
  }
  return { value: num };
};

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
  const { palot_id, kgs, reservado_aderezo, notas, etiquetas } = req.body || {};
  if (!palot_id) {
    return res.status(400).json({ error: 'palot_id requerido' });
  }
  const parsedKgs = parseRequiredNumber(kgs, 'kgs');
  if (parsedKgs.error) {
    return res.status(400).json({ error: parsedKgs.error });
  }
  const userId = req.userId || null;
  const reservadoValue = toBool(reservado_aderezo);
  const result = await db.public.one(
    'INSERT INTO parcelas_palots(id_parcela, id_palot, id_usuario, kgs, reservado_aderezo, notas) VALUES($1, $2, $3, $4, $5, $6) RETURNING *',
    [parcelaId, palot_id, userId, parsedKgs.value, reservadoValue, notas ?? null]
  );
  let tags = [];
  if (etiquetas !== undefined) {
    try {
      tags = await setParcelTags(Number(parcelaId), etiquetas);
    } catch (_) {
      // Silently ignore tag assignment errors but continue
      tags = [];
    }
  }
  let enriched;
  try {
    enriched = await fetchRelationWithDetails(result.id);
  } catch (_) {
    enriched = { ...result, parcela_etiquetas: tags };
  }
  res.status(201).json({
    ...enriched,
    parcela_etiquetas: enriched.parcela_etiquetas != null ? enriched.parcela_etiquetas : tags,
  });
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
              par.num_olivos AS parcela_num_olivos,
              par.hectareas AS parcela_hectareas,
              par.nombre_interno AS parcela_nombre_interno,
              par.paraje_id AS parcela_paraje_id,
              pj.nombre AS parcela_paraje_nombre,
              p.id     AS palot_id,
              p.codigo AS palot_codigo,
              p.procesado AS palot_procesado,
              pp.kgs   AS kgs,
              pp.reservado_aderezo AS reservado_aderezo,
              pp.notas AS notas,
              pp.id_usuario AS created_by,
              u.username AS created_by_username,
              pp.created_at AS created_at,
              COALESCE((
                SELECT json_agg(json_build_object('id', e.id, 'nombre', e.nombre) ORDER BY e.nombre)
                  FROM parcelas_etiquetas pe
                  JOIN etiquetas e ON e.id = pe.id_etiqueta
                 WHERE pe.id_parcela = par.id
              ), '[]'::json) AS parcela_etiquetas
         FROM parcelas_palots pp
         JOIN parcelas par ON par.id = pp.id_parcela
         LEFT JOIN parajes pj ON pj.id = par.paraje_id
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
  const { kgs, reservado_aderezo, notas, etiquetas } = req.body || {};

  const fields = [];
  const params = [];
  let idx = 1;

  if (kgs !== undefined) {
    const parsed = parseRequiredNumber(kgs, 'kgs');
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    fields.push(`kgs = $${idx++}`);
    params.push(parsed.value);
  }

  if (reservado_aderezo !== undefined) {
    fields.push(`reservado_aderezo = $${idx++}`);
    params.push(toBool(reservado_aderezo));
  }

  if (notas !== undefined) {
    fields.push(`notas = $${idx++}`);
    params.push(notas === null ? null : String(notas));
  }

  const etiquetasProvided = etiquetas !== undefined;

  if (!fields.length && !etiquetasProvided) {
    return res.status(400).json({ error: 'Sin cambios' });
  }

  try {
    let updated;
    if (fields.length) {
      params.push(id);
      await db.public.one(
        `UPDATE parcelas_palots SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id`,
        params
      );
    }
    updated = await fetchRelationWithDetails(id);
    let tags = [];
    if (etiquetasProvided) {
      try {
        tags = await setParcelTags(Number(updated.id_parcela), etiquetas);
      } catch (_) {
        tags = await fetchParcelTags(Number(updated.id_parcela));
      }
    } else {
      tags = await fetchParcelTags(Number(updated.id_parcela));
    }
    res.json({
      ...updated,
      parcela_etiquetas: tags,
    });
  } catch (e) {
    res.status(404).json({ error: 'Relación no encontrada' });
  }
});

module.exports = router;
