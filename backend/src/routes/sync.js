const express = require('express');
const router = express.Router();
const db = require('../db');
const { resolveRequestCountry } = require('../utils/country');

router.get('/sync/snapshot', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  try {
    const countryCode = resolveRequestCountry(req);
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
      db.public.many(
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
      ),
      db.public.many(
        `SELECT
            oo.id,
            COALESCE(oo.parcel_id, o.id_parcela) AS id_parcela,
            oo.default_code,
            oo.name,
            oo.country_code
         FROM odoo_olivos oo
         LEFT JOIN olivos o ON o.id = oo.id
        WHERE oo.country_code = $1
        ORDER BY oo.id`,
        [countryCode]
      ),
      db.public.many('SELECT * FROM palots WHERE country_code = $1 ORDER BY id', [countryCode]),
      db.public.many(`SELECT pp.id,
                             par.id   AS parcela_id,
                             COALESCE(op.name, par.nombre) AS parcela_nombre,
                             par.sigpac_municipio,
                             par.sigpac_poligono,
                             par.sigpac_parcela,
                             par.sigpac_recinto,
                             par.variedad   AS parcela_variedad,
                             COALESCE(op.contract_percentage, par.porcentaje) AS parcela_porcentaje,
                             par.num_olivos AS parcela_num_olivos,
                             par.hectareas  AS parcela_hectareas,
                             COALESCE(op.common_name, par.nombre_interno) AS parcela_nombre_interno,
                             COALESCE(op.landscape_id, par.paraje_id) AS parcela_paraje_id,
                             COALESCE(ol.name, pj.nombre) AS parcela_paraje_nombre,
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
                        JOIN parcelas par ON par.id = pp.id_parcela AND par.country_code = pp.country_code
                        LEFT JOIN odoo_parcelas op ON op.id = par.id AND op.country_code = par.country_code
                        LEFT JOIN odoo_landscapes ol ON ol.id = COALESCE(op.landscape_id, par.paraje_id) AND ol.country_code = par.country_code
                        LEFT JOIN parajes pj ON pj.id = par.paraje_id AND pj.country_code = par.country_code
                        JOIN palots   p   ON p.id = pp.id_palot AND p.country_code = pp.country_code
                        LEFT JOIN users  u ON u.id = pp.id_usuario
                       WHERE pp.country_code = $1
                       ORDER BY pp.created_at DESC NULLS LAST, pp.id DESC`, [countryCode]),
      db.public.many('SELECT id, nombre FROM etiquetas WHERE country_code = $1 ORDER BY nombre ASC', [countryCode]),
      db.public.many(
        `SELECT pe.id_parcela, pe.id_etiqueta
           FROM parcelas_etiquetas pe
           JOIN parcelas par ON par.id = pe.id_parcela
          WHERE par.country_code = $1
          ORDER BY pe.id_parcela, pe.id_etiqueta`,
        [countryCode]
      ),
      db.public.many(
        `SELECT id, name AS nombre
           FROM odoo_landscapes
          WHERE country_code = $1
          ORDER BY name ASC`,
        [countryCode]
      ),
      db.public.many('SELECT id, nombre, icono FROM activity_types WHERE country_code = $1 ORDER BY nombre ASC', [countryCode]),
      db.public.many(
        `SELECT pa.id,
                pa.parcela_id,
                COALESCE(op.name, par.nombre) AS parcela_nombre,
                COALESCE(op.common_name, par.nombre_interno) AS parcela_nombre_interno,
                par.sigpac_municipio,
                par.sigpac_poligono,
                par.sigpac_parcela,
                par.sigpac_recinto,
                COALESCE(op.landscape_id, par.paraje_id) AS parcela_paraje_id,
                COALESCE(ol.name, pj.nombre) AS parcela_paraje_nombre,
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
           JOIN parcelas par ON par.id = pa.parcela_id AND par.country_code = pa.country_code
           LEFT JOIN odoo_parcelas op ON op.id = par.id AND op.country_code = par.country_code
           LEFT JOIN odoo_landscapes ol ON ol.id = COALESCE(op.landscape_id, par.paraje_id) AND ol.country_code = par.country_code
           LEFT JOIN parajes pj ON pj.id = par.paraje_id AND pj.country_code = par.country_code
           JOIN activity_types at ON at.id = pa.activity_type_id AND at.country_code = pa.country_code
           LEFT JOIN users u ON u.id = pa.created_by
          WHERE pa.country_code = $1
          ORDER BY pa.created_at DESC, pa.id DESC`,
        [countryCode]
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
