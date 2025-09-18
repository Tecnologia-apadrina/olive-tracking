const express = require('express');
const { execSync } = require('node:child_process');
const path = require('node:path');

const router = express.Router();

function safeExec(cmd) {
  try {
    // Run from backend folder; Git will resolve repo root
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (_) {
    return null;
  }
}

function buildVersionInfo() {
  // Prefer build-time envs (provided by Docker build args)
  const buildTime = process.env.BUILD_TIME || null;
  const commitSha = process.env.COMMIT_SHA || null;

  // Try to obtain Git metadata when available (dev environment)
  const shortSha = commitSha || safeExec('git rev-parse --short HEAD');
  const commitCount = safeExec('git rev-list --count HEAD');
  const branch = safeExec('git rev-parse --abbrev-ref HEAD');
  const tag = safeExec('git describe --tags --abbrev=0');

  // App/package version (backend package.json)
  let pkgVersion = '0.0.0';
  try {
    // ../../package.json from routes folder
    // eslint-disable-next-line import/no-dynamic-require, global-require
    pkgVersion = require(path.join(__dirname, '../../package.json')).version || '0.0.0';
  } catch (_) {}

  // Compose a human-friendly version string, updating with every commit
  // Examples: "1.0.0+123-abc1234" or "123-abc1234" if no package version
  let appVersion = '';
  if (commitCount && shortSha) appVersion = `${pkgVersion ? pkgVersion + '+' : ''}${commitCount}-${shortSha}`;
  else if (shortSha) appVersion = `${pkgVersion ? pkgVersion + '+' : ''}${shortSha}`;
  else appVersion = pkgVersion;

  // Database URL info (be careful exposing secrets)
  const rawDbUrl = process.env.DATABASE_URL || null;
  const safeDb = (() => {
    if (!rawDbUrl) return { url: null, safe: null };
    try {
      const u = new URL(rawDbUrl);
      const safeAuth = u.username ? `${u.username}${u.password ? ':*****' : ''}@` : '';
      const safe = `${u.protocol}//${safeAuth}${u.host}${u.pathname}${u.search}${u.hash}`;
      return { url: rawDbUrl, safe };
    } catch (_) {
      // Fallback simple mask for non-standard URLs
      return { url: rawDbUrl, safe: rawDbUrl.replace(/:\w+@/, ':*****@') };
    }
  })();

  return {
    appVersion,
    version: appVersion, // alias for clients expecting `version`
    details: {
      pkgVersion,
      commitCount: commitCount ? Number(commitCount) : null,
      commit: shortSha || null,
      branch: branch || null,
      tag: tag || null,
      buildTime: buildTime || null,
      db: safeDb,
    },
  };
}

// Public endpoint: no auth required
router.get('/version', (_req, res) => {
  const info = buildVersionInfo();
  res.json(info);
});

// Stateless apps con Basic Auth no mantienen sesión en el servidor.
// Este endpoint existe solo como conveniencia para UIs/operadores.
router.get('/logout', (_req, res) => {
  res.json({ ok: true, message: 'Logout: borra tus credenciales en el cliente.' });
});

module.exports = router;
