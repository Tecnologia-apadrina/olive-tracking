const { newDb } = require('pg-mem');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const { hashPassword } = require('./utils/password');
dotenv.config();

// Base schema (compatible with pg-mem): only CREATE TABLE statements.
const SCHEMA_SQL_BASE = `
  CREATE TABLE IF NOT EXISTS parcelas (
    id SERIAL PRIMARY KEY,
    nombre TEXT,
    nombre_interno TEXT,
    sigpac_municipio TEXT,
    sigpac_poligono TEXT,
    sigpac_parcela TEXT,
    sigpac_recinto TEXT,
    variedad TEXT,
    porcentaje NUMERIC
  );

  CREATE TABLE IF NOT EXISTS olivos (
    id SERIAL PRIMARY KEY,
    id_parcela INTEGER REFERENCES parcelas(id)
  );

  CREATE TABLE IF NOT EXISTS palots (
    id SERIAL PRIMARY KEY,
    codigo TEXT,
    id_usuario INTEGER,
    kgs NUMERIC
  );

  CREATE TABLE IF NOT EXISTS parcelas_palots (
    id SERIAL PRIMARY KEY,
    id_parcela INTEGER REFERENCES parcelas(id),
    id_palot INTEGER REFERENCES palots(id),
    id_usuario INTEGER,
    kgs NUMERIC,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user'
  );
`;

// Postgres-only migrations to evolve existing DBs.
const SCHEMA_SQL_ALTER = `
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS sigpac_municipio TEXT;
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS sigpac_poligono TEXT;
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS sigpac_parcela TEXT;
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS sigpac_recinto TEXT;
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS variedad TEXT;
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS nombre_interno TEXT;
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS porcentaje NUMERIC;
  ALTER TABLE IF EXISTS parcelas DROP COLUMN IF EXISTS id_usuario;
  ALTER TABLE IF EXISTS parcelas_palots ADD COLUMN IF NOT EXISTS kgs NUMERIC;
  ALTER TABLE IF EXISTS parcelas_palots ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
  ALTER TABLE IF EXISTS palots ADD COLUMN IF NOT EXISTS kgs NUMERIC;
  ALTER TABLE IF EXISTS olivos DROP COLUMN IF EXISTS variedad;
  ALTER TABLE IF EXISTS olivos DROP COLUMN IF EXISTS id_usuario;
`;

const forceMem = (process.env.USE_MEM || '').toLowerCase() === '1' || (process.env.USE_MEM || '').toLowerCase() === 'true';
const connectionString = forceMem ? '' : process.env.DATABASE_URL;

if (connectionString) {
  // Use real Postgres via node-postgres
  const pool = new Pool({ connectionString });

  // Initialize schema on startup
  const init = async () => {
    // Ensure base schema exists
    await pool.query(SCHEMA_SQL_BASE);
    // Apply Postgres-specific ALTERs for existing DBs
    await pool.query(SCHEMA_SQL_ALTER);
    // Seed admin user if not present
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPass = process.env.ADMIN_PASS || 'admin';
    const hash = hashPassword(adminPass);
    await pool.query(
      `INSERT INTO users(username, password_hash, role)
       VALUES($1, $2, 'admin')
       ON CONFLICT (username) DO NOTHING`,
      [adminUser, hash]
    );
  };
  // Fire and forget; routes will work even if this resolves slightly later
  init().catch((e) => console.error('DB init error:', e));

  const publicApi = {
    one: async (sql, params = []) => {
      const { rows } = await pool.query(sql, params);
      if (!rows[0]) throw new Error('No rows');
      return rows[0];
    },
    many: async (sql, params = []) => {
      const { rows } = await pool.query(sql, params);
      return rows;
    },
    none: async (sql, params = []) => {
      await pool.query(sql, params);
      return;
    },
  };

  module.exports = { public: publicApi, _pool: pool };
} else {
  // In-memory DB for dev/tests (pg-mem)
  const mem = newDb();
  // Only apply base schema for pg-mem (ALTER .. IF EXISTS not supported)
  mem.public.none(SCHEMA_SQL_BASE);
  try {
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPass = process.env.ADMIN_PASS || 'admin';
    const hash = hashPassword(adminPass);
    const esc = (s) => String(s).replace(/'/g, "''");
    mem.public.none(
      `INSERT INTO users(username, password_hash, role) VALUES('${esc(adminUser)}', '${esc(hash)}', 'admin')`
    );
  } catch (_) {}

  const publicApi = {
    one: async (sql, params = []) => mem.public.one(sql, params),
    many: async (sql, params = []) => {
      try {
        return mem.public.many(sql, params);
      } catch (e) {
        return [];
      }
    },
    none: async (sql, params = []) => mem.public.none(sql, params),
  };

  module.exports = { public: publicApi, _mem: mem };
}
