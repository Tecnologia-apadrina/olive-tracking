const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function getPkgVersion() {
  try {
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    const raw = fs.readFileSync(pkgPath, 'utf8');
    return JSON.parse(raw).version || '0.0.0';
  } catch (_) {
    return '0.0.0';
  }
}

function getGitSha() {
  if (process.env.COMMIT_SHA) return process.env.COMMIT_SHA;
  try {
    const out = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'], cwd: path.join(__dirname, '..', '..', '..') });
    return String(out).trim();
  } catch (_) {
    try {
      const out = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] });
      return String(out).trim();
    } catch (_) {
      return 'unknown';
    }
  }
}

function getBuildTime() {
  return process.env.BUILD_TIME || new Date().toISOString();
}

function getAppVersion() {
  const pkg = getPkgVersion();
  const sha = getGitSha();
  return `${pkg}+${sha}`;
}

function versionInfo() {
  const version = getPkgVersion();
  const commit = getGitSha();
  const buildTime = getBuildTime();
  const appVersion = `${version}+${commit}`;
  return { version, commit, buildTime, appVersion };
}

module.exports = { versionInfo };

