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
   - `COMMIT_SHA=$(git rev-parse --short HEAD) BUILD_TIME=$(date -Is) docker compose build`
   - `docker compose up -d`

3) Accede a la app en tu servidor: `http://<tu_host>` (puerto 80).

Importar CSVs dentro de Postgres en Docker:
- Copia los CSVs al contenedor `db` o monta un volumen y ejecuta `psql` apuntando a `DATABASE_URL=postgres://<user>:<pass>@db:5432/<db>`.

Notas operativas:
- Para un backup del volumen de datos: `docker run --rm -v olive_pgdata:/var/lib/postgresql/data -v "$PWD":/backup alpine tar czf /backup/pgdata.tgz -C / var/lib/postgresql/data`.
- Para logs: `docker compose logs -f backend` y `docker compose logs -f web`.
- Para actualizar: `docker compose pull && docker compose up -d --build`.

### Autenticación y proxy en el contenedor `web`

- El contenedor `web` (Nginx) proxy la API a `backend:3000` en la ruta `/api`.
- Se reenvía explícitamente la cabecera `Authorization` hacia el backend (Basic Auth):
  - Configuración en `frontend/nginx.conf`:
    - `proxy_set_header Authorization $http_authorization;`
- Si cambias esta configuración, reconstruye solo el `web` y reinícialo:
  - `docker compose build web && docker compose up -d web`
- Recarga dura el navegador (Ctrl+F5) para evitar caché del service worker.

### Comprobaciones rápidas (Docker)

- Probar versión: `curl http://localhost/api/version`
- Probar autenticación (admin/admin por defecto):
  - `B64=$(printf 'admin:admin' | base64)`
  - `curl -H "Authorization: Basic $B64" http://localhost/api/me`
  - Debe responder `{ "role": "admin", ... }`. Si no, revisa `docker compose logs -f web backend`.

### Base de datos en Docker

- La BD en Docker es un Postgres propio (servicio `db`) con su volumen `pgdata`; no es tu Postgres local.
- El backend en Docker se conecta a: `postgres://trazo:trazo@db:5432/trazoliva` (valores por defecto del `.env` raíz).
- Usuario admin inicial en esa BD:
  - Se siembra al arrancar `backend` con `ADMIN_USER`/`ADMIN_PASS` (por defecto `admin/admin`).
  - Cambia estas variables en tu `.env` raíz si quieres un admin distinto antes de levantar los contenedores.

Conectar a la BD del contenedor:
- Opción 1: shell dentro del contenedor
  - `docker compose exec -it db psql -U ${POSTGRES_USER:-trazo} -d ${POSTGRES_DB:-trazoliva}`
- Opción 2: exponer el puerto 5432 al host (para conectar con tu psql/GUI)
  - Añade en `services.db` de `docker-compose.yml`:
    - `ports: ["5432:5432"]`
  - Reinicia solo la BD: `docker compose up -d db`

Importar CSVs en la BD de Docker:
- Usa `docker compose exec -T db psql -U ${POSTGRES_USER:-trazo} -d ${POSTGRES_DB:-trazoliva} -v PARCELAS=/ruta -v PALOTS=/ruta -v OLIVOS=/ruta -f /app/backend/db/import.psql` tras copiar los CSVs dentro del contenedor o montar un volumen.

## Versionado de la app

- El frontend muestra la versión en el pie: hace `GET /api/version` al backend.
- El backend compone una versión basada en Git y en el `package.json` del backend:
  - Formato: `X.Y.Z+<conteoCommits>-<shaCorto>` (ej.: `1.0.0+123-abc1234`).
  - Si no hay Git disponible (imagen ya compilada), usa variables de build `COMMIT_SHA` y `BUILD_TIME` cuando están presentes.

Desarrollo local (sin Docker):
- Backend en memoria (sin Postgres): `cd backend && npm run dev:mem`
- Frontend: `cd frontend && npm run dev` (Vite proxya `/api` → `http://localhost:3000`).
- Usuario inicial: `admin/admin`.

Producción con Docker:
- Pasa los argumentos de build para que la imagen tenga la referencia del commit y fecha de compilación:
  - `COMMIT_SHA=$(git rev-parse --short HEAD) BUILD_TIME=$(date -Is) docker compose build`
- `docker-compose.yml` ya reenvía estos ARGs al `Dockerfile` del backend.
 - El servicio `backend` ahora expone `3000:3000` para pruebas desde el host.

### Desarrollo local vs Docker

- Local (Vite + backend memoria):
  - `cd backend && npm run dev:mem`
  - `cd frontend && npm run dev` (Vite proxya `/api` a `http://localhost:3000`).
- Docker (Nginx + backend + Postgres):
  - `docker compose up -d --build` y accede a `http://localhost`.
  - No uses el servidor de Vite en este modo; Nginx ya sirve el frontend y proxya `/api`.
