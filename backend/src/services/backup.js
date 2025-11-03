const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs/promises');

const DEFAULT_BACKUP_DIR = process.env.DB_BACKUP_DIR || path.join(process.cwd(), 'backups');
const DEFAULT_LOG_FILE = process.env.DB_BACKUP_LOG || path.join(process.cwd(), 'logs', 'backup.log');
const DEFAULT_HOUR = Number.isFinite(Number(process.env.DB_BACKUP_HOUR))
  ? Number(process.env.DB_BACKUP_HOUR)
  : 0;
const DEFAULT_MINUTE = Number.isFinite(Number(process.env.DB_BACKUP_MINUTE))
  ? Number(process.env.DB_BACKUP_MINUTE)
  : 0;
const CONNECTION_STRING = process.env.DATABASE_URL || '';

let schedulerStarted = false;
let scheduledTimer = null;

async function appendLogLine(logFile, level, message, error) {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level}] ${message}`;
  const detail = error
    ? error instanceof Error
      ? error.stack || error.message
      : String(error)
    : '';
  const line = detail ? `${base} | ${detail}\n` : `${base}\n`;

  await fs.mkdir(path.dirname(logFile), { recursive: true });
  await fs.appendFile(logFile, line);
}

function persistLogSafe(logFile, level, message, error) {
  appendLogLine(logFile, level, message, error).catch((logErr) => {
    console.error('[backup] No se pudo escribir en el archivo de log', logErr);
  });
}

const runPgDump = (args) => new Promise((resolve, reject) => {
  execFile('pg_dump', args, { env: process.env }, (error, stdout, stderr) => {
    if (error) {
      const err = new Error(stderr || error.message);
      err.cause = error;
      reject(err);
    } else {
      resolve(stdout);
    }
  });
});

const sanitizeTimestamp = (date) => date.toISOString().replace(/[:.]/g, '-');

async function runBackup({
  connectionString = CONNECTION_STRING,
  outputDir = DEFAULT_BACKUP_DIR,
  logFile = DEFAULT_LOG_FILE,
} = {}) {
  if (!connectionString) {
    throw new Error('DATABASE_URL no está configurada; no se puede ejecutar pg_dump');
  }

  const timestamp = sanitizeTimestamp(new Date());
  const fileName = `backup-${timestamp}.dump`;
  const destinationDir = path.resolve(outputDir);
  const filePath = path.join(destinationDir, fileName);

  await fs.mkdir(destinationDir, { recursive: true });

  const args = [`--dbname=${connectionString}`, '--format=custom', `--file=${filePath}`];

  await runPgDump(args);
  const message = `[backup] Copia de seguridad creada en ${filePath}`;
  console.log(message);
  persistLogSafe(logFile, 'INFO', message);

  return { fileName, filePath };
}

function computeDelayMs(hour, minute) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function scheduleNextRun(hour, minute, connectionString, outputDir, logFile) {
  const delay = computeDelayMs(hour, minute);
  if (scheduledTimer) clearTimeout(scheduledTimer);
  scheduledTimer = setTimeout(async () => {
    try {
      await runBackup({ connectionString, outputDir, logFile });
    } catch (err) {
      console.error('[backup] Error al ejecutar la copia de seguridad', err);
      persistLogSafe(logFile, 'ERROR', '[backup] Error al ejecutar la copia de seguridad', err);
    } finally {
      scheduleNextRun(hour, minute, connectionString, outputDir, logFile);
    }
  }, delay);
  if (typeof scheduledTimer.unref === 'function') {
    scheduledTimer.unref();
  }
}

function startDailyBackups({
  connectionString = CONNECTION_STRING,
  outputDir = DEFAULT_BACKUP_DIR,
  hour = DEFAULT_HOUR,
  minute = DEFAULT_MINUTE,
  logFile = DEFAULT_LOG_FILE,
} = {}) {
  if (schedulerStarted) return;
  schedulerStarted = true;

  if (!connectionString) {
    console.warn('[backup] Scheduler deshabilitado: falta DATABASE_URL');
    persistLogSafe(logFile, 'WARN', '[backup] Scheduler deshabilitado: falta DATABASE_URL');
    return;
  }

  const safeHour = Number.isFinite(hour) ? hour : 0;
  const safeMinute = Number.isFinite(minute) ? minute : 0;
  const paddedHour = String(safeHour).padStart(2, '0');
  const paddedMinute = String(safeMinute).padStart(2, '0');

  scheduleNextRun(safeHour, safeMinute, connectionString, outputDir, logFile);
  const startMessage = `[backup] Copia diaria programada a las ${paddedHour}:${paddedMinute} en ${path.resolve(outputDir)}`;
  console.log(startMessage);
  persistLogSafe(logFile, 'INFO', startMessage);
}

module.exports = {
  runBackup,
  startDailyBackups,
};
