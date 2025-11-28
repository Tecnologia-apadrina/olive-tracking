import { openDB } from 'idb';

const DB_NAME = 'olive-tracking-offline';
const DB_VERSION = 6;

let dbPromise;

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta');
        }
        if (!db.objectStoreNames.contains('parcelas')) {
          db.createObjectStore('parcelas', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('olivos')) {
          const store = db.createObjectStore('olivos', { keyPath: 'id' });
          store.createIndex('byDefaultCode', 'default_code');
        } else if (oldVersion < 6) {
          try {
            const store = transaction.objectStore('olivos');
            if (!store.indexNames.contains('byDefaultCode')) {
              store.createIndex('byDefaultCode', 'default_code');
            }
          } catch (_) {
            // ignore index upgrade errors
          }
        }
        if (!db.objectStoreNames.contains('palots')) {
          const store = db.createObjectStore('palots', { keyPath: 'key' });
          store.createIndex('byCodigo', 'codigo');
        }
        if (!db.objectStoreNames.contains('relations')) {
          const store = db.createObjectStore('relations', { keyPath: 'key' });
          store.createIndex('byParcela', 'parcela_id');
          store.createIndex('byPalot', 'palot_codigo');
        }
        if (!db.objectStoreNames.contains('pendingOps')) {
          db.createObjectStore('pendingOps', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('tags')) {
          db.createObjectStore('tags', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('parajes')) {
          db.createObjectStore('parajes', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('activityTypes')) {
          db.createObjectStore('activityTypes', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('activities')) {
          const store = db.createObjectStore('activities', { keyPath: 'key' });
          store.createIndex('byParcela', 'parcela_id');
          store.createIndex('byCreatedAt', 'created_at');
        }
      }
    });
  }
  return dbPromise;
}

export async function initOfflineStore() {
  await getDb();
}

export async function clearAllOfflineData() {
  const db = await getDb();
  const stores = ['parcelas', 'olivos', 'palots', 'relations', 'pendingOps', 'tags', 'parajes', 'activityTypes', 'activities'];
  const tx = db.transaction(stores, 'readwrite');
  await Promise.all(stores.map(async (name) => tx.objectStore(name).clear()));
  await tx.done;
}

export async function saveAuthSession({ token, username, role, country }) {
  const db = await getDb();
  const tx = db.transaction('meta', 'readwrite');
  tx.store.put({ token, username, role, country, storedAt: new Date().toISOString() }, 'auth');
  await tx.done;
}

export async function loadAuthSession() {
  const db = await getDb();
  return db.transaction('meta').store.get('auth');
}

export async function clearAuthSession() {
  const db = await getDb();
  const tx = db.transaction('meta', 'readwrite');
  tx.store.delete('auth');
  await tx.done;
}

export async function loadMeta(key) {
  const db = await getDb();
  return db.transaction('meta').store.get(key);
}

export async function saveMeta(key, value) {
  const db = await getDb();
  const tx = db.transaction('meta', 'readwrite');
  tx.store.put(value, key);
  await tx.done;
}

function normalizeNumber(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeBool(value) {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['1', 'true', 't', 'yes', 'si', 'sí'].includes(normalized);
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  return Boolean(value);
}

function normalizeString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeScope(value) {
  const v = normalizeString(value).toLowerCase();
  return v === 'conservera' ? 'conservera' : 'campo';
}

function normalizeCodeReference(value) {
  const base = normalizeString(value);
  if (!base) return '';
  const noZeros = base.replace(/^0+/, '');
  return noZeros || '0';
}

function makeActivityTypeRecord(type) {
  const id = normalizeNumber(type.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    id,
    nombre: normalizeString(type.nombre || type.name || ''),
    icono: normalizeString(type.icono || ''),
    scope: normalizeScope(type.scope || type.category),
  };
}

function toUiActivityType(record) {
  return {
    id: Number(record.id),
    nombre: normalizeString(record.nombre),
    icono: normalizeString(record.icono),
    scope: normalizeScope(record.scope),
  };
}

function normalizeTag(entry) {
  if (!entry && entry !== 0) return null;
  if (typeof entry === 'number') {
    if (!Number.isInteger(entry)) return null;
    return { id: entry, nombre: '' };
  }
  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    if (Number.isInteger(num)) {
      return { id: num, nombre: '' };
    }
    return null;
  }
  const idRaw = entry.id != null ? entry.id : (entry.ID != null ? entry.ID : entry.value);
  const id = Number(idRaw);
  if (!Number.isInteger(id)) return null;
  const nameRaw = entry.nombre != null ? entry.nombre : (entry.name != null ? entry.name : entry.label);
  const nombre = nameRaw == null ? '' : String(nameRaw).trim();
  return { id, nombre };
}

function normalizeTagList(list, fallbackIds = []) {
  const normalized = [];
  const seen = new Set();
  const push = (tag) => {
    if (!tag) return;
    if (!Number.isInteger(tag.id)) return;
    if (seen.has(tag.id)) return;
    seen.add(tag.id);
    const name = tag.nombre != null ? String(tag.nombre).trim() : '';
    normalized.push({ id: tag.id, nombre: name });
  };
  if (Array.isArray(list)) {
    for (const entry of list) {
      const tag = normalizeTag(entry);
      if (tag) push(tag);
    }
  }
  if (normalized.length === 0 && Array.isArray(fallbackIds)) {
    for (const entry of fallbackIds) {
      const tag = normalizeTag(entry);
      if (tag) push(tag);
    }
  }
  return normalized;
}

function extractTagIds(tags) {
  if (!Array.isArray(tags)) return [];
  const ids = [];
  for (const tag of tags) {
    const num = Number(tag && tag.id != null ? tag.id : tag);
    if (Number.isInteger(num) && !ids.includes(num)) {
      ids.push(num);
    }
  }
  return ids;
}

function normalizeOlivoRecord(record) {
  if (!record) return null;
  const id = normalizeNumber(record.id);
  if (!Number.isInteger(id)) return null;
  const parcelaId = normalizeNumber(record.id_parcela != null ? record.id_parcela : record.parcel_id);
  return {
    ...record,
    id,
    id_parcela: parcelaId,
    parcel_id: parcelaId,
    default_code: normalizeString(record.default_code || record.codigo || ''),
    name: normalizeString(record.name || record.nombre || ''),
  };
}

