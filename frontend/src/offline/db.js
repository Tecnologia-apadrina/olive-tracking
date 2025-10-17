import { openDB } from 'idb';

const DB_NAME = 'olive-tracking-offline';
const DB_VERSION = 1;

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
      upgrade(db) {
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta');
        }
        if (!db.objectStoreNames.contains('parcelas')) {
          db.createObjectStore('parcelas', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('olivos')) {
          db.createObjectStore('olivos', { keyPath: 'id' });
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
  const stores = ['parcelas', 'olivos', 'palots', 'relations', 'pendingOps'];
  const tx = db.transaction(stores, 'readwrite');
  await Promise.all(stores.map(async (name) => tx.objectStore(name).clear()));
  await tx.done;
}

export async function saveAuthSession({ token, username, role }) {
  const db = await getDb();
  const tx = db.transaction('meta', 'readwrite');
  tx.store.put({ token, username, role, storedAt: new Date().toISOString() }, 'auth');
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

function makePalotRecord(palot) {
  return {
    key: palot.key || (palot.id != null ? `srv-${palot.id}` : palot.localId ? `local-${palot.localId}` : `local-${randomId()}`),
    id: palot.id ?? (palot.localId ? `local-${palot.localId}` : null),
    codigo: palot.codigo,
    kgs: palot.kgs ?? null,
    procesado: Boolean(palot.procesado),
    pending: Boolean(palot.pending),
    source: palot.source || (palot.id != null ? 'server' : 'local'),
    created_at: palot.created_at || null,
  };
}

function makeRelationRecord(rel) {
  const key = rel.key || (rel.id != null ? `srv-${rel.id}` : rel.localId ? `local-${rel.localId}` : `local-${randomId()}`);
  return {
    key,
    id: rel.id ?? null,
    localId: rel.localId || (rel.id == null ? key : null),
    parcela_id: normalizeNumber(rel.parcela_id),
    parcela_nombre: rel.parcela_nombre ?? '',
    sigpac_municipio: rel.sigpac_municipio ?? '',
    sigpac_poligono: rel.sigpac_poligono ?? '',
    sigpac_parcela: rel.sigpac_parcela ?? '',
    sigpac_recinto: rel.sigpac_recinto ?? '',
    parcela_variedad: rel.parcela_variedad ?? '',
    parcela_porcentaje: rel.parcela_porcentaje ?? null,
    parcela_nombre_interno: rel.parcela_nombre_interno ?? '',
    palot_id: rel.palot_id ?? null,
    palot_codigo: rel.palot_codigo ?? '',
    palot_procesado: rel.palot_procesado == null ? null : Boolean(rel.palot_procesado),
    kgs: rel.kgs ?? null,
    reservado_aderezo: normalizeBool(rel.reservado_aderezo),
    created_by: rel.created_by ?? null,
    created_by_username: rel.created_by_username ?? '',
    created_at: rel.created_at || new Date().toISOString(),
    pending: Boolean(rel.pending),
    source: rel.source || (rel.id != null ? 'server' : 'local'),
  };
}

function toUiPalot(record) {
  return {
    id: record.id ?? record.key,
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
    id: record.id ?? record.key,
    parcela_id: record.parcela_id,
    parcela_nombre: record.parcela_nombre,
    sigpac_municipio: record.sigpac_municipio,
    sigpac_poligono: record.sigpac_poligono,
    sigpac_parcela: record.sigpac_parcela,
    sigpac_recinto: record.sigpac_recinto,
    parcela_variedad: record.parcela_variedad,
    parcela_porcentaje: record.parcela_porcentaje,
    parcela_nombre_interno: record.parcela_nombre_interno,
    palot_id: record.palot_id ?? record.key,
    palot_codigo: record.palot_codigo,
    palot_procesado: record.palot_procesado == null ? null : Boolean(record.palot_procesado),
    kgs: record.kgs,
    reservado_aderezo: normalizeBool(record.reservado_aderezo),
    created_by: record.created_by,
    created_by_username: record.created_by_username,
    created_at: record.created_at,
    pending: record.pending,
    source: record.source,
    key: record.key,
  };
}

async function clearAndPut(store, rows, transform) {
  await store.clear();
  for (const row of rows) {
    store.put(transform ? transform(row) : row);
  }
}

export async function saveServerSnapshot({ parcelas = [], olivos = [], palots = [], relations = [] }) {
  const db = await getDb();
  const tx = db.transaction(['parcelas', 'olivos', 'palots', 'relations', 'pendingOps'], 'readwrite');
  await clearAndPut(tx.objectStore('parcelas'), parcelas, (row) => ({ ...row, id: normalizeNumber(row.id) }));
  await clearAndPut(tx.objectStore('olivos'), olivos, (row) => ({ ...row, id: normalizeNumber(row.id), id_parcela: normalizeNumber(row.id_parcela) }));
  await clearAndPut(tx.objectStore('palots'), palots, (row) => makePalotRecord({ ...row, source: 'server', pending: false }));
  await clearAndPut(tx.objectStore('relations'), relations, (row) => makeRelationRecord({ ...row, source: 'server', pending: false }));
  await applyPendingOpsToStores(tx);
  await tx.done;
  await saveMeta('lastSnapshot', new Date().toISOString());
}

async function applyPendingOpsToStores(tx) {
  const pendingStore = tx.objectStore('pendingOps');
  const palotsStore = tx.objectStore('palots');
  const relationsStore = tx.objectStore('relations');
  let cursor = await pendingStore.openCursor();
  while (cursor) {
    await applyPendingOp(cursor.value, { palotsStore, relationsStore });
    cursor = await cursor.continue();
  }
}

async function applyPendingOp(op, stores) {
  if (!op || !op.type) return;
  const { palotsStore, relationsStore } = stores;
  if (op.type === 'ensurePalot') {
    const codigo = op.payload?.codigo;
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
      parcela_nombre_interno: payload.parcela_nombre_interno,
      sigpac_municipio: payload.sigpac_municipio,
      sigpac_poligono: payload.sigpac_poligono,
      sigpac_parcela: payload.sigpac_parcela,
      sigpac_recinto: payload.sigpac_recinto,
      palot_codigo: payload.palot_codigo,
      palot_id: payload.palot_id ?? null,
      palot_procesado: false,
      kgs: payload.kgs ?? null,
      reservado_aderezo: normalizeBool(payload.reservado_aderezo),
      created_by: payload.created_by ?? null,
      created_by_username: payload.created_by_username ?? '',
      created_at: payload.created_at || new Date().toISOString(),
      pending: true,
      source: 'local',
      localId: op.localId || op.id,
    }));
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

export async function getParcelaByOlivo(olivoId) {
  if (!olivoId && olivoId !== 0) return null;
  const db = await getDb();
  const tx = db.transaction(['olivos', 'parcelas']);
  const olivoStore = tx.objectStore('olivos');
  const parcelaStore = tx.objectStore('parcelas');
  const parsedId = Number(olivoId);
  if (!Number.isFinite(parsedId)) return null;
  const olivo = await olivoStore.get(parsedId);
  if (!olivo) return null;
  const parcela = await parcelaStore.get(olivo.id_parcela);
  return parcela || null;
}

export async function listParcelas() {
  const db = await getDb();
  return db.transaction('parcelas').store.getAll();
}

export async function enqueuePendingOp(op) {
  const db = await getDb();
  const tx = db.transaction(['pendingOps', 'palots', 'relations'], 'readwrite');
  const id = await tx.objectStore('pendingOps').add({
    ...op,
    createdAt: op.createdAt || new Date().toISOString(),
    status: op.status || 'pending',
  });
  await applyPendingOp({ ...op, id }, {
    palotsStore: tx.objectStore('palots'),
    relationsStore: tx.objectStore('relations'),
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

export async function getPendingOps() {
  const db = await getDb();
  const rows = await db.transaction('pendingOps').store.getAll();
  return rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function removePendingOp(id) {
  const db = await getDb();
  const tx = db.transaction(['pendingOps', 'palots', 'relations'], 'readwrite');
  const store = tx.objectStore('pendingOps');
  const op = await store.get(id);
  await store.delete(id);
  if (op) {
    const palotsStore = tx.objectStore('palots');
    const relationsStore = tx.objectStore('relations');
    // Remove placeholders so that snapshot refresh repopulates fresh data
    if (op.type === 'ensurePalot') {
      const codigo = op.payload?.codigo;
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
  const tx = db.transaction('relations', 'readwrite');
  const index = tx.store.index('byParcela');
  const matches = await index.getAll(Number(parcelaId));
  for (const rel of matches) {
    if (rel.source === 'local' && rel.palot_codigo === palotCodigo) {
      await tx.store.delete(rel.key);
    }
  }
  if (serverRelation) {
    await tx.store.put(makeRelationRecord({ ...serverRelation, source: 'server', pending: false }));
  }
  await tx.done;
}
