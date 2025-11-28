# olive-tracking

Aplicación PWA para gestionar la relación parcela-palot durante la cosecha de olivas. El flujo está pensado para funcionar **siempre desplegado con Docker Compose**: Nginx sirve el frontend compilado, Express expone la API y Postgres almacena los datos.

## Características principales (v1.3.0)
- Frontend React + Vite empaquetado como PWA con modo offline, sincronización manual y gestión de cola mientras no hay red.
- Búsqueda de olivo unificada: el campo principal usa exclusivamente los códigos sincronizados desde Odoo (con o sin ceros iniciales) y bloquea el guardado hasta resolver la parcela.
- Backend Node.js (Express) protegido con Basic Auth y endpoints para parcelas, palots, relaciones, usuarios, etiquetas y actividades.
- Registro de actividades de campo con catálogo de tipos personalizable (icono + nombre) y guardado offline.
- Postgres 16 como base de datos; scripts de importación masiva mediante `psql`.
- Service worker con cacheo de shell, indicador de relaciones pendientes y botón de sincronizar.

### Notas destacadas de la versión 1.3
- **Solución definitiva a los ceros a la izquierda:** tanto la API como la caché offline normalizan las referencias (`00140`, `140`, etc.) para que siempre se localice la parcela correspondiente.
- **Un único campo de búsqueda:** se retiró el input de “olivo antiguo”. Ahora el flujo depende al 100 % de los datos sincronizados desde Odoo, lo que evita desajustes entre fuentes.
- **Botón Guardar más seguro:** sólo se habilita cuando hay parcela válida, kgs informados y la búsqueda de Odoo ha terminado. Se bloquea también mientras existan palots pendientes sin guardar.
- **Actualización de versión:** backend y frontend pasan a `1.3.0` para que los despliegues identifiquen la nueva ergonomía.

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

### Checklist adicional para despliegues ≥ 1.3
1. **Reconstruye imágenes**: `docker compose up -d --build` para asegurarte de que el frontend 1.3 queda empaquetado.
2. **Sincroniza datos de Odoo**: entra con un usuario admin → menú “Administración” → “Sincronizar datos Odoo” y lanza la sincronización de parcelas/parajes/olivos. Esto rellena la caché usada por el nuevo buscador.
3. **Verifica acceso**: desde la vista principal comprueba que el campo “Nº de olivo (Odoo)” encuentra una parcela real (por ejemplo un código con ceros iniciales) y que el estado pasa a “Parcela: …”.
4. **Prueba guardado offline** (opcional): añade un palot sin conexión para confirmar que la cola y el nuevo bloqueo del campo se comportan como esperas.
5. **Documenta la versión desplegada**: puedes obtenerla con `curl http://<host>/api/version` (debe devolver `1.3.0`).

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
- Copia puntual vía API (requiere usuario admin):
  ```bash
  B64=$(printf 'admin:admin' | base64)
  curl -X POST \
    -H "Authorization: Basic $B64" \
    http://localhost/api/backup/run
  ```

### Copias de seguridad automáticas
- El backend genera una copia diaria mediante `pg_dump` a las 00:00 por defecto y la guarda en `./backups`.
- Puedes ajustar la hora/minuto con las variables `DB_BACKUP_HOUR` (0-23) y `DB_BACKUP_MINUTE` (0-59).
- Cambia el directorio destino usando `DB_BACKUP_DIR` (ruta absoluta o relativa al proyecto).
- Cada copia se guarda con el formato `backup-YYYY-MM-DDTHH-mm-ss.dump` lista para restaurar con `pg_restore`.

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
- El frontend guarda en IndexedDB las tablas relevantes (parcelas, olivos sincronizados desde Odoo, palots, actividades…).
- El buscador de olivos usa exclusivamente la caché de Odoo; si estás sin conexión sólo funcionará para registros descargados previamente.
- Puedes forzar una sincronización con el botón “Sincronizar”. El estado (en línea, pendientes, última sync) aparece en la parte superior.
- Las relaciones añadidas sin conexión se muestran con badge “Pendiente de sincronización” y se envían cuando vuelve la red.

## Registro de actividades en campo
- Nuevo apartado `/actividades` accesible desde la cabecera para registrar tareas realizadas sobre un olivo concreto indicando tipo de actividad, nº de personas y notas.
- El flujo funciona completamente offline: si no hay red, las actividades quedan en cola y se sincronizan cuando vuelva la conexión.
- Los roles `admin` y `metricas` pueden crear/editar/eliminar los tipos disponibles (nombre + icono) desde el apartado `/tipos-actividad`. Los demás usuarios pueden consultar la lista y registrar actividades con ellos.
- API expuesta:
  - `GET /activities` (filtros: `parcelaId`, `olivoId`, `limit`) y `POST /activities`.
  - `GET/POST/PUT/DELETE /activity-types` (alta/gestión exclusiva para `admin` o `metricas`).
- El snapshot de sincronización incluye los tipos y las últimas actividades para que siempre estén visibles incluso en modo offline.

## Desarrollo local (opcional)
Aunque el flujo recomendado es Docker, sigue disponible el modo local:
- API en memoria: `cd backend && npm run dev:mem`.
- Frontend Vite: `cd frontend && npm run dev` (proxy `/api` → `http://localhost:3000`).
Usa este modo solo para depurar rápidamente; para cualquier despliegue/QA, trabaja sobre la pila de Docker para replicar producción.

---
Mantén este README como referencia para la puesta en marcha y las tareas operativas básicas. Cualquier cambio en la infraestructura (por ejemplo, nuevos servicios de Docker Compose) debería reflejarse aquí.
