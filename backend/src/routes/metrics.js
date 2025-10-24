const express = require('express');
const router = express.Router();
const db = require('../db');

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

router.get('/metrics/harvest', requireAuth, requireAdminOrMetrics, async (_req, res) => {
  try {
    const totalRow = await db.public.one('SELECT COUNT(*)::int AS total FROM parcelas');
    const totalParcelas = Number(totalRow.total) || 0;
    const totalOlivosRow = await db.public.one('SELECT COALESCE(SUM(num_olivos), 0)::bigint AS total FROM parcelas');
    const totalOlivos = Number(totalOlivosRow.total) || 0;

    const rows = await db.public.many(
      `WITH daily_parcelas AS (
         SELECT
           pp.created_at::date AS harvest_date,
           pp.id_parcela,
           COALESCE(par.num_olivos, 0) AS num_olivos,
           COALESCE(SUM(pp.kgs), 0) AS kgs_parcela
         FROM parcelas_palots pp
         JOIN parcelas par ON par.id = pp.id_parcela
         GROUP BY pp.created_at::date, pp.id_parcela, par.num_olivos
       )
       SELECT
         harvest_date,
         COUNT(*) AS parcelas_cosechadas,
         COALESCE(SUM(num_olivos), 0) AS olivos_cosechados,
         COALESCE(SUM(kgs_parcela), 0) AS kgs_cosechados
       FROM daily_parcelas
       GROUP BY harvest_date
       ORDER BY harvest_date DESC`
    );

    const byDay = rows.map((row) => {
      const harvested = Number(row.parcelas_cosechadas) || 0;
      const olivos = Number(row.olivos_cosechados) || 0;
      const kgs = Number(row.kgs_cosechados) || 0;
      const avgOlivos = harvested > 0 ? olivos / harvested : 0;
      return {
        harvest_date: row.harvest_date,
        parcelas_cosechadas: harvested,
        olivos_cosechados: olivos,
        kgs_cosechados: kgs,
        avg_olivos_por_parcela: avgOlivos,
      };
    });

    const parcelaRows = await db.public.many(
      `SELECT
         par.id,
         par.nombre,
         COALESCE(par.num_olivos, 0) AS num_olivos,
         COALESCE(SUM(pp.kgs), 0) AS total_kgs
       FROM parcelas par
       LEFT JOIN parcelas_palots pp ON pp.id_parcela = par.id
       GROUP BY par.id, par.nombre, par.num_olivos
       ORDER BY par.nombre`
    );

    const perParcela = parcelaRows
      .map((row) => {
        const numOlivos = Number(row.num_olivos) || 0;
        const totalKgs = Number(row.total_kgs) || 0;
        if (totalKgs <= 0) return null;
        const avgKgsPorOlivo = numOlivos > 0 ? totalKgs / numOlivos : null;
        return {
          parcela_id: row.id,
          nombre: row.nombre || '',
          num_olivos: numOlivos,
          total_kgs: totalKgs,
          media_kgs_por_olivo: avgKgsPorOlivo,
        };
      })
      .filter(Boolean);

    res.json({ totalParcelas, totalOlivos, byDay, perParcela });
  } catch (error) {
    console.error('Metrics harvest error', error);
    res.status(500).json({ error: 'No se pudieron obtener las métricas' });
  }
});

module.exports = router;
