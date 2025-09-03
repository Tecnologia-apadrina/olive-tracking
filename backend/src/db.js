const { newDb } = require('pg-mem');

// Create an in-memory PostgreSQL instance
const db = newDb();

// Define schema and tables
// Each table includes an id_usuario field to track the creator

db.public.none(`
  CREATE TABLE IF NOT EXISTS parcelas (
    id SERIAL PRIMARY KEY,
    nombre TEXT,
    id_usuario INTEGER
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
`);

module.exports = db;