function makePalotRecord(palot) {
  const hasServerId = palot.id != null;
  const fallbackLocalId = palot.localId ? `local-${palot.localId}` : `local-${randomId()}`;
  const recordId = hasServerId ? palot.id : (palot.localId ? `local-${palot.localId}` : null);
  return {
    key: palot.key || (hasServerId ? `srv-${palot.id}` : fallbackLocalId),
    id: recordId,
    codigo: palot.codigo,
    kgs: palot.kgs != null ? palot.kgs : null,
    procesado: Boolean(palot.procesado),
    pending: Boolean(palot.pending),
    source: palot.source || (hasServerId ? 'server' : 'local'),
    created_at: palot.created_at || null,
  };
}

function makeRelationRecord(rel) {
  const hasServerId = rel.id != null;
  const fallbackLocalId = rel.localId ? `local-${rel.localId}` : `local-${randomId()}`;
  const key = rel.key || (hasServerId ? `srv-${rel.id}` : fallbackLocalId);
  const relationId = rel.id != null ? rel.id : null;
  const parcelTags = normalizeTagList(rel.parcela_etiquetas, rel.parcela_etiqueta_ids);
  const parcelTagIds = extractTagIds(parcelTags.length ? parcelTags : rel.parcela_etiqueta_ids);
  return {
    key,
    id: relationId,
    localId: rel.localId || (relationId == null ? key : null),
    parcela_id: normalizeNumber(rel.parcela_id),
    parcela_nombre: rel.parcela_nombre != null ? rel.parcela_nombre : '',
    sigpac_municipio: rel.sigpac_municipio != null ? rel.sigpac_municipio : '',
    sigpac_poligono: rel.sigpac_poligono != null ? rel.sigpac_poligono : '',
    sigpac_parcela: rel.sigpac_parcela != null ? rel.sigpac_parcela : '',
    sigpac_recinto: rel.sigpac_recinto != null ? rel.sigpac_recinto : '',
    parcela_variedad: rel.parcela_variedad != null ? rel.parcela_variedad : '',
    parcela_porcentaje: rel.parcela_porcentaje != null ? rel.parcela_porcentaje : null,
    parcela_num_olivos: normalizeNumber(rel.parcela_num_olivos),
    parcela_hectareas: normalizeNumber(rel.parcela_hectareas),
    parcela_nombre_interno: rel.parcela_nombre_interno != null ? rel.parcela_nombre_interno : '',
    parcela_paraje_id: normalizeNumber(rel.parcela_paraje_id),
    parcela_paraje_nombre: rel.parcela_paraje_nombre != null ? rel.parcela_paraje_nombre : '',
    palot_id: rel.palot_id != null ? rel.palot_id : null,
    palot_codigo: rel.palot_codigo != null ? rel.palot_codigo : '',
    palot_procesado: rel.palot_procesado == null ? null : Boolean(rel.palot_procesado),
    kgs: rel.kgs != null ? rel.kgs : null,
    reservado_aderezo: normalizeBool(rel.reservado_aderezo),
    notas: rel.notas == null ? '' : String(rel.notas),
    created_by: rel.created_by != null ? rel.created_by : null,
    created_by_username: rel.created_by_username != null ? rel.created_by_username : '',
    created_at: rel.created_at || new Date().toISOString(),
    parcela_etiquetas: parcelTags,
    parcela_etiqueta_ids: parcelTagIds,
    pending: Boolean(rel.pending),
    source: rel.source || (hasServerId ? 'server' : 'local'),
  };
}

function toUiPalot(record) {
  return {
    id: record.id != null ? record.id : record.key,
    codigo: record.codigo,
    kgs: record.kgs,
    procesado: Boolean(record.procesado),
    pending: record.pending,
    source: record.source,
    created_at: record.created_at,
    key: record.key,
  };
}

function toUiRelation(record) {
  return {
    id: record.id != null ? record.id : record.key,
    localId: record.localId != null ? record.localId : null,
    parcela_id: record.parcela_id,
    parcela_nombre: record.parcela_nombre,
    sigpac_municipio: record.sigpac_municipio,
    sigpac_poligono: record.sigpac_poligono,
    sigpac_parcela: record.sigpac_parcela,
    sigpac_recinto: record.sigpac_recinto,
    parcela_variedad: record.parcela_variedad,
    parcela_porcentaje: record.parcela_porcentaje,
    parcela_num_olivos: record.parcela_num_olivos != null ? record.parcela_num_olivos : null,
    parcela_hectareas: record.parcela_hectareas != null ? record.parcela_hectareas : null,
    parcela_nombre_interno: record.parcela_nombre_interno,
    parcela_paraje_id: record.parcela_paraje_id != null ? record.parcela_paraje_id : null,
    parcela_paraje_nombre: record.parcela_paraje_nombre != null ? record.parcela_paraje_nombre : '',
    palot_id: record.palot_id != null ? record.palot_id : record.key,
    palot_codigo: record.palot_codigo,
    palot_procesado: record.palot_procesado == null ? null : Boolean(record.palot_procesado),
    kgs: record.kgs,
    reservado_aderezo: normalizeBool(record.reservado_aderezo),
    notas: record.notas == null ? '' : String(record.notas),
    created_by: record.created_by,
    created_by_username: record.created_by_username,
    created_at: record.created_at,
    parcela_etiquetas: Array.isArray(record.parcela_etiquetas)
      ? record.parcela_etiquetas.map((t) => ({ id: Number(t.id), nombre: t.nombre != null ? String(t.nombre) : '' }))
      : [],
    parcela_etiqueta_ids: extractTagIds(record.parcela_etiqueta_ids != null ? record.parcela_etiqueta_ids : record.parcela_etiquetas),
    pending: record.pending,
    source: record.source,
    key: record.key,
  };
}

