# olive-tracking

Aplicación PWA para gestionar la relación parcela-palot durante la cosecha de olivas. El flujo está pensado para funcionar **siempre desplegado con Docker Compose**: Nginx sirve el frontend compilado, Express expone la API y Postgres almacena los datos.

## Características principales
- Frontend React + Vite empaquetado como PWA con modo offline, sincronización manual y gestión de cola mientras no hay red.
- Backend Node.js (Express) protegido con Basic Auth y endpoints para parcelas, palots, relaciones y usuarios.
- Postgres 16 como base de datos; scripts de importación masiva mediante `psql`.
- Service worker con cacheo de shell, indicador de relaciones pendientes y botón de sincronizar.

## Requisitos previos
- Docker 20+ y Docker Compose v2.
- (`opcional`) Crear un archivo `.env` en la raíz para sobreescribir variables por defecto:
  ```env
  POSTGRES_DB=trazoliva
  POSTGRES_USER=trazo
  POSTGRES_PASSWORD=trazo
  ADMIN_USER=admin
  ADMIN_PASS=admin
  VITE_API_URL=
  ```

## Puesta en marcha con Docker
1. Construye las imágenes pasando metadatos del commit (recomendado):
   ```bash
   COMMIT_SHA=$(git rev-parse --short HEAD)
   BUILD_TIME=$(date -Is)
   COMMIT_SHA=$COMMIT_SHA BUILD_TIME=$BUILD_TIME docker compose build
   ```
2. Levanta toda la pila:
   ```bash
   docker compose up -d
   ```
3. Accede al frontend en `http://localhost` (o el host donde ejecutes los contenedores). La API queda expuesta en `http://localhost/api/*` a través del proxy de Nginx.
4. Usuario inicial (sembrado por el backend): `admin / admin`. Cámbialo tras el primer acceso.

### Servicios que levanta `docker compose`
- `db`: Postgres 16 con volumen `olive_pgdata`.
- `backend`: API Node escuchando en `:3000` (expuesto como `localhost:3000` por si necesitas pruebas).
- `web`: Nginx sirviendo el build de Vite y reenviando `/api` → `backend:3000`.

## Actualización y despliegues posteriores
- Para reconstruir tras cambios locales: `docker compose up -d --build`.
- Para actualizar desde Git: `git pull && docker compose up -d --build` (se reutilizará el volumen de la base de datos).
- Logs en vivo: `docker compose logs -f web backend db`.
- Parar la pila: `docker compose down` (no elimina los volúmenes).

## Importación de datos (CSV)
El backend incluye `backend/db/import.psql` para cargar `parcelas`, `palots` y `olivos` rápidamente.

1. Copia los CSV dentro del contenedor de la base de datos o monta un volumen con ellos.
2. Ejecuta el script desde el host:
   ```bash
   docker compose exec -T db psql \
     -U ${POSTGRES_USER:-trazo} \
     -d ${POSTGRES_DB:-trazoliva} \
     -v PARCELAS=/tmp/parcelas.csv \
     -v PALOTS=/tmp/palots.csv \
     -v OLIVOS=/tmp/olivos.csv \
     -f /app/backend/db/import.psql
   ```

Notas:
- Importa primero `parcelas`, después `palots` y por último `olivos` para respetar claves foráneas.
- El script ajusta las secuencias (`serial`) al mayor `id` presente.

## Comandos útiles dentro del stack Docker
- Tests backend: `docker compose exec backend npm test` (requiere Postgres operativo).
- Shell en la base de datos: `docker compose exec -it db psql -U ${POSTGRES_USER:-trazo} -d ${POSTGRES_DB:-trazoliva}`.
- Backup completo del volumen de Postgres:
  ```bash
  docker run --rm -v olive_pgdata:/var/lib/postgresql/data -v "$PWD":/backup alpine \
    tar czf /backup/pgdata.tgz -C / var/lib/postgresql/data
  ```

## Endpoints y autenticación
- La API está bajo `/api/*` vía Nginx. Ejemplo de comprobación:
  ```bash
  curl http://localhost/api/version
  ```
- Basic Auth por defecto `admin/admin` (cambia `ADMIN_USER` y `ADMIN_PASS` antes de desplegar si quieres otras credenciales). Para probar:
  ```bash
  B64=$(printf 'admin:admin' | base64)
  curl -H "Authorization: Basic $B64" http://localhost/api/me
  ```

## Funcionamiento offline y sincronización
- El frontend guarda en IndexedDB las tablas relevantes y muestra el número de operaciones pendientes.
- Puedes forzar una sincronización con el botón “Sincronizar”. El estado (en línea, pendientes, última sync) aparece en la parte superior.
- Las relaciones añadidas sin conexión se muestran con badge “Pendiente de sincronización” y se envían cuando vuelve la red.

## Desarrollo local (opcional)
Aunque el flujo recomendado es Docker, sigue disponible el modo local:
- API en memoria: `cd backend && npm run dev:mem`.
- Frontend Vite: `cd frontend && npm run dev` (proxy `/api` → `http://localhost:3000`).
Usa este modo solo para depurar rápidamente; para cualquier despliegue/QA, trabaja sobre la pila de Docker para replicar producción.

---
Mantén este README como referencia para la puesta en marcha y las tareas operativas básicas. Cualquier cambio en la infraestructura (por ejemplo, nuevos servicios de Docker Compose) debería reflejarse aquí.
