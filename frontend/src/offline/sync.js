import {
  saveServerSnapshot,
  getPendingOps,
  removePendingOp,
  replacePalotPlaceholder,
  replaceRelationPlaceholder,
  replaceActivityPlaceholder,
} from './db';

function buildHeaders(authHeaders = {}, extra = {}) {
  return { ...authHeaders, ...extra };
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    const err = new Error('No autenticado');
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.payload = body;
    throw err;
  }
  return res.json();
}

export async function syncDown(apiBase, authHeaders) {
  const snapshot = await fetchJson(`${apiBase}/sync/snapshot`, {
    headers: buildHeaders(authHeaders),
  });
  await saveServerSnapshot(snapshot);
  return snapshot;
}

export async function syncUp(apiBase, authHeaders) {
  const pending = await getPendingOps();
  if (!pending.length) return { uploaded: 0 };
  const processed = [];
  const palotCache = new Map();

  const ensurePalot = async (codigo) => {
    if (!codigo) throw new Error('Sin código de palot');
    const cacheKey = String(codigo);
    if (palotCache.has(cacheKey)) return palotCache.get(cacheKey);
    let palotsList;
    try {
      palotsList = await fetchJson(`${apiBase}/palots`, {
        headers: buildHeaders(authHeaders),
      });
    } catch (error) {
      if (error.status === 404) palotsList = [];
      else throw error;
    }
    for (const p of palotsList) {
      palotCache.set(String(p.codigo), p);
    }
    if (palotCache.has(cacheKey)) return palotCache.get(cacheKey);
    const created = await fetchJson(`${apiBase}/palots`, {
      method: 'POST',
      headers: buildHeaders(authHeaders, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ codigo: codigo }),
    });
    palotCache.set(cacheKey, created);
    await replacePalotPlaceholder(codigo, created);
    return created;
  };

  for (const op of pending) {
    if (op.type === 'ensurePalot') {
      const ensurePayload = op.payload || {};
      const codigo = ensurePayload.codigo;
      if (!codigo) {
        await removePendingOp(op.id);
        processed.push(op.id);
        continue;
      }
      await ensurePalot(codigo);
      await removePendingOp(op.id);
      processed.push(op.id);
      continue;
    }
    if (op.type === 'createRelation') {
      const payload = op.payload || {};
      const { parcela_id, palot_codigo, kgs, reservado_aderezo, notas, parcela_etiqueta_ids } = payload;
      if (!parcela_id || !palot_codigo) {
        await removePendingOp(op.id);
        processed.push(op.id);
        continue;
      }
      const palot = await ensurePalot(palot_codigo);
      const normalizedNotes = typeof notas === 'string' && notas.trim().length === 0 ? null : notas;
      const etiquetaIds = Array.isArray(parcela_etiqueta_ids)
        ? parcela_etiqueta_ids
            .map((value) => Number(value))
            .filter((value, idx, arr) => Number.isInteger(value) && value > 0 && arr.indexOf(value) === idx)
        : [];
      const createdRelation = await fetchJson(`${apiBase}/parcelas/${parcela_id}/palots`, {
        method: 'POST',
        headers: buildHeaders(authHeaders, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          palot_id: palot.id,
          kgs: kgs != null ? kgs : null,
          reservado_aderezo: reservado_aderezo != null ? reservado_aderezo : false,
          notas: normalizedNotes,
          etiquetas: etiquetaIds,
        }),
      });
      await replaceRelationPlaceholder(parcela_id, palot_codigo, createdRelation);
      await removePendingOp(op.id);
      processed.push(op.id);
      continue;
    }
    if (op.type === 'createActivity') {
      const payload = op.payload || {};
      const { parcela_id, olivo_id, activity_type_id, personas, notas, localKey } = payload;
      if (!activity_type_id || !olivo_id) {
        await removePendingOp(op.id);
        processed.push(op.id);
        continue;
      }
      const body = {
        activity_type_id,
        olivo_id,
      };
      if (parcela_id) body.parcela_id = parcela_id;
      const personasNum = Number(personas);
      if (Number.isFinite(personasNum) && personasNum > 0) {
        body.personas = personasNum;
      }
      if (notas != null) {
        body.notas = notas;
      }
      const createdActivity = await fetchJson(`${apiBase}/activities`, {
        method: 'POST',
        headers: buildHeaders(authHeaders, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      await replaceActivityPlaceholder(localKey, createdActivity);
      await removePendingOp(op.id);
      processed.push(op.id);
      continue;
    }
  }

  return { uploaded: processed.length, processedIds: processed };
}

export async function syncAll(apiBase, authHeaders) {
  const resultUp = await syncUp(apiBase, authHeaders);
  const snapshot = await syncDown(apiBase, authHeaders);
  return { uploaded: resultUp.uploaded, snapshot };
}
