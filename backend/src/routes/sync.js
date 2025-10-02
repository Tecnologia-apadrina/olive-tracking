const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/sync/snapshot', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  try {
    const [parcelas, olivos, palots, relations] = await Promise.all([
      db.public.many('SELECT * FROM parcelas ORDER BY id'),
      db.public.many('SELECT * FROM olivos ORDER BY id'),
      db.public.many('SELECT * FROM palots ORDER BY id'),
      db.public.many(`SELECT pp.id,
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
                             pp.id_usuario AS created_by,
                             u.username AS created_by_username,
                             pp.created_at AS created_at
                        FROM parcelas_palots pp
                        JOIN parcelas par ON par.id = pp.id_parcela
                        JOIN palots   p   ON p.id = pp.id_palot
                        LEFT JOIN users  u ON u.id = pp.id_usuario
                       ORDER BY pp.created_at DESC NULLS LAST, pp.id DESC`),
    ]);
    res.json({ parcelas, olivos, palots, relations });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo generar el snapshot' });
  }
});

module.exports = router;
