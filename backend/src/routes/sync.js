const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/sync/snapshot', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  try {
    const [
      parcelas,
      olivos,
      palots,
      relations,
      etiquetas,
      parcelasEtiquetas,
      parajes,
      activityTypes,
      activities,
    ] = await Promise.all([
      db.public.many(`SELECT par.*, pj.nombre AS paraje_nombre
                        FROM parcelas par
                        LEFT JOIN parajes pj ON pj.id = par.paraje_id
                       ORDER BY par.id`),
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
                       ORDER BY pp.created_at DESC NULLS LAST, pp.id DESC`),
      db.public.many('SELECT id, nombre FROM etiquetas ORDER BY nombre ASC'),
      db.public.many('SELECT id_parcela, id_etiqueta FROM parcelas_etiquetas ORDER BY id_parcela, id_etiqueta'),
      db.public.many('SELECT id, nombre FROM parajes ORDER BY nombre ASC'),
      db.public.many('SELECT id, nombre, icono FROM activity_types ORDER BY nombre ASC'),
      db.public.many(
        `SELECT pa.id,
                pa.parcela_id,
                par.nombre AS parcela_nombre,
                par.nombre_interno AS parcela_nombre_interno,
                par.sigpac_municipio,
                par.sigpac_poligono,
                par.sigpac_parcela,
                par.sigpac_recinto,
                par.paraje_id AS parcela_paraje_id,
                pj.nombre AS parcela_paraje_nombre,
                pa.olivo_id,
                pa.activity_type_id,
                at.nombre AS activity_type_nombre,
                at.icono AS activity_type_icono,
                pa.personas,
                pa.notas,
                pa.created_at,
                pa.created_by,
                u.username AS created_by_username
           FROM parcela_activities pa
           JOIN parcelas par ON par.id = pa.parcela_id
           LEFT JOIN parajes pj ON pj.id = par.paraje_id
           JOIN activity_types at ON at.id = pa.activity_type_id
           LEFT JOIN users u ON u.id = pa.created_by
          ORDER BY pa.created_at DESC, pa.id DESC`
      ),
    ]);
    res.json({
      parcelas,
      olivos,
      palots,
      relations,
      etiquetas,
      parcelas_etiquetas: parcelasEtiquetas,
      parajes,
      activity_types: activityTypes,
      activities,
    });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo generar el snapshot' });
  }
});

module.exports = router;
