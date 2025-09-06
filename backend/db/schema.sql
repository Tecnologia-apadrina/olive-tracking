-- Esquema de base de datos para Trazoliva
-- Ejecuta con: psql "$DATABASE_URL" -f backend/db/schema.sql

-- Tablas base (equivalentes a SCHEMA_SQL_BASE en backend/src/db.js)
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

-- Migraciones Postgres (equivalentes a SCHEMA_SQL_ALTER)
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

-- (Opcional) Ajuste de secuencias al máximo id actual
DO $$
BEGIN
  PERFORM setval(pg_get_serial_sequence('parcelas','id'), COALESCE((SELECT max(id) FROM parcelas), 0));
  PERFORM setval(pg_get_serial_sequence('palots','id'),   COALESCE((SELECT max(id) FROM palots),   0));
  PERFORM setval(pg_get_serial_sequence('olivos','id'),   COALESCE((SELECT max(id) FROM olivos),   0));
  PERFORM setval(pg_get_serial_sequence('users','id'),    COALESCE((SELECT max(id) FROM users),    0));
  PERFORM setval(pg_get_serial_sequence('parcelas_palots','id'), COALESCE((SELECT max(id) FROM parcelas_palots), 0));
EXCEPTION WHEN undefined_table THEN
  -- Ignora si la tabla aún no existe
  NULL;
END $$;

