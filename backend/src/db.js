const { newDb } = require('pg-mem');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const { hashPassword } = require('./utils/password');
dotenv.config();

// Base schema (compatible with pg-mem): only CREATE TABLE statements.
const SCHEMA_SQL_BASE = `
  CREATE TABLE IF NOT EXISTS parajes (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    country_code TEXT NOT NULL DEFAULT 'ES',
    UNIQUE(nombre, country_code)
  );

  CREATE TABLE IF NOT EXISTS parcelas (
    id SERIAL PRIMARY KEY,
    nombre TEXT,
    nombre_interno TEXT,
    country_code TEXT NOT NULL DEFAULT 'ES',
    sigpac_municipio TEXT,
    sigpac_poligono TEXT,
    sigpac_parcela TEXT,
    sigpac_recinto TEXT,
    variedad TEXT,
    porcentaje NUMERIC,
    num_olivos INTEGER,
    hectareas NUMERIC,
    paraje_id INTEGER REFERENCES parajes(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS olivos (
    id SERIAL PRIMARY KEY,
    id_parcela INTEGER REFERENCES parcelas(id),
    country_code TEXT NOT NULL DEFAULT 'ES'
  );

  CREATE TABLE IF NOT EXISTS palots (
    id SERIAL PRIMARY KEY,
    codigo TEXT,
    id_usuario INTEGER,
    kgs NUMERIC,
    procesado BOOLEAN DEFAULT false,
    country_code TEXT NOT NULL DEFAULT 'ES'
  );

  CREATE TABLE IF NOT EXISTS parcelas_palots (
    id SERIAL PRIMARY KEY,
    id_parcela INTEGER REFERENCES parcelas(id),
    id_palot INTEGER REFERENCES palots(id),
    id_usuario INTEGER,
    kgs NUMERIC,
    reservado_aderezo BOOLEAN DEFAULT false,
    notas TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    country_code TEXT NOT NULL DEFAULT 'ES'
  );

  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'campo',
    country_code TEXT NOT NULL DEFAULT 'ES'
  );

  CREATE TABLE IF NOT EXISTS etiquetas (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    country_code TEXT NOT NULL DEFAULT 'ES',
    UNIQUE(nombre, country_code)
  );

  CREATE TABLE IF NOT EXISTS parcelas_etiquetas (
    id_parcela INTEGER REFERENCES parcelas(id) ON DELETE CASCADE,
    id_etiqueta INTEGER REFERENCES etiquetas(id) ON DELETE CASCADE,
    PRIMARY KEY (id_parcela, id_etiqueta)
  );

  CREATE TABLE IF NOT EXISTS activity_types (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    icono TEXT DEFAULT '',
    country_code TEXT NOT NULL DEFAULT 'ES',
    UNIQUE(nombre, country_code)
  );

  CREATE TABLE IF NOT EXISTS parcela_activities (
    id SERIAL PRIMARY KEY,
    parcela_id INTEGER REFERENCES parcelas(id) ON DELETE CASCADE,
    olivo_id INTEGER REFERENCES olivos(id) ON DELETE SET NULL,
    activity_type_id INTEGER REFERENCES activity_types(id) ON DELETE RESTRICT,
    personas INTEGER,
    notas TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    country_code TEXT NOT NULL DEFAULT 'ES'
  );

  CREATE INDEX IF NOT EXISTS idx_parcela_activities_parcela ON parcela_activities(parcela_id);
  CREATE INDEX IF NOT EXISTS idx_parcela_activities_created_at ON parcela_activities(created_at);

  CREATE TABLE IF NOT EXISTS odoo_configs (
    id SERIAL PRIMARY KEY,
    url TEXT NOT NULL,
    db_name TEXT NOT NULL,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    country_code TEXT NOT NULL DEFAULT 'ES',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(country_code)
  );

  CREATE TABLE IF NOT EXISTS odoo_parcelas (
    id INTEGER NOT NULL,
    name TEXT,
    common_name TEXT,
    company TEXT,
    contract_percentage NUMERIC,
    notes TEXT,
    country_code TEXT NOT NULL DEFAULT 'ES',
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (id, country_code)
  );

  CREATE TABLE IF NOT EXISTS odoo_parcel_sigpacs (
    id INTEGER NOT NULL,
    parcel_id INTEGER NOT NULL,
    municipio TEXT,
    poligono TEXT,
    parcela TEXT,
    recinto TEXT,
    country_code TEXT NOT NULL DEFAULT 'ES',
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (id, country_code)
  );
  CREATE INDEX IF NOT EXISTS idx_odoo_parcel_sigpacs_parcel_country ON odoo_parcel_sigpacs(parcel_id, country_code);
`;

