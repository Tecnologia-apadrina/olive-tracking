# olive-tracking

Aplicación PWA para gestionar la cosecha de olivas y la relación parcela-palot.

## Estructura del proyecto
- **frontend**: React + Vite.
- **backend**: API Node.js con Express.

Cada directorio contiene su propio `package.json`. Instala dependencias con `npm install` y usa `npm run dev`/`npm start` según corresponda.

## Importación masiva (CSV)
Usa psql con `\copy` para cargar CSVs de `parcelas`, `palots` y `olivos` de forma muy rápida.

Requisitos:
- Tener Postgres accesible y `DATABASE_URL` configurado (ver `backend/.env`).
- CSVs en UTF-8 con cabecera.

Formatos esperados:
- parcelas.csv: `id,nombre`
- palots.csv: `id,codigo` (si tu CSV solo trae `codigo`, ajusta las columnas en el script)
- olivos.csv: `id,id_parcela,variedad` (si no tienes `variedad`, usa solo `id,id_parcela` y ajusta columnas)

Comando de importación:
- `psql "$DATABASE_URL" -v PARCELAS=/ruta/parcelas.csv -v PALOTS=/ruta/palots.csv -v OLIVOS=/ruta/olivos.csv -f backend/db/import.psql`

Notas:
- El script ajusta las secuencias (`serial`) al máximo `id` importado.
- Respeta FKs: importa primero `parcelas`, luego `palots`, y por último `olivos`.
- Si usas Docker para Postgres y no tienes `psql` en el host, puedes copiar los CSVs al contenedor y ejecutar `psql` dentro:
  - `docker cp parcelas.csv olive-pg:/tmp/parcelas.csv`
  - `docker cp palots.csv olive-pg:/tmp/palots.csv`
  - `docker cp olivos.csv olive-pg:/tmp/olivos.csv`
  - `docker exec -e PGPASSWORD=postgres -it olive-pg psql -U postgres -d olive -v PARCELAS=/tmp/parcelas.csv -v PALOTS=/tmp/palots.csv -v OLIVOS=/tmp/olivos.csv -f /app/backend/db/import.psql`
  - Asegúrate de que la ruta del repositorio esté montada en el contenedor o copia también `backend/db/import.psql`.
