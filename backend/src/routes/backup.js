const express = require('express');
const router = express.Router();
const { runBackup } = require('../services/backup');

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

router.post('/backup/run', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const result = await runBackup();
    res.json({
      ok: true,
      file: result.fileName,
      path: result.filePath,
    });
  } catch (error) {
    console.error('Error generando copia de seguridad', error);
    res.status(500).json({ error: 'No se pudo generar la copia de seguridad', details: error.message });
  }
});

module.exports = router;