// Postgres-only migrations to evolve existing DBs.
const SCHEMA_SQL_ALTER = `
  CREATE TABLE IF NOT EXISTS parajes (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    UNIQUE(nombre)
  );
  ALTER TABLE IF EXISTS parajes DROP COLUMN IF EXISTS propietario;
  ALTER TABLE IF EXISTS parajes ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'ES';
  ALTER TABLE IF EXISTS parajes DROP CONSTRAINT IF EXISTS parajes_nombre_key;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_parajes_nombre_country ON parajes(nombre, country_code);
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS sigpac_municipio TEXT;
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS sigpac_poligono TEXT;
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS sigpac_parcela TEXT;
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS sigpac_recinto TEXT;
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS variedad TEXT;
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS nombre_interno TEXT;
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS porcentaje NUMERIC;
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS num_olivos INTEGER;
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS hectareas NUMERIC;
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'ES';
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS paraje_id INTEGER REFERENCES parajes(id) ON DELETE SET NULL;
  ALTER TABLE IF EXISTS parcelas DROP COLUMN IF EXISTS id_usuario;
  ALTER TABLE IF EXISTS parcelas_palots ADD COLUMN IF NOT EXISTS kgs NUMERIC;
  ALTER TABLE IF EXISTS parcelas_palots ADD COLUMN IF NOT EXISTS reservado_aderezo BOOLEAN DEFAULT false;
  ALTER TABLE IF EXISTS parcelas_palots ADD COLUMN IF NOT EXISTS notas TEXT;
  ALTER TABLE IF EXISTS parcelas_palots ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
  ALTER TABLE IF EXISTS parcelas_palots ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'ES';
  ALTER TABLE IF EXISTS palots ADD COLUMN IF NOT EXISTS kgs NUMERIC;
  ALTER TABLE IF EXISTS palots ADD COLUMN IF NOT EXISTS procesado BOOLEAN DEFAULT false;
  ALTER TABLE IF EXISTS palots ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'ES';
  ALTER TABLE IF EXISTS olivos DROP COLUMN IF EXISTS variedad;
  ALTER TABLE IF EXISTS olivos DROP COLUMN IF EXISTS id_usuario;
  ALTER TABLE IF EXISTS olivos ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'ES';
  ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'ES';
  CREATE TABLE IF NOT EXISTS etiquetas (
    id SERIAL PRIMARY KEY,
    nombre TEXT UNIQUE NOT NULL
  );
  ALTER TABLE IF EXISTS etiquetas ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'ES';
  ALTER TABLE IF EXISTS etiquetas DROP CONSTRAINT IF EXISTS etiquetas_nombre_key;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_etiquetas_nombre_country ON etiquetas(nombre, country_code);
  CREATE TABLE IF NOT EXISTS parcelas_etiquetas (
    id_parcela INTEGER REFERENCES parcelas(id) ON DELETE CASCADE,
    id_etiqueta INTEGER REFERENCES etiquetas(id) ON DELETE CASCADE,
    PRIMARY KEY (id_parcela, id_etiqueta)
  );
  CREATE TABLE IF NOT EXISTS activity_types (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    icono TEXT DEFAULT '',
    UNIQUE(nombre)
  );
  ALTER TABLE IF EXISTS activity_types ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'ES';
  ALTER TABLE IF EXISTS activity_types DROP CONSTRAINT IF EXISTS activity_types_nombre_key;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_types_nombre_country ON activity_types(nombre, country_code);
  CREATE TABLE IF NOT EXISTS parcela_activities (
    id SERIAL PRIMARY KEY,
    parcela_id INTEGER REFERENCES parcelas(id) ON DELETE CASCADE,
    olivo_id INTEGER REFERENCES olivos(id) ON DELETE SET NULL,
    activity_type_id INTEGER REFERENCES activity_types(id) ON DELETE RESTRICT,
    personas INTEGER,
    notas TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  ALTER TABLE IF EXISTS parcela_activities ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'ES';
  CREATE INDEX IF NOT EXISTS idx_parcela_activities_parcela ON parcela_activities(parcela_id);
  CREATE INDEX IF NOT EXISTS idx_parcela_activities_created_at ON parcela_activities(created_at);

  CREATE TABLE IF NOT EXISTS odoo_configs (
    id SERIAL PRIMARY KEY,
    url TEXT NOT NULL,
    db_name TEXT NOT NULL,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    country_code TEXT NOT NULL DEFAULT 'ES',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(country_code)
  );

  CREATE TABLE IF NOT EXISTS odoo_parcelas (
    id INTEGER NOT NULL,
    name TEXT,
    common_name TEXT,
    company TEXT,
    contract_percentage NUMERIC,
    notes TEXT,
    country_code TEXT NOT NULL DEFAULT 'ES',
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (id, country_code)
  );

  CREATE TABLE IF NOT EXISTS odoo_parcel_sigpacs (
    id INTEGER NOT NULL,
    parcel_id INTEGER NOT NULL,
    municipio TEXT,
    poligono TEXT,
    parcela TEXT,
    recinto TEXT,
    country_code TEXT NOT NULL DEFAULT 'ES',
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (id, country_code)
  );
  CREATE INDEX IF NOT EXISTS idx_odoo_parcel_sigpacs_parcel_country ON odoo_parcel_sigpacs(parcel_id, country_code);
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
    const adminCountry = (process.env.ADMIN_COUNTRY || 'ES').toUpperCase();
    await pool.query(
      `INSERT INTO users(username, password_hash, role, country_code)
       VALUES($1, $2, 'admin', $3)
       ON CONFLICT (username) DO NOTHING`,
      [adminUser, hash, adminCountry]
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
    const adminCountry = (process.env.ADMIN_COUNTRY || 'ES').toUpperCase();
    mem.public.none(
      `INSERT INTO users(username, password_hash, role, country_code)
       VALUES('${esc(adminUser)}', '${esc(hash)}', 'admin', '${esc(adminCountry)}')`
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
