const { newDb } = require('pg-mem');
const { Pool } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS parcelas (
    id SERIAL PRIMARY KEY,
    nombre TEXT,
    id_usuario INTEGER,
    sigpac_municipio TEXT,
    sigpac_poligono TEXT,
    sigpac_parcela TEXT,
    sigpac_recinto TEXT,
    variedad TEXT
  );

  CREATE TABLE IF NOT EXISTS olivos (
    id SERIAL PRIMARY KEY,
    id_parcela INTEGER REFERENCES parcelas(id),
    variedad TEXT,
    id_usuario INTEGER
  );

  CREATE TABLE IF NOT EXISTS palots (
    id SERIAL PRIMARY KEY,
    codigo TEXT,
    id_usuario INTEGER
  );

  CREATE TABLE IF NOT EXISTS parcelas_palots (
    id SERIAL PRIMARY KEY,
    id_parcela INTEGER REFERENCES parcelas(id),
    id_palot INTEGER REFERENCES palots(id),
    id_usuario INTEGER
  );
  -- Ensure new columns exist when table already created
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS sigpac_municipio TEXT;
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS sigpac_poligono TEXT;
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS sigpac_parcela TEXT;
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS sigpac_recinto TEXT;
  ALTER TABLE IF EXISTS parcelas ADD COLUMN IF NOT EXISTS variedad TEXT;
`;

const connectionString = process.env.DATABASE_URL;

if (connectionString) {
  // Use real Postgres via node-postgres
  const pool = new Pool({ connectionString });

  // Initialize schema on startup
  const init = async () => {
    await pool.query(SCHEMA_SQL);
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
  mem.public.none(SCHEMA_SQL);

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