function makeActivityRecord(activity) {
  const hasServerId = activity.id != null;
  const key = activity.key
    ? String(activity.key)
    : (hasServerId ? `srv-${activity.id}` : (activity.localKey || `local-${randomId()}`));
  return {
    key,
    id: hasServerId ? Number(activity.id) : null,
    localKey: activity.localKey || (!hasServerId ? key : null),
    parcela_id: normalizeNumber(activity.parcela_id),
    parcela_nombre: normalizeString(activity.parcela_nombre),
    parcela_nombre_interno: normalizeString(activity.parcela_nombre_interno),
    parcela_paraje_id: normalizeNumber(activity.parcela_paraje_id),
    parcela_paraje_nombre: normalizeString(activity.parcela_paraje_nombre),
    sigpac_municipio: normalizeString(activity.sigpac_municipio),
    sigpac_poligono: normalizeString(activity.sigpac_poligono),
    sigpac_parcela: normalizeString(activity.sigpac_parcela),
    sigpac_recinto: normalizeString(activity.sigpac_recinto),
    olivo_id: normalizeNumber(activity.olivo_id),
    activity_type_id: normalizeNumber(activity.activity_type_id),
    activity_type_nombre: normalizeString(activity.activity_type_nombre),
    activity_type_icono: normalizeString(activity.activity_type_icono),
    personas: normalizeNumber(activity.personas),
    notas: activity.notas == null ? '' : String(activity.notas),
    created_at: activity.created_at || new Date().toISOString(),
    created_by: normalizeNumber(activity.created_by),
    created_by_username: normalizeString(activity.created_by_username),
    pending: Boolean(activity.pending),
    source: activity.source || (hasServerId ? 'server' : 'local'),
  };
}

function toUiActivity(record) {
  return {
    id: record.id != null ? record.id : record.key,
    key: record.key,
    parcela_id: record.parcela_id,
    parcela_nombre: record.parcela_nombre,
    parcela_nombre_interno: record.parcela_nombre_interno,
    parcela_paraje_id: record.parcela_paraje_id,
    parcela_paraje_nombre: record.parcela_paraje_nombre,
    sigpac_municipio: record.sigpac_municipio,
    sigpac_poligono: record.sigpac_poligono,
    sigpac_parcela: record.sigpac_parcela,
    sigpac_recinto: record.sigpac_recinto,
    olivo_id: record.olivo_id,
    activity_type_id: record.activity_type_id,
    activity_type_nombre: record.activity_type_nombre,
    activity_type_icono: record.activity_type_icono,
    activity_type_scope: normalizeScope(record.activity_type_scope || (record.activity_type && record.activity_type.scope)),
    personas: record.personas,
    notas: record.notas,
    created_at: record.created_at,
    created_by: record.created_by,
    created_by_username: record.created_by_username,
    pending: record.pending,
    source: record.source,
  };
}

async function clearAndPut(store, rows, transform) {
  await store.clear();
  for (const row of rows) {
    const value = transform ? transform(row) : row;
    if (value === undefined || value === null) continue;
    store.put(value);
  }
}

