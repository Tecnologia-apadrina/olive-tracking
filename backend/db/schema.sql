-- olive-tracking production schema and initial admin user
-- Usage:
--   psql "$DATABASE_URL" -f backend/db/schema.sql

BEGIN;

-- Core tables
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

-- Authentication
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user'
);

-- Seed Admin user (password: Diagnoses5-Hazard3)
-- Hash format matches backend/src/utils/password.js (scrypt)
INSERT INTO users(username, password_hash, role)
VALUES (
  'admin',
  'scrypt:a4dc7af3f18e848e43ab90055e4db946:d279da4190805905526b5e4c017d5de38f078998feee086a01b24738499c7f210bb791494416c0c50935ce77f1e6710a2973301949bbae8a2f8f0550ee2ebee6',
  'admin'
)
ON CONFLICT (username) DO NOTHING;

COMMIT;

