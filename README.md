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

## Despliegue con Docker (producción)

Se incluye una orquestación con Docker Compose que levanta:
- `db`: Postgres 16
- `backend`: API Node en `:3000`
- `web`: Nginx sirviendo el frontend compilado en `:80` y proxy `/api` al backend

Arquitectura:
- El frontend usa por defecto `'/api'` como base de la API. Nginx reescribe `/api/*` hacia el backend y elimina el prefijo.
- El backend expone rutas sin prefijo (p. ej. `/palots`, `/users`, …) y escucha en `:3000`.

Pasos:
1) Configura variables (opcional) creando un `.env` en la raíz con:
   - `POSTGRES_DB=trazoliva`
   - `POSTGRES_USER=trazo`
   - `POSTGRES_PASSWORD=trazo`
   - `ADMIN_USER=admin` (opcional)
   - `ADMIN_PASS=admin` (opcional)
   - `VITE_API_URL=` (déjalo vacío para usar el proxy `/api`)

2) Construye e inicia en segundo plano:
   - `docker compose build`
   - `docker compose up -d`

3) Accede a la app en tu servidor: `http://<tu_host>` (puerto 80).

Importar CSVs dentro de Postgres en Docker:
- Copia los CSVs al contenedor `db` o monta un volumen y ejecuta `psql` apuntando a `DATABASE_URL=postgres://<user>:<pass>@db:5432/<db>`.

Notas operativas:
- Para un backup del volumen de datos: `docker run --rm -v olive_pgdata:/var/lib/postgresql/data -v "$PWD":/backup alpine tar czf /backup/pgdata.tgz -C / var/lib/postgresql/data`.
- Para logs: `docker compose logs -f backend` y `docker compose logs -f web`.
- Para actualizar: `docker compose pull && docker compose up -d --build`.