export async function saveServerSnapshot({
  parcelas = [],
  olivos = [],
  palots = [],
  relations = [],
  etiquetas = [],
  parcelas_etiquetas = [],
  parajes = [],
  activity_types = [],
  activities = [],
}) {
  const db = await getDb();
  const tx = db.transaction(['parcelas', 'olivos', 'palots', 'relations', 'pendingOps', 'tags', 'parajes', 'activityTypes', 'activities'], 'readwrite');
  const tagsStore = tx.objectStore('tags');
  const parcelasStore = tx.objectStore('parcelas');
  const parajesStore = tx.objectStore('parajes');
  const activityTypesStore = tx.objectStore('activityTypes');
  const activitiesStore = tx.objectStore('activities');
  const tagMap = new Map();
  for (const rawTag of Array.isArray(etiquetas) ? etiquetas : []) {
    const tag = normalizeTag(rawTag);
    if (tag) {
      tagMap.set(tag.id, { id: tag.id, nombre: tag.nombre });
    }
  }
  const parajeMap = new Map();
  for (const rawParaje of Array.isArray(parajes) ? parajes : []) {
    const id = normalizeNumber(rawParaje.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (!parajeMap.has(id)) {
      parajeMap.set(id, {
        id,
        nombre: rawParaje.nombre != null ? String(rawParaje.nombre) : '',
      });
    }
  }
  const parcelTagMap = new Map();
  for (const link of Array.isArray(parcelas_etiquetas) ? parcelas_etiquetas : []) {
    const parcelaId = normalizeNumber(link.id_parcela);
    const tagId = normalizeNumber(link.id_etiqueta);
    if (!Number.isInteger(parcelaId) || !Number.isInteger(tagId)) continue;
    if (!parcelTagMap.has(parcelaId)) parcelTagMap.set(parcelaId, []);
    const arr = parcelTagMap.get(parcelaId);
    if (!arr.includes(tagId)) arr.push(tagId);
  }
  await clearAndPut(tagsStore, Array.from(tagMap.values()), (tag) => ({
    id: Number(tag.id),
    nombre: tag.nombre != null ? String(tag.nombre) : '',
  }));
  await clearAndPut(activityTypesStore, activity_types, (type) => makeActivityTypeRecord(type));
  await clearAndPut(parcelasStore, parcelas, (row) => {
    const id = normalizeNumber(row.id);
    const parcelTagIds = parcelTagMap.get(id) || [];
    const parcelTags = parcelTagIds
      .map((tagId) => tagMap.get(tagId))
      .filter(Boolean)
      .map((tag) => ({ id: Number(tag.id), nombre: tag.nombre != null ? String(tag.nombre) : '' }));
    if (row.paraje_id != null) {
      const parajeId = normalizeNumber(row.paraje_id);
      if (Number.isInteger(parajeId) && parajeId > 0 && !parajeMap.has(parajeId)) {
        parajeMap.set(parajeId, {
          id: parajeId,
          nombre: row.paraje_nombre != null ? String(row.paraje_nombre) : '',
        });
      }
    }
    return {
      ...row,
      id,
      num_olivos: normalizeNumber(row.num_olivos),
      hectareas: normalizeNumber(row.hectareas),
      etiquetas: parcelTags,
      etiqueta_ids: parcelTagIds.slice(),
      paraje_id: row.paraje_id != null ? normalizeNumber(row.paraje_id) : null,
      paraje_nombre: row.paraje_nombre != null ? String(row.paraje_nombre) : '',
    };
  });
  await clearAndPut(parajesStore, Array.from(parajeMap.values()), (row) => ({
    id: Number(row.id),
    nombre: row.nombre != null ? String(row.nombre) : '',
  }));
  await clearAndPut(tx.objectStore('olivos'), olivos, (row) => ({ ...row, id: normalizeNumber(row.id), id_parcela: normalizeNumber(row.id_parcela) }));
  await clearAndPut(tx.objectStore('palots'), palots, (row) => makePalotRecord({ ...row, source: 'server', pending: false }));
  await clearAndPut(tx.objectStore('relations'), relations, (row) => makeRelationRecord({ ...row, source: 'server', pending: false }));
  await clearAndPut(activitiesStore, activities, (row) => makeActivityRecord({ ...row, source: 'server', pending: false }));
  await applyPendingOpsToStores(tx);
  await tx.done;
  await saveMeta('lastSnapshot', new Date().toISOString());
}

async function applyPendingOpsToStores(tx) {
  const pendingStore = tx.objectStore('pendingOps');
  const palotsStore = tx.objectStore('palots');
  const relationsStore = tx.objectStore('relations');
  const parcelasStore = tx.objectStore('parcelas');
  const tagsStore = tx.objectStore('tags');
  const parajesStore = tx.objectStore('parajes');
  const activitiesStore = tx.objectStore('activities');
  const activityTypesStore = tx.objectStore('activityTypes');
  let cursor = await pendingStore.openCursor();
  while (cursor) {
    await applyPendingOp(cursor.value, {
      palotsStore,
      relationsStore,
      parcelasStore,
      tagsStore,
      parajesStore,
      activitiesStore,
      activityTypesStore,
    });
    cursor = await cursor.continue();
  }
}

async function applyPendingOp(op, stores) {
  if (!op || !op.type) return;
  const {
    palotsStore,
    relationsStore,
    parcelasStore,
    tagsStore,
    parajesStore,
    activitiesStore,
    activityTypesStore,
  } = stores;
  if (op.type === 'ensurePalot') {
    const payload = op.payload || {};
    const codigo = payload.codigo;
    if (!codigo) return;
    const existing = await palotsStore.index('byCodigo').get(codigo);
    if (existing) return;
    palotsStore.put(makePalotRecord({ codigo, pending: true, source: 'local', localId: op.localId || op.id, procesado: false }));
  }
  if (op.type === 'createRelation') {
    const payload = op.payload || {};
    if (!payload.parcela_id || !payload.palot_codigo) return;
    // Avoid duplicates by checking existing pending relation for same parcela + palot + created_at placeholder
    const index = relationsStore.index('byParcela');
    const matches = await index.getAll(payload.parcela_id);
    const already = matches.find((r) => r.pending && r.palot_codigo === payload.palot_codigo);
    if (already) return;
    relationsStore.put(makeRelationRecord({
      parcela_id: payload.parcela_id,
      parcela_nombre: payload.parcela_nombre,
      parcela_variedad: payload.parcela_variedad,
      parcela_porcentaje: payload.parcela_porcentaje,
      parcela_num_olivos: payload.parcela_num_olivos != null ? payload.parcela_num_olivos : null,
      parcela_hectareas: payload.parcela_hectareas != null ? payload.parcela_hectareas : null,
      parcela_nombre_interno: payload.parcela_nombre_interno,
      sigpac_municipio: payload.sigpac_municipio,
      sigpac_poligono: payload.sigpac_poligono,
      sigpac_parcela: payload.sigpac_parcela,
      sigpac_recinto: payload.sigpac_recinto,
      palot_codigo: payload.palot_codigo,
      palot_id: payload.palot_id != null ? payload.palot_id : null,
      palot_procesado: false,
      kgs: payload.kgs != null ? payload.kgs : null,
      reservado_aderezo: normalizeBool(payload.reservado_aderezo),
      notas: payload.notas == null ? '' : payload.notas,
      created_by: payload.created_by != null ? payload.created_by : null,
      created_by_username: payload.created_by_username != null ? payload.created_by_username : '',
      created_at: payload.created_at || new Date().toISOString(),
      pending: true,
      source: 'local',
      localId: op.localId || op.id,
      parcela_etiquetas: payload.parcela_etiquetas,
      parcela_etiqueta_ids: payload.parcela_etiqueta_ids,
      parcela_paraje_id: payload.parcela_paraje_id != null ? payload.parcela_paraje_id : null,
      parcela_paraje_nombre: payload.parcela_paraje_nombre != null ? payload.parcela_paraje_nombre : '',
    }));
    if (parcelasStore) {
      const parcelaId = Number(payload.parcela_id);
      if (Number.isInteger(parcelaId)) {
        const record = await parcelasStore.get(parcelaId);
        if (record) {
          const tagIds = extractTagIds(payload.parcela_etiqueta_ids || payload.parcela_etiquetas);
          let tags = Array.isArray(payload.parcela_etiquetas) ? normalizeTagList(payload.parcela_etiquetas, tagIds) : [];
          if (tags.length === 0 && tagsStore && tagIds.length > 0) {
            tags = [];
            for (const tagId of tagIds) {
              const tagRecord = await tagsStore.get(tagId);
              if (tagRecord) {
                tags.push({ id: Number(tagRecord.id), nombre: tagRecord.nombre || '' });
              } else {
                tags.push({ id: Number(tagId), nombre: '' });
              }
            }
          }
          record.etiquetas = tags;
          record.etiqueta_ids = extractTagIds(tags);
          if (payload.parcela_paraje_id != null) {
            record.paraje_id = Number(payload.parcela_paraje_id);
            record.paraje_nombre = payload.parcela_paraje_nombre != null ? String(payload.parcela_paraje_nombre) : '';
            if (parajesStore && Number.isInteger(record.paraje_id) && record.paraje_id > 0) {
              const existingParaje = await parajesStore.get(record.paraje_id);
              if (!existingParaje) {
                await parajesStore.put({
                  id: record.paraje_id,
                  nombre: record.paraje_nombre || '',
                });
              }
            }
          }
          await parcelasStore.put(record);
        }
      }
    }
  }
  if (op.type === 'createActivity' && activitiesStore) {
    const payload = op.payload || {};
    const parcelaId = Number(payload.parcela_id);
    const activityTypeId = Number(payload.activity_type_id);
    const olivoId = Number(payload.olivo_id);
    if (!Number.isInteger(parcelaId) || !Number.isInteger(activityTypeId) || !Number.isInteger(olivoId)) {
      return;
    }
    let typeName = payload.activity_type_nombre || '';
    let typeIcon = payload.activity_type_icono || '';
    if ((!typeName || !typeIcon) && activityTypesStore && activityTypeId > 0) {
      const typeRecord = await activityTypesStore.get(activityTypeId);
      if (typeRecord) {
        if (!typeName) typeName = normalizeString(typeRecord.nombre);
        if (!typeIcon) typeIcon = normalizeString(typeRecord.icono);
      }
    }
    const record = makeActivityRecord({
      ...payload,
      parcela_id: parcelaId,
      activity_type_id: activityTypeId,
      activity_type_nombre: typeName,
      activity_type_icono: typeIcon,
      olivo_id: olivoId,
      personas: payload.personas != null ? payload.personas : null,
      notas: payload.notas,
      created_at: payload.created_at || new Date().toISOString(),
      pending: true,
      source: 'local',
      key: payload.localKey || `local-activity-${op.localId || op.id}`,
      localKey: payload.localKey || `local-activity-${op.localId || op.id}`,
    });
    await activitiesStore.put(record);
  }
}

export async function listRelations() {
  const db = await getDb();
  const store = db.transaction('relations').store;
  const rows = await store.getAll();
  return rows.map(toUiRelation);
}

export async function listRelationsByParcela(parcelaId) {
  if (!parcelaId) return [];
  const db = await getDb();
  const tx = db.transaction('relations');
  const index = tx.store.index('byParcela');
  const rows = await index.getAll(Number(parcelaId));
  return rows.map(toUiRelation);
}

export async function listActivities(limit = 100) {
  const db = await getDb();
  const rows = await db.transaction('activities').store.getAll();
  const normalized = rows.map(toUiActivity);
  normalized.sort((a, b) => {
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bTime - aTime;
  });
  if (limit && Number.isInteger(limit) && limit > 0) {
    return normalized.slice(0, limit);
  }
  return normalized;
}

export async function listActivitiesByParcela(parcelaId, limit = 200) {
  if (!parcelaId) return [];
  const db = await getDb();
  const tx = db.transaction('activities');
  const index = tx.store.index('byParcela');
  const rows = await index.getAll(Number(parcelaId));
  const normalized = rows.map(toUiActivity);
  normalized.sort((a, b) => {
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bTime - aTime;
  });
  if (limit && Number.isInteger(limit) && limit > 0) {
    return normalized.slice(0, limit);
  }
  return normalized;
}

export async function listPalots() {
  const db = await getDb();
  const rows = await db.transaction('palots').store.getAll();
  return rows.map(toUiPalot);
}

export async function getPalotByCodigo(codigo) {
  if (!codigo) return null;
  const db = await getDb();
  const index = db.transaction('palots').store.index('byCodigo');
  const record = await index.get(String(codigo));
  return record ? toUiPalot(record) : null;
}


export async function getParcelaById(id) {
  if (!id && id !== 0) return null;
  const db = await getDb();
  return db.transaction('parcelas').store.get(Number(id));
}

export async function getParcelaByOlivo(identifier) {
  if (identifier === undefined || identifier === null || identifier === '') return null;
  const db = await getDb();
  const tx = db.transaction(['olivos', 'parcelas']);
  const olivoStore = tx.objectStore('olivos');
  const parcelaStore = tx.objectStore('parcelas');
  const trimmed = typeof identifier === 'string' ? identifier.trim() : '';
  const normalizedLookup = normalizeCodeReference(identifier);
  const variants = [];
  if (trimmed) {
    variants.push(trimmed);
    const noZeros = trimmed.replace(/^0+/, '');
    if (noZeros && noZeros !== trimmed) variants.push(noZeros);
  }
  const parsedId = Number(identifier);
  if (Number.isInteger(parsedId)) {
    const padded = String(parsedId).padStart(Math.max(trimmed.length || 0, 5), '0');
    if (padded && !variants.includes(padded)) variants.push(padded);
  }
  for (const candidate of variants) {
    try {
      const idx = olivoStore.index('byDefaultCode');
      const record = await idx.get(candidate);
      if (record) {
        const parcela = await parcelaStore.get(record.id_parcela);
        if (parcela) return parcela;
      }
    } catch (_) {}
  }
  if (Number.isInteger(parsedId)) {
    const fallback = await olivoStore.get(parsedId);
    if (fallback && fallback.id_parcela) {
      const parcela = await parcelaStore.get(fallback.id_parcela);
      if (parcela) return parcela;
    }
  }
  if (normalizedLookup) {
    const allOlivos = await olivoStore.getAll();
    const match = (allOlivos || []).find((item) => normalizeCodeReference(item?.default_code) === normalizedLookup);
    if (match && match.id_parcela) {
      const parcela = await parcelaStore.get(match.id_parcela);
      if (parcela) return parcela;
    }
  }
  return null;
}

export async function findOlivoByCodigo(codigo) {
  const trimmed = typeof codigo === 'string' ? codigo.trim() : String(codigo ?? '').trim();
  if (!trimmed) return null;
  const db = await getDb();
  const tx = db.transaction('olivos');
  const normalizedLookup = normalizeCodeReference(trimmed);
  const variants = [trimmed];
  const noZeros = trimmed.replace(/^0+/, '');
  if (noZeros && noZeros !== trimmed) variants.push(noZeros);
  const parsedNum = Number(noZeros || trimmed);
  if (Number.isInteger(parsedNum)) {
    const padded = String(parsedNum).padStart(Math.max(trimmed.length, 5), '0');
    if (!variants.includes(padded)) variants.push(padded);
  }
  for (const candidate of variants) {
    try {
      const idx = tx.store.index('byDefaultCode');
      const record = await idx.get(candidate);
      const normalized = normalizeOlivoRecord(record);
      if (normalized) return normalized;
    } catch (_) {}
  }
  if (Number.isInteger(parsedNum)) {
    const byId = await tx.store.get(parsedNum);
    const normalizedById = normalizeOlivoRecord(byId);
    if (normalizedById) return normalizedById;
  }
  const all = await tx.store.getAll();
  const match = (all || []).find((item) => normalizeCodeReference(item?.default_code) === normalizedLookup);
  return normalizeOlivoRecord(match);
}

export async function listOlivos() {
  const db = await getDb();
  const rows = await db.transaction('olivos').store.getAll();
  return rows.map((row) => normalizeOlivoRecord(row)).filter(Boolean);
}

export async function findOlivoById(id) {
  const parsed = Number(id);
  if (!Number.isInteger(parsed)) return null;
  const db = await getDb();
  const record = await db.transaction('olivos').store.get(parsed);
  return normalizeOlivoRecord(record);
}

export async function listParcelas() {
  const db = await getDb();
  return db.transaction('parcelas').store.getAll();
}

export async function enqueuePendingOp(op) {
  const db = await getDb();
  const tx = db.transaction(['pendingOps', 'palots', 'relations', 'parcelas', 'tags', 'parajes', 'activities', 'activityTypes'], 'readwrite');
  const id = await tx.objectStore('pendingOps').add({
    ...op,
    createdAt: op.createdAt || new Date().toISOString(),
    status: op.status || 'pending',
  });
  await applyPendingOp({ ...op, id }, {
    palotsStore: tx.objectStore('palots'),
    relationsStore: tx.objectStore('relations'),
    parcelasStore: tx.objectStore('parcelas'),
    tagsStore: tx.objectStore('tags'),
    parajesStore: tx.objectStore('parajes'),
    activitiesStore: tx.objectStore('activities'),
    activityTypesStore: tx.objectStore('activityTypes'),
  });
  await tx.done;
  return id;
}

export async function enqueueEnsurePalot(codigo) {
  return enqueuePendingOp({ type: 'ensurePalot', payload: { codigo } });
}

export async function enqueueRelation(payload) {
  return enqueuePendingOp({ type: 'createRelation', payload });
}

export async function enqueueActivity(payload) {
  const localKey = payload && payload.localKey ? String(payload.localKey) : `local-activity-${randomId()}`;
  return enqueuePendingOp({
    type: 'createActivity',
    payload: {
      ...payload,
      localKey,
      created_at: payload && payload.created_at ? payload.created_at : new Date().toISOString(),
    },
  });
}

export async function getPendingOps() {
  const db = await getDb();
  const rows = await db.transaction('pendingOps').store.getAll();
  return rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function removePendingOp(id) {
  const db = await getDb();
  const tx = db.transaction(['pendingOps', 'palots', 'relations', 'parcelas', 'tags', 'parajes', 'activities', 'activityTypes'], 'readwrite');
  const store = tx.objectStore('pendingOps');
  const op = await store.get(id);
  await store.delete(id);
  if (op) {
    const palotsStore = tx.objectStore('palots');
    const relationsStore = tx.objectStore('relations');
    const parcelasStore = tx.objectStore('parcelas');
    const tagsStore = tx.objectStore('tags');
    const parajesStore = tx.objectStore('parajes');
    const activitiesStore = tx.objectStore('activities');
    // Remove placeholders so that snapshot refresh repopulates fresh data
    if (op.type === 'ensurePalot') {
      const ensurePayload = op.payload || {};
      const codigo = ensurePayload.codigo;
      if (codigo) {
        const record = await palotsStore.index('byCodigo').get(codigo);
        if (record && record.source === 'local') {
          await palotsStore.delete(record.key);
        }
      }
    }
    if (op.type === 'createRelation') {
      const payload = op.payload || {};
      if (payload.parcela_id && payload.palot_codigo) {
        const index = relationsStore.index('byParcela');
        const matches = await index.getAll(Number(payload.parcela_id));
        for (const rel of matches) {
          if (rel.source === 'local' && rel.palot_codigo === payload.palot_codigo) {
            await relationsStore.delete(rel.key);
          }
        }
        if (parcelasStore) {
          const parcelaRecord = await parcelasStore.get(Number(payload.parcela_id));
          if (parcelaRecord) {
            parcelaRecord.etiquetas = normalizeTagList(parcelaRecord.etiquetas, parcelaRecord.etiqueta_ids);
            parcelaRecord.etiqueta_ids = extractTagIds(parcelaRecord.etiquetas);
            await parcelasStore.put(parcelaRecord);
          }
        }
        if (tagsStore && Array.isArray(payload.parcela_etiqueta_ids)) {
          for (const tagId of payload.parcela_etiqueta_ids) {
            const existingTag = await tagsStore.get(Number(tagId));
            if (!existingTag && payload.parcela_etiquetas) {
              const tagInfo = payload.parcela_etiquetas.find((tag) => Number(tag?.id) === Number(tagId));
              if (tagInfo) {
                await tagsStore.put({ id: Number(tagId), nombre: tagInfo.nombre != null ? String(tagInfo.nombre) : '' });
              }
            }
          }
        }
        if (parajesStore && payload.parcela_paraje_id) {
          const parajeId = Number(payload.parcela_paraje_id);
          if (Number.isInteger(parajeId) && parajeId > 0) {
            const existingParaje = await parajesStore.get(parajeId);
            if (!existingParaje) {
              await parajesStore.put({
                id: parajeId,
                nombre: payload.parcela_paraje_nombre != null ? String(payload.parcela_paraje_nombre) : '',
              });
            }
          }
        }
      }
    }
    if (op.type === 'createActivity' && activitiesStore) {
      const payload = op.payload || {};
      const localKey = payload.localKey;
      if (localKey) {
        const existing = await activitiesStore.get(localKey);
        if (existing && existing.source === 'local') {
          await activitiesStore.delete(localKey);
        }
      }
    }
  }
  await tx.done;
}

export async function hasPendingOps() {
  const db = await getDb();
  const count = await db.transaction('pendingOps').store.count();
  return count > 0;
}

export async function getLastSnapshotIso() {
  const meta = await loadMeta('lastSnapshot');
  return meta || null;
}

export async function listEtiquetas() {
  const db = await getDb();
  const rows = await db.transaction('tags').store.getAll();
  return rows
    .map((row) => ({
      id: Number(row.id),
      nombre: row.nombre != null ? String(row.nombre) : '',
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export async function upsertEtiquetaLocal(tag) {
  const normalized = normalizeTag(tag);
  if (!normalized) return;
  const db = await getDb();
  const tx = db.transaction('tags', 'readwrite');
  await tx.store.put({ id: normalized.id, nombre: normalized.nombre || '' });
  await tx.done;
}

export async function removeEtiquetaLocal(id) {
  const num = Number(id);
  if (!Number.isInteger(num)) return;
  const db = await getDb();
  const tx = db.transaction(['tags', 'parcelas', 'relations'], 'readwrite');
  await tx.objectStore('tags').delete(num);
  const parcelasStore = tx.objectStore('parcelas');
  let parcelaCursor = await parcelasStore.openCursor();
  while (parcelaCursor) {
    const record = parcelaCursor.value;
    if (Array.isArray(record.etiquetas) || Array.isArray(record.etiqueta_ids)) {
      const filtered = normalizeTagList(record.etiquetas, record.etiqueta_ids).filter((tag) => tag.id !== num);
      record.etiquetas = filtered;
      record.etiqueta_ids = extractTagIds(filtered);
      parcelaCursor.update(record);
    }
    parcelaCursor = await parcelaCursor.continue();
  }
  const relationsStore = tx.objectStore('relations');
  let relCursor = await relationsStore.openCursor();
  while (relCursor) {
    const record = relCursor.value;
    if (Array.isArray(record.parcela_etiquetas) || Array.isArray(record.parcela_etiqueta_ids)) {
      const filtered = normalizeTagList(record.parcela_etiquetas, record.parcela_etiqueta_ids).filter((tag) => tag.id !== num);
      record.parcela_etiquetas = filtered;
      record.parcela_etiqueta_ids = extractTagIds(filtered);
      relCursor.update(record);
    }
    relCursor = await relCursor.continue();
  }
  await tx.done;
}

export async function listActivityTypes() {
  const db = await getDb();
  const rows = await db.transaction('activityTypes').store.getAll();
  return rows.map(toUiActivityType).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export async function upsertActivityTypeLocal(type) {
  const record = makeActivityTypeRecord(type);
  if (!record) return;
  const db = await getDb();
  const tx = db.transaction('activityTypes', 'readwrite');
  await tx.store.put(record);
  await tx.done;
}

export async function removeActivityTypeLocal(id) {
  const num = Number(id);
  if (!Number.isInteger(num)) return;
  const db = await getDb();
  const tx = db.transaction('activityTypes', 'readwrite');
  await tx.store.delete(num);
  await tx.done;
}

export async function setParcelaEtiquetasLocal(parcelaId, tags) {
  const pid = Number(parcelaId);
  if (!Number.isInteger(pid)) return;
  const db = await getDb();
  const tx = db.transaction(['parcelas', 'relations'], 'readwrite');
  const parcelasStore = tx.objectStore('parcelas');
  const parcelaRecord = await parcelasStore.get(pid);
  const normalizedTags = normalizeTagList(tags);
  const tagIds = extractTagIds(normalizedTags);
  if (parcelaRecord) {
    parcelaRecord.etiquetas = normalizedTags;
    parcelaRecord.etiqueta_ids = tagIds;
    await parcelasStore.put(parcelaRecord);
  }
  const relationsStore = tx.objectStore('relations');
  const index = relationsStore.index('byParcela');
  const rels = await index.getAll(pid);
  for (const rel of rels) {
    rel.parcela_etiquetas = normalizedTags;
    rel.parcela_etiqueta_ids = tagIds;
    await relationsStore.put(rel);
  }
  await tx.done;
}

export async function replacePalotPlaceholder(codigo, serverPalot) {
  const db = await getDb();
  const tx = db.transaction('palots', 'readwrite');
  const index = tx.store.index('byCodigo');
  const existing = await index.get(codigo);
  if (existing && existing.source === 'local') {
    await tx.store.delete(existing.key);
  }
  if (serverPalot) {
    await tx.store.put(makePalotRecord({ ...serverPalot, source: 'server', pending: false }));
  }
  await tx.done;
}

export async function replaceRelationPlaceholder(parcelaId, palotCodigo, serverRelation) {
  const db = await getDb();
  const tx = db.transaction(['relations', 'parcelas', 'parajes'], 'readwrite');
  const relationsStore = tx.objectStore('relations');
  const parcelasStore = tx.objectStore('parcelas');
  const parajesStore = tx.objectStore('parajes');
  const index = relationsStore.index('byParcela');
  const matches = await index.getAll(Number(parcelaId));
  for (const rel of matches) {
    if (rel.source === 'local' && rel.palot_codigo === palotCodigo) {
      await relationsStore.delete(rel.key);
    }
  }
  if (serverRelation) {
    const record = makeRelationRecord({ ...serverRelation, source: 'server', pending: false });
    await relationsStore.put(record);
    if (parcelasStore && Number.isInteger(record.parcela_id)) {
      const parcelaRecord = await parcelasStore.get(record.parcela_id);
      if (parcelaRecord) {
        parcelaRecord.etiquetas = record.parcela_etiquetas;
        parcelaRecord.etiqueta_ids = record.parcela_etiqueta_ids;
        parcelaRecord.paraje_id = record.parcela_paraje_id != null ? record.parcela_paraje_id : null;
        parcelaRecord.paraje_nombre = record.parcela_paraje_nombre != null ? record.parcela_paraje_nombre : '';
        await parcelasStore.put(parcelaRecord);
        if (parajesStore && parcelaRecord.paraje_id != null && Number.isInteger(parcelaRecord.paraje_id) && parcelaRecord.paraje_id > 0) {
          const existingParaje = await parajesStore.get(parcelaRecord.paraje_id);
          if (!existingParaje) {
            await parajesStore.put({
              id: parcelaRecord.paraje_id,
              nombre: parcelaRecord.paraje_nombre || '',
            });
          }
        }
      }
    }
  }
  await tx.done;
}

export async function replaceActivityPlaceholder(localKey, serverActivity) {
  const db = await getDb();
  const tx = db.transaction('activities', 'readwrite');
  if (localKey) {
    const existing = await tx.store.get(localKey);
    if (existing && existing.source === 'local') {
      await tx.store.delete(localKey);
    }
  }
  if (serverActivity) {
    await tx.store.put(makeActivityRecord({ ...serverActivity, source: 'server', pending: false }));
  }
  await tx.done;
}

export async function upsertActivityLocal(activity) {
  const db = await getDb();
  const tx = db.transaction('activities', 'readwrite');
  await tx.store.put(makeActivityRecord({ ...activity, source: 'server', pending: false }));
  await tx.done;
}

export async function updatePendingActivityLocal(activityKey, updates = {}) {
  if (!activityKey) return false;
  const db = await getDb();
  const tx = db.transaction(['activities', 'pendingOps'], 'readwrite');
  const activitiesStore = tx.objectStore('activities');
  const activity = await activitiesStore.get(activityKey);
  if (!activity || activity.source !== 'local') {
    await tx.done;
    return false;
  }
  let changed = false;
  if (updates.activity_type_id !== undefined) {
    activity.activity_type_id = Number(updates.activity_type_id);
    changed = true;
  }
  if (updates.activity_type_nombre !== undefined) {
    activity.activity_type_nombre = updates.activity_type_nombre != null ? String(updates.activity_type_nombre) : '';
    changed = true;
  }
  if (updates.activity_type_icono !== undefined) {
    activity.activity_type_icono = updates.activity_type_icono != null ? String(updates.activity_type_icono) : '';
    changed = true;
  }
  if (updates.personas !== undefined) {
    const personasNum = Number(updates.personas);
    if (Number.isFinite(personasNum)) {
      activity.personas = personasNum;
      changed = true;
    }
  }
  if (updates.notas !== undefined) {
    activity.notas = updates.notas == null ? '' : String(updates.notas);
    changed = true;
  }
  if (!changed) {
    await tx.done;
    return false;
  }
  await activitiesStore.put(activity);
  const pendingStore = tx.objectStore('pendingOps');
  let cursor = await pendingStore.openCursor();
  while (cursor) {
    const value = cursor.value;
    if (value && value.type === 'createActivity' && value.payload && value.payload.localKey === activityKey) {
      const next = { ...value };
      next.payload = { ...next.payload };
      if (updates.activity_type_id !== undefined) {
        next.payload.activity_type_id = Number(updates.activity_type_id);
      }
      if (updates.activity_type_nombre !== undefined) {
        next.payload.activity_type_nombre = updates.activity_type_nombre != null ? String(updates.activity_type_nombre) : '';
      }
      if (updates.activity_type_icono !== undefined) {
        next.payload.activity_type_icono = updates.activity_type_icono != null ? String(updates.activity_type_icono) : '';
      }
      if (updates.personas !== undefined) {
        const personasNum = Number(updates.personas);
        if (Number.isFinite(personasNum)) next.payload.personas = personasNum;
      }
      if (updates.notas !== undefined) {
        const note = updates.notas == null ? null : String(updates.notas).trim();
        next.payload.notas = note && note.length ? note : null;
      }
      await cursor.update(next);
      break;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return true;
}

export async function removePendingActivityLocal(activityKey) {
  if (!activityKey) return false;
  const db = await getDb();
  const tx = db.transaction(['activities', 'pendingOps'], 'readwrite');
  const activitiesStore = tx.objectStore('activities');
  const existing = await activitiesStore.get(activityKey);
  if (!existing) {
    await tx.done;
    return false;
  }
  await activitiesStore.delete(activityKey);
  const pendingStore = tx.objectStore('pendingOps');
  let cursor = await pendingStore.openCursor();
  while (cursor) {
    const value = cursor.value;
    if (value && value.type === 'createActivity' && value.payload && value.payload.localKey === activityKey) {
      await cursor.delete();
      break;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return true;
}

export async function removeActivityLocal(activityKey) {
  if (!activityKey) return false;
  const db = await getDb();
  const tx = db.transaction('activities', 'readwrite');
  const existing = await tx.store.get(activityKey);
  if (!existing) {
    await tx.done;
    return false;
  }
  await tx.store.delete(activityKey);
  await tx.done;
  return true;
}

function normalizeTagUpdates(tagEntries, tagIds) {
  if (Array.isArray(tagEntries) && tagEntries.length > 0) {
    return normalizeTagList(tagEntries, tagIds);
  }
  if (Array.isArray(tagIds)) {
    return normalizeTagList([], tagIds);
  }
  return [];
}

export async function updatePendingRelationLocal(relationKey, { kgs, notas, tagEntries, tagIds } = {}) {
  if (!relationKey) return false;
  const db = await getDb();
  const tx = db.transaction(['relations', 'pendingOps'], 'readwrite');
  const relationsStore = tx.objectStore('relations');
  const relation = await relationsStore.get(relationKey);
  if (!relation || relation.source !== 'local') {
    await tx.done;
    return false;
  }
  const pendingStore = tx.objectStore('pendingOps');
  let changed = false;
  if (kgs !== undefined) {
    relation.kgs = kgs;
    changed = true;
  }
  if (notas !== undefined) {
    relation.notas = notas == null ? '' : String(notas);
    changed = true;
  }
  if (tagEntries !== undefined || tagIds !== undefined) {
    const normalizedTags = normalizeTagUpdates(tagEntries, tagIds);
    relation.parcela_etiquetas = normalizedTags;
    relation.parcela_etiqueta_ids = extractTagIds(normalizedTags.length ? normalizedTags : tagIds);
    changed = true;
  }
  if (changed) {
    await relationsStore.put(relation);
  }
  const localId = Number(relation.localId);
  if (!Number.isInteger(localId)) {
    await tx.done;
    return changed;
  }
  const pendingOp = await pendingStore.get(localId);
  if (!pendingOp || pendingOp.type !== 'createRelation') {
    await tx.done;
    return changed;
  }
  pendingOp.payload = pendingOp.payload || {};
  if (kgs !== undefined) pendingOp.payload.kgs = kgs;
  if (notas !== undefined) pendingOp.payload.notas = notas == null ? null : String(notas);
  if (tagEntries !== undefined || tagIds !== undefined) {
    const normalizedTags = normalizeTagUpdates(tagEntries, tagIds);
    pendingOp.payload.parcela_etiquetas = normalizedTags;
    pendingOp.payload.parcela_etiqueta_ids = extractTagIds(normalizedTags.length ? normalizedTags : tagIds);
  }
  await pendingStore.put(pendingOp);
  await tx.done;
  return true;
}

export async function removePendingRelationLocal(relationKey) {
  if (!relationKey) return false;
  const db = await getDb();
  const tx = db.transaction(['relations', 'pendingOps'], 'readwrite');
  const relationsStore = tx.objectStore('relations');
  const relation = await relationsStore.get(relationKey);
  if (!relation) {
    await tx.done;
    return false;
  }
  await relationsStore.delete(relationKey);
  const localId = Number(relation.localId);
  if (Number.isInteger(localId)) {
    await tx.objectStore('pendingOps').delete(localId);
  }
  await tx.done;
  return true;
}
