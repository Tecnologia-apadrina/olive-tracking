const express = require('express');
const xmlrpc = require('xmlrpc');
const db = require('../db');
const { isValidCountryCode, normalizeCountryCode } = require('../utils/country');

const router = express.Router();

const requireAuth = (req, res, next) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  next();
};
const requireAdmin = (req, res, next) => {
  if (!req.userId || req.userRole !== 'admin') return res.status(403).json({ error: 'Requiere admin' });
  next();
};

const sanitizeUrl = (raw) => {
  if (!raw && raw !== 0) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  try {
    const normalized = trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
    const url = new URL(normalized);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch (_) {
    return '';
  }
};

const publicConfig = (config) => {
  if (!config) return null;
  return {
    id: config.id,
    url: config.url,
    db_name: config.db_name,
    username: config.username,
    country_code: config.country_code || 'ES',
    has_password: Boolean(config.password),
    updated_at: config.updated_at || null,
  };
};

const resolveCountry = (req, override) => {
  if (isValidCountryCode(override)) return normalizeCountryCode(override);
  if (req.userCountry) return normalizeCountryCode(req.userCountry);
  return 'ES';
};

const fetchConfigByCountry = async (countryCode) => {
  const rows = await db.public.many(
    'SELECT id, url, db_name, username, password, country_code, updated_at FROM odoo_configs WHERE country_code = $1 LIMIT 1',
    [countryCode]
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
};

const upsertConfig = async ({ url, db_name, username, password, country_code }) => {
  const existing = await fetchConfigByCountry(country_code);
  if (existing) {
    return db.public.one(
      `UPDATE odoo_configs
         SET url = $1, db_name = $2, username = $3, password = $4, country_code = $5, updated_at = now()
       WHERE id = $6
       RETURNING id, url, db_name, username, password, country_code, updated_at`,
      [url, db_name, username, password, country_code, existing.id]
    );
  }
  return db.public.one(
    `INSERT INTO odoo_configs(url, db_name, username, password, country_code)
     VALUES($1, $2, $3, $4, $5)
     RETURNING id, url, db_name, username, password, country_code, updated_at`,
    [url, db_name, username, password, country_code]
  );
};

const callXmlRpc = (client, method, params = []) => new Promise((resolve, reject) => {
  client.methodCall(method, params, (err, value) => {
    if (err) return reject(err);
    return resolve(value);
  });
});

const createXmlRpcClient = (baseUrl, endpoint) => {
  const sanitized = sanitizeUrl(baseUrl);
  if (!sanitized) throw new Error('URL de Odoo inválida');
  const target = new URL(endpoint, sanitized);
  const isHttps = target.protocol === 'https:';
  const options = { url: target.toString(), timeout: 10000 };
  return isHttps ? xmlrpc.createSecureClient(options) : xmlrpc.createClient(options);
};

const buildEffectiveConfig = (raw, stored, fallbackCountry) => {
  const base = raw || {};
  const merged = {
    url: base.url || (stored && stored.url) || '',
    db_name: base.db_name || (stored && stored.db_name) || '',
    username: base.username || (stored && stored.username) || '',
    password: (base.password !== undefined && base.password !== null && String(base.password).trim() !== '')
      ? String(base.password).trim()
      : ((stored && stored.password) || ''),
    country_code: isValidCountryCode(base.country_code)
      ? normalizeCountryCode(base.country_code)
      : (stored && stored.country_code ? normalizeCountryCode(stored.country_code) : (fallbackCountry || 'ES')),
  };
  merged.url = sanitizeUrl(merged.url);
  merged.db_name = String(merged.db_name || '').trim();
  merged.username = String(merged.username || '').trim();
  merged.password = String(merged.password || '').trim();
  return merged;
};

const validateConfig = (config) => {
  if (!config.url || !config.db_name || !config.username || !config.password) {
    throw new Error('Config incompleta: URL, BD, usuario y contraseña son obligatorios');
  }
  return config;
};

const normalizeOdooError = (err) => {
  if (!err) return 'Error desconocido';
  if (err.faultString) return err.faultString;
  if (err.message) return err.message;
  return 'Error comunicando con Odoo';
};

const createOdooSession = async (config) => {
  const cfg = validateConfig(config);
  const commonClient = createXmlRpcClient(cfg.url, 'xmlrpc/2/common');
  const uid = await callXmlRpc(commonClient, 'authenticate', [cfg.db_name, cfg.username, cfg.password, {}]);
  if (!uid) throw new Error('Autenticación en Odoo rechazada');
  const versionInfo = await callXmlRpc(commonClient, 'version', []).catch(() => null);
  return { config: cfg, uid, versionInfo };
};

const executeKw = async (session, model, method, args = [], kwargs = {}) => {
  const { config, uid } = session;
  const objectClient = createXmlRpcClient(config.url, 'xmlrpc/2/object');
  return callXmlRpc(objectClient, 'execute_kw', [
    config.db_name,
    uid,
    config.password,
    model,
    method,
    args,
    kwargs || {},
  ]);
};

// Dado un código como "00014" o "14",
// genera variantes equivalentes:
// - texto original
// - sin ceros iniciales
// - versiones con ceros a la izquierda hasta longitud 6
const buildReferenceCandidates = (raw) => {
  const trimmed = (raw || '').trim();
  if (!trimmed) return [];
  const set = new Set();
  set.add(trimmed);
  const withoutZeros = trimmed.replace(/^0+/, '');
  if (withoutZeros && withoutZeros !== trimmed) {
    set.add(withoutZeros);
  }
  const num = Number(withoutZeros || trimmed);
  if (Number.isInteger(num) && num >= 0) {
    const asStr = String(num);
    set.add(asStr);
    for (let len = asStr.length + 1; len <= 6; len += 1) {
      set.add(asStr.padStart(len, '0'));
    }
  }
  return Array.from(set);
};

const extractBase64Image = (raw) => {
  if (!raw) return '';
  const str = String(raw);
  const commaIdx = str.indexOf(',');
  if (commaIdx >= 0) {
    return str.slice(commaIdx + 1).trim();
  }
  return str.trim();
};

const parseCoords = (lat, lng) => {
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
  return { lat: latNum, lng: lngNum };
};

// Normaliza empresa para campos many2one/char mixtos
const normalizeCompany = (raw) => {
  if (!raw && raw !== 0) return '';
  if (Array.isArray(raw) && raw.length >= 2) return String(raw[1] || '').trim();
  if (typeof raw === 'string') return raw.trim();
  if (raw && typeof raw.name === 'string') return raw.name.trim();
  return String(raw || '').trim();
};

const normalizeLandscape = (raw, landscapeMap = null) => {
  const extract = (value) => {
    if (!value && value !== 0) return { id: null, name: '' };
    if (Array.isArray(value) && value.length >= 2) {
      const parsedId = Number(value[0]);
      return {
        id: Number.isInteger(parsedId) ? parsedId : null,
        name: value[1] != null ? String(value[1]).trim() : '',
      };
    }
    if (typeof value === 'object') {
      const parsedId = Number(value.id);
      return {
        id: Number.isInteger(parsedId) ? parsedId : null,
        name: value.name != null ? String(value.name).trim() : '',
      };
    }
    const parsedId = Number(value);
    return { id: Number.isInteger(parsedId) ? parsedId : null, name: '' };
  };
  const parsed = extract(raw);
  if (parsed.id != null && landscapeMap && landscapeMap.has(parsed.id)) {
    const fromMap = landscapeMap.get(parsed.id);
    return { id: parsed.id, name: (parsed.name || fromMap?.name || '').trim() };
  }
  return parsed;
};

const mapParcelRecord = (p, sigpacs = [], landscapeMap = null) => {
  const landscape = normalizeLandscape(p.landscape_id, landscapeMap);
  return {
    id: p.id,
    name: p.name || '',
    common_name: p.common_name || '',
    company: normalizeCompany(p.company_id),
    contract_percentage: p.contract_percentage != null ? Number(p.contract_percentage) : null,
    notes: p.notes || '',
    landscape_id: landscape.id,
    landscape_name: landscape.name || '',
    sigpacs: Array.isArray(sigpacs) ? sigpacs.map((s) => ({
      id: s.id,
      municipio: s.municipio || '',
      poligono: s.poligono || '',
      parcela: s.parcela || '',
      recinto: s.recinto || '',
    })) : [],
  };
};

const pickFirstValue = (obj, keys = []) => {
  if (!obj) return '';
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      const value = obj[key];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) return trimmed;
      } else if (value !== '') {
        return String(value);
      }
    }
  }
  return '';
};

const normalizeSigpacRecord = (raw, detailsMap = null) => {
  if (!raw) return null;
  const id = Number(raw.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const parcelIdRaw = raw.parcel_id != null
    ? (Array.isArray(raw.parcel_id) ? raw.parcel_id[0] : raw.parcel_id)
    : raw.parcel_id;
  const parsedParcelId = Number(parcelIdRaw);
  const sigpacRefId = raw.sigpac_id != null
    ? (Array.isArray(raw.sigpac_id) ? raw.sigpac_id[0] : raw.sigpac_id)
    : null;
  const detail = detailsMap && sigpacRefId && detailsMap.get(sigpacRefId) ? detailsMap.get(sigpacRefId) : null;
  const municipio = pickFirstValue(detail, ['municipio'])
    || pickFirstValue(raw, ['sigpac_municipio', 'municipio', 'municipality', 'province']);
  const poligono = pickFirstValue(detail, ['poligono'])
    || pickFirstValue(raw, ['sigpac_poligono', 'poligono', 'polygon']);
  const parcela = pickFirstValue(detail, ['parcela'])
    || pickFirstValue(raw, ['sigpac_parcela', 'parcela', 'parcel']);
  const recinto = pickFirstValue(detail, ['recinto'])
    || pickFirstValue(raw, ['sigpac_recinto', 'recinto', 'enclosure', 'zone']);
  const code = pickFirstValue(raw, ['code']);
  return {
    id,
    parcel_id: Number.isInteger(parsedParcelId) && parsedParcelId > 0 ? parsedParcelId : null,
    municipio,
    poligono,
    parcela,
    recinto,
    code,
  };
};

const groupSigpacsByParcel = (sigpacs) => {
  const map = new Map();
  for (const sigpac of sigpacs) {
    if (!sigpac || !Number.isInteger(sigpac.parcel_id)) continue;
    if (!map.has(sigpac.parcel_id)) map.set(sigpac.parcel_id, []);
    map.get(sigpac.parcel_id).push(sigpac);
  }
  return map;
};

const fetchLandscapesFromOdoo = async (session) => {
  try {
    const records = await executeKw(
      session,
      'product.parcel.landscape',
      'search_read',
      [[]],
      { fields: ['id', 'name'], limit: 5000 }
    );
    const items = [];
    const map = new Map();
    for (const rec of Array.isArray(records) ? records : []) {
      const parsedId = Number(rec.id);
      if (!Number.isInteger(parsedId) || parsedId <= 0) continue;
      const entry = {
        id: parsedId,
        name: rec.name != null ? String(rec.name).trim() : '',
      };
      items.push(entry);
      map.set(parsedId, entry);
    }
    console.log(`[odoo] Parajes obtenidos: ${items.length}`);
    return { items, map };
  } catch (err) {
    console.log('[odoo] Error leyendo product.parcel.landscape:', err && err.message ? err.message : err);
    return { items: [], map: new Map() };
  }
};

const fetchSigpacDetailMap = async (session, ids) => {
  if (!Array.isArray(ids) || !ids.length) return new Map();
  const models = ['product.sigpac', 'sigpac.sigpac'];
  for (const model of models) {
    try {
      const records = await executeKw(
        session,
        model,
        'read',
        [ids],
        { fields: ['id', 'municipio', 'poligono', 'parcela', 'recinto', 'sigpac_municipio', 'sigpac_poligono', 'sigpac_parcela', 'sigpac_recinto', 'name'] }
      );
      if (Array.isArray(records) && records.length) {
        const map = new Map();
        for (const rec of records) {
          const id = Number(rec.id);
          if (!Number.isInteger(id)) continue;
          const municipio = rec.sigpac_municipio || rec.municipio || '';
          const poligono = rec.sigpac_poligono || rec.poligono || '';
          const parcela = rec.sigpac_parcela || rec.parcela || '';
          const recinto = rec.sigpac_recinto || rec.recinto || '';
          map.set(id, { municipio, poligono, parcela, recinto, name: rec.name || '' });
        }
        return map;
      }
    } catch (_) {
      // probar siguiente modelo
    }
  }
  return new Map();
};

const collectSigpacIdsMap = (parcels) => {
  const ids = new Set();
  const idToParcel = new Map();
  for (const parcel of Array.isArray(parcels) ? parcels : []) {
    const parcelId = Number(parcel?.id);
    if (!Number.isInteger(parcelId) || parcelId <= 0) continue;
    const sigIds = Array.isArray(parcel?.sigpac_ids) ? parcel.sigpac_ids : [];
    for (const rawId of sigIds) {
      const parsed = Number(Array.isArray(rawId) ? rawId[0] : rawId);
      if (!Number.isInteger(parsed) || parsed <= 0) continue;
      ids.add(parsed);
      if (!idToParcel.has(parsed)) {
        idToParcel.set(parsed, parcelId);
      }
    }
  }
  return { ids: Array.from(ids), idToParcel };
};

const fetchSigpacsForParcels = async (session, parcels) => {
  const parcelIds = Array.isArray(parcels)
    ? parcels.map((parcel) => Number(parcel?.id)).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  const { ids: sigpacIds, idToParcel } = collectSigpacIdsMap(parcels);
  if (!parcelIds.length) return new Map();
  console.log(
    `[odoo] Buscando sigpacs para ${parcelIds.length} parcelas (IDs: ${parcelIds.slice(0, 10).join(', ')}${
      parcelIds.length > 10 ? ', ...' : ''
    })`
  );

  const normalizeFromParcelRecords = async (rawList) => {
    const arr = Array.isArray(rawList) ? rawList : [];
    if (!arr.length) return [];
    const missingDetailIds = new Set();
    for (const raw of arr) {
      if (!raw) continue;
      const municipio = raw.sigpac_municipio || raw.municipio || raw.municipality || '';
      const poligono = raw.sigpac_poligono || raw.poligono || raw.polygon || '';
      const parcela = raw.sigpac_parcela || raw.parcela || raw.parcel || '';
      const recinto = raw.sigpac_recinto || raw.recinto || raw.enclosure || raw.zone || '';
      const refId = raw.sigpac_id != null ? (Array.isArray(raw.sigpac_id) ? raw.sigpac_id[0] : raw.sigpac_id) : null;
      if ((!municipio && !poligono && !parcela && !recinto) && Number.isInteger(Number(refId))) {
        missingDetailIds.add(Number(refId));
      }
    }
    const detailMap = missingDetailIds.size
      ? await fetchSigpacDetailMap(session, Array.from(missingDetailIds))
      : new Map();
    if (missingDetailIds.size) {
      console.log(`[odoo] Sigpacs sin detalle: ${missingDetailIds.size}. Recuperados: ${detailMap.size}`);
    }
    return arr.map((raw) => normalizeSigpacRecord(raw, detailMap)).filter((item) => item && Number.isInteger(item.parcel_id));
  };

  const tryParcelSigpacs = async () => {
    const baseFields = [
      'id',
      'parcel_id',
      'municipality',
      'polygon',
      'parcel',
      'enclosure',
      'code',
    ];
    try {
      const searchRes = await executeKw(
        session,
        'product.parcel.sigpac',
        'search_read',
        [[['parcel_id', 'in', parcelIds]]],
        { fields: baseFields, limit: 50000 }
      );
      const normalized = await normalizeFromParcelRecords(searchRes);
      if (normalized.length) {
        console.log(`[odoo] Sigpacs obtenidos vía product.parcel.sigpac/search: ${normalized.length}`);
        return normalized;
      }
    } catch (err) {
      console.log('[odoo] Error leyendo product.parcel.sigpac con search_read:', err && err.message ? err.message : err);
    }

    if (sigpacIds.length) {
      try {
        const readRes = await executeKw(session, 'product.parcel.sigpac', 'read', [sigpacIds], { fields: baseFields });
        const normalized = await normalizeFromParcelRecords(readRes);
        if (normalized.length) {
          console.log(`[odoo] Sigpacs obtenidos vía product.parcel.sigpac/read: ${normalized.length}`);
          return normalized;
        }
      } catch (err) {
        console.log('[odoo] Error leyendo product.parcel.sigpac con read:', err && err.message ? err.message : err);
      }
    }
    return [];
  };

  const normalizedParcelSigpacs = await tryParcelSigpacs();
  if (normalizedParcelSigpacs.length) {
    return groupSigpacsByParcel(normalizedParcelSigpacs);
  }

  if (!sigpacIds.length) {
    console.log('[odoo] Sin sigpac_ids para intentar fallback en otros modelos.');
    return new Map();
  }

  const tryGenericModel = async (modelName) => {
    try {
      const records = await executeKw(
        session,
        modelName,
        'read',
        [sigpacIds],
        {
          fields: ['id', 'parcel_id', 'municipality', 'polygon', 'parcel', 'enclosure', 'code'],
        }
      );
      const arr = Array.isArray(records) ? records : [];
      if (!arr.length) return [];
      return arr
        .map((rec) => {
          const id = Number(rec && rec.id);
          const parcelId = idToParcel.get(id);
          if (!Number.isInteger(id) || !Number.isInteger(parcelId)) return null;
          return {
            id,
            parcel_id: parcelId,
            municipio: rec.sigpac_municipio || rec.municipio || rec.municipality || '',
            poligono: rec.sigpac_poligono || rec.poligono || rec.polygon || '',
            parcela: rec.sigpac_parcela || rec.parcela || '',
            recinto: rec.sigpac_recinto || rec.recinto || rec.enclosure || '',
          };
        })
        .filter((item) => item && Number.isInteger(item.parcel_id));
    } catch (err) {
      console.log(`[odoo] Error leyendo ${modelName}:`, err && err.message ? err.message : err);
      return [];
    }
  };

  for (const model of ['product.sigpac', 'sigpac.sigpac']) {
    console.log(`[odoo] Intentando fallback en modelo ${model} (IDs: ${sigpacIds.slice(0, 10).join(', ')}${sigpacIds.length > 10 ? ', ...' : ''})`);
    const normalized = await tryGenericModel(model);
    console.log(`[odoo] Fallback ${model} registros normalizados: ${normalized.length}`);
    if (normalized.length) {
      return groupSigpacsByParcel(normalized);
    }
  }

  console.log('[odoo] No se encontraron registros de SIGPAC en ningún modelo conocido.');
  return new Map();
};

const fetchOlivosFromOdoo = async (session, limit = 10000) => {
  const effectiveLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 20000) : 10000;
  try {
    const products = await executeKw(
      session,
      'product.product',
      'search_read',
      [[['categ_id.name', '=', 'Olivo']]],
      { fields: ['id', 'name', 'default_code', 'parcel_id', 'product_tmpl_id'], limit: effectiveLimit }
    );
    return Array.isArray(products) ? products : [];
  } catch (err) {
    console.log('[odoo] Error leyendo productos de categoría Olivo:', err && err.message ? err.message : err);
    return [];
  }
};

const upsertOdooParcelLocal = async (parcel, countryCode) => {
  const {
    id,
    name,
    common_name,
    company,
    contract_percentage,
    notes,
    landscape_id,
  } = parcel || {};
  if (!Number.isInteger(id) || id <= 0) return { inserted: false };
  await db.public.none(
    `INSERT INTO odoo_parcelas(id, name, common_name, company, contract_percentage, notes, landscape_id, country_code, updated_at)
     VALUES($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (id, country_code) DO UPDATE SET
       name = EXCLUDED.name,
       common_name = EXCLUDED.common_name,
       company = EXCLUDED.company,
       contract_percentage = EXCLUDED.contract_percentage,
       notes = EXCLUDED.notes,
       landscape_id = EXCLUDED.landscape_id,
       updated_at = now()`,
    [id, name, common_name, company, contract_percentage, notes, landscape_id ?? null, countryCode]
  );
  return { inserted: true };
};

const replaceOdooParcelSigpacs = async (parcelId, sigpacs, countryCode) => {
  if (!Number.isInteger(parcelId) || parcelId <= 0) return;
  await db.public.none(
    'DELETE FROM odoo_parcel_sigpacs WHERE parcel_id = $1 AND country_code = $2',
    [parcelId, countryCode]
  );
  if (!Array.isArray(sigpacs) || sigpacs.length === 0) return;
  const values = [];
  const params = [];
  let idx = 1;
  for (const sigpac of sigpacs) {
    if (!sigpac || !Number.isInteger(sigpac.id)) continue;
    values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, now())`);
    params.push(
      sigpac.id,
      parcelId,
      sigpac.municipio || '',
      sigpac.poligono || '',
      sigpac.parcela || '',
      sigpac.recinto || '',
      countryCode
    );
    idx += 7;
  }
  if (!values.length) return;
  await db.public.none(
    `INSERT INTO odoo_parcel_sigpacs(id, parcel_id, municipio, poligono, parcela, recinto, country_code, updated_at)
     VALUES ${values.join(', ')}
    ON CONFLICT (id, country_code) DO UPDATE SET
       parcel_id = EXCLUDED.parcel_id,
       municipio = EXCLUDED.municipio,
       poligono = EXCLUDED.poligono,
       parcela = EXCLUDED.parcela,
       recinto = EXCLUDED.recinto,
       updated_at = now()`,
    params
  );
};

const normalizeNullableText = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
};

const upsertLandscapeLocal = async (landscape, countryCode) => {
  const parsedId = Number(landscape?.id);
  if (!Number.isInteger(parsedId) || parsedId <= 0) return false;
  const name = landscape?.name != null ? String(landscape.name).trim() : '';
  await db.public.none(
    `INSERT INTO odoo_landscapes(id, name, country_code, updated_at)
     VALUES($1, $2, $3, now())
     ON CONFLICT (id, country_code) DO UPDATE SET
       name = EXCLUDED.name,
       updated_at = now()`,
    [parsedId, name, countryCode]
  );
  let ensuredParaje = true;
  try {
    await db.public.none(
      `INSERT INTO parajes(id, nombre, country_code)
       VALUES($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, country_code = EXCLUDED.country_code`,
      [parsedId, name, countryCode]
    );
  } catch (_) {
    // Si hay conflictos por nombre, preferimos mantener el registro existente.
    ensuredParaje = false;
  }
  return { inserted: true, ensuredParaje };
};

const upsertParcelaFromOdoo = async (parcel, countryCode) => {
  const parsedId = Number(parcel?.id);
  if (!Number.isInteger(parsedId) || parsedId <= 0) return false;
  const name = normalizeNullableText(parcel?.name);
  const commonName = normalizeNullableText(parcel?.common_name);
  const percentage = parcel?.contract_percentage != null && Number.isFinite(Number(parcel.contract_percentage))
    ? Number(parcel.contract_percentage)
    : null;
  const landscapeIdRaw = Number(parcel?.landscape_id);
  const landscapeId = Number.isInteger(landscapeIdRaw) && landscapeIdRaw > 0 ? landscapeIdRaw : null;
  let landscapeAllowed = landscapeId;
  if (landscapeId) {
    const result = await upsertLandscapeLocal({
      id: landscapeId,
      name: parcel?.landscape_name || '',
    }, countryCode);
    if (!result || result.ensuredParaje === false) {
      landscapeAllowed = null;
    }
  }
  const sigpacs = Array.isArray(parcel?.sigpacs) ? parcel.sigpacs : [];
  const firstSigpac = sigpacs.find((s) => s && (s.municipio || s.poligono || s.parcela || s.recinto));
  const sigpacMunicipio = normalizeNullableText(firstSigpac?.municipio);
  const sigpacPoligono = normalizeNullableText(firstSigpac?.poligono);
  const sigpacParcela = normalizeNullableText(firstSigpac?.parcela);
  const sigpacRecinto = normalizeNullableText(firstSigpac?.recinto);

  await db.public.none(
    `INSERT INTO parcelas(
       id,
       nombre,
       nombre_interno,
       porcentaje,
       paraje_id,
       sigpac_municipio,
       sigpac_poligono,
       sigpac_parcela,
       sigpac_recinto,
       country_code
     ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       nombre = COALESCE(EXCLUDED.nombre, parcelas.nombre),
       nombre_interno = COALESCE(EXCLUDED.nombre_interno, parcelas.nombre_interno),
       porcentaje = COALESCE(EXCLUDED.porcentaje, parcelas.porcentaje),
       paraje_id = COALESCE(EXCLUDED.paraje_id, parcelas.paraje_id),
       sigpac_municipio = COALESCE(EXCLUDED.sigpac_municipio, parcelas.sigpac_municipio),
       sigpac_poligono = COALESCE(EXCLUDED.sigpac_poligono, parcelas.sigpac_poligono),
       sigpac_parcela = COALESCE(EXCLUDED.sigpac_parcela, parcelas.sigpac_parcela),
       sigpac_recinto = COALESCE(EXCLUDED.sigpac_recinto, parcelas.sigpac_recinto),
      country_code = EXCLUDED.country_code`,
    [
      parsedId,
      name,
      commonName,
      percentage,
      landscapeAllowed,
      sigpacMunicipio,
      sigpacPoligono,
      sigpacParcela,
      sigpacRecinto,
      countryCode,
    ]
  );
  return true;
};

const upsertOdooOlivoLocal = async (olivo, countryCode) => {
  const parsedId = Number(olivo?.id);
  if (!Number.isInteger(parsedId) || parsedId <= 0) return false;
  const parcelIdRaw = olivo?.parcel_id != null
    ? (Array.isArray(olivo.parcel_id) ? olivo.parcel_id[0] : olivo.parcel_id)
    : null;
  const parcelId = Number(parcelIdRaw);
  const normalizedParcelId = Number.isInteger(parcelId) && parcelId > 0 ? parcelId : null;
  if (normalizedParcelId) {
    await ensureParcelaStub({ id: normalizedParcelId }, countryCode);
  }
  await db.public.none(
    `INSERT INTO odoo_olivos(id, name, default_code, parcel_id, product_tmpl_id, country_code, updated_at)
     VALUES($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (id, country_code) DO UPDATE SET
       name = EXCLUDED.name,
       default_code = EXCLUDED.default_code,
       parcel_id = EXCLUDED.parcel_id,
       product_tmpl_id = EXCLUDED.product_tmpl_id,
       updated_at = now()`,
    [
      parsedId,
      olivo?.name || '',
      olivo?.default_code || '',
      normalizedParcelId,
      olivo?.product_tmpl_id || null,
      countryCode,
    ]
  );
  await db.public.none(
    `INSERT INTO olivos(id, id_parcela, country_code)
     VALUES($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       id_parcela = EXCLUDED.id_parcela,
       country_code = EXCLUDED.country_code`,
    [parsedId, normalizedParcelId, countryCode]
  );
  return true;
};

// Asegura que existe una fila en parcelas con el id de Odoo (actualizando campos básicos)
const ensureParcelaStub = async (parcel, countryCode) => {
  const parsedId = Number(parcel?.id);
  if (!Number.isInteger(parsedId) || parsedId <= 0) return false;
  const payload = {
    id: parsedId,
    name: parcel?.name || parcel?.nombre || null,
    common_name: parcel?.common_name || parcel?.nombre_interno || null,
    contract_percentage: parcel?.contract_percentage != null
      ? parcel.contract_percentage
      : parcel?.porcentaje,
    landscape_id: parcel?.landscape_id,
    sigpacs: parcel?.sigpacs || [],
  };
  await upsertParcelaFromOdoo(payload, countryCode);
  return true;
};

router.get('/odoo/config', requireAuth, requireAdmin, async (req, res) => {
  const country = resolveCountry(req, req.query && req.query.country_code);
  const config = await fetchConfigByCountry(country);
  if (!config) return res.json({ config: null });
  return res.json({ config: publicConfig(config) });
});

router.post('/odoo/config', requireAuth, requireAdmin, async (req, res) => {
  const country = resolveCountry(req, req.body && req.body.country_code);
  const stored = await fetchConfigByCountry(country);
  const effective = buildEffectiveConfig({ ...(req.body || {}), country_code: country }, stored, country);
  try {
    validateConfig(effective);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Config incompleta' });
  }
  try {
    const saved = await upsertConfig(effective);
    const status = stored ? 200 : 201;
    return res.status(status).json({ config: publicConfig(saved) });
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo guardar la configuración' });
  }
});

router.post('/odoo/test-connection', requireAuth, requireAdmin, async (req, res) => {
  const country = resolveCountry(req, req.body && req.body.country_code);
  const stored = await fetchConfigByCountry(country);
  const effective = buildEffectiveConfig({ ...(req.body || {}), country_code: country }, stored, country);
  try {
    const session = await createOdooSession(effective);
    return res.json({
      ok: true,
      uid: session.uid,
      db_name: effective.db_name,
      server_version: session.versionInfo && (session.versionInfo.server_version || session.versionInfo.server_serie || session.versionInfo.release_version),
      country_code: effective.country_code,
    });
  } catch (err) {
    return res.status(400).json({ error: normalizeOdooError(err) });
  }
});

router.post('/odoo/products/lookup', requireAuth, requireAdmin, async (req, res) => {
  const country = resolveCountry(req, req.body && req.body.country_code);
  const { reference } = req.body || {};
  const trimmedRef = reference && String(reference).trim();
  if (!trimmedRef) return res.status(400).json({ error: 'Referencia de producto requerida' });
  const stored = await fetchConfigByCountry(country);
  const effective = buildEffectiveConfig({ ...(req.body || {}), country_code: country }, stored, country);
  try {
    const session = await createOdooSession(effective);
    const refCandidates = buildReferenceCandidates(trimmedRef);
    const products = await executeKw(
      session,
      'product.product',
      'search_read',
      [[['default_code', 'in', refCandidates]]],
      { fields: ['id', 'name', 'product_tmpl_id', 'image_1920'], limit: 1 }
    );
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado en Odoo' });
    }
    const product = products[0];
    const templateId = Array.isArray(product.product_tmpl_id) ? product.product_tmpl_id[0] : product.product_tmpl_id;
    let mainImage = product && product.image_1920 ? product.image_1920 : null;
    let parcelaId = null;
    let parcelaNombre = null;
    let extraImages = [];
    if (templateId) {
      try {
        const tmpl = await executeKw(
          session,
          'product.template',
          'read',
          [[templateId]],
          { fields: ['image_1920', 'parcel_id'] }
        );
        if (Array.isArray(tmpl) && tmpl[0]) {
          if (tmpl[0].image_1920) {
            mainImage = tmpl[0].image_1920;
          }
          if (tmpl[0].parcel_id) {
            const raw = tmpl[0].parcel_id;
            if (Array.isArray(raw) && raw.length >= 2) {
              parcelaId = raw[0];
              parcelaNombre = raw[1];
            }
          }
        }
      } catch (_) {
        // ignorar si los campos no existen
      }
      try {
        const images = await executeKw(
          session,
          'product.image',
          'search_read',
          [[['product_tmpl_id', '=', templateId], ['image_1920', '!=', false]]],
          { fields: ['id', 'name', 'image_1920'], limit: 10 }
        );
        if (Array.isArray(images)) {
          extraImages = images
            .map((img) => img && img.image_1920)
            .filter((img) => typeof img === 'string' && img.length > 0);
        }
      } catch (_) {
        // ignorar si el modelo product.image no existe
      }
    }
    // Fallback: intentar leer parcel_id desde product.product si existe el campo
    if (!parcelaId && !parcelaNombre) {
      try {
        const prodRead = await executeKw(
          session,
          'product.product',
          'read',
          [[product.id]],
          { fields: ['parcel_id'] }
        );
        if (Array.isArray(prodRead) && prodRead[0] && prodRead[0].parcel_id) {
          const raw = prodRead[0].parcel_id;
          if (Array.isArray(raw) && raw.length >= 2) {
            parcelaId = raw[0];
            parcelaNombre = raw[1];
          }
        }
      } catch (_) {
        // ignorar si el campo parcel_id no existe en product.product
      }
    }
    if (!mainImage) {
      mainImage = null;
    }
    if (mainImage && Array.isArray(extraImages) && extraImages.length) {
      extraImages = extraImages.filter((img) => img !== mainImage);
    }
    return res.json({
      id: product.id,
      name: product.name,
      template_id: templateId,
      reference: trimmedRef,
      image_1920: mainImage,
      parcela_id: parcelaId,
      parcela_nombre: parcelaNombre,
      extra_images: extraImages,
    });
  } catch (err) {
    return res.status(400).json({ error: normalizeOdooError(err) });
  }
});

// Lookup olivo in Odoo by internal reference (default_code)
// Restricted to products in category "Olivo".
// Returns parcela info (id, name, contract_percentage) without modifying local DB.
router.post('/odoo/olivos/lookup', requireAuth, requireAdmin, async (req, res) => {
  const country = resolveCountry(req, req.body && req.body.country_code);
  const { reference } = req.body || {};
  const trimmedRef = reference && String(reference).trim();
  if (!trimmedRef) return res.status(400).json({ error: 'Referencia de olivo requerida' });

  const stored = await fetchConfigByCountry(country);
  const effective = buildEffectiveConfig({ ...(req.body || {}), country_code: country }, stored, country);

  try {
    const session = await createOdooSession(effective);
    // Buscar producto de categoría Olivo con esa referencia interna
    const refCandidates = buildReferenceCandidates(trimmedRef);
    const products = await executeKw(
      session,
      'product.product',
      'search_read',
      [[['default_code', 'in', refCandidates], ['categ_id.name', '=', 'Olivo']]],
      { fields: ['id', 'name', 'product_tmpl_id', 'parcel_id'], limit: 1 }
    );
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(404).json({ error: 'Olivo no encontrado en Odoo' });
    }
    const product = products[0];

    // Obtener parcel_id desde producto o plantilla
    let parcelaId = null;
    let parcelaNombre = null;
    let contractPercentage = null;

    const extractParcelInfo = (raw) => {
      if (!raw) return null;
      if (Array.isArray(raw) && raw.length >= 2) {
        return { id: raw[0], name: raw[1] };
      }
      if (typeof raw === 'object' && raw.id != null) {
        return { id: raw.id, name: raw.name || '' };
      }
      return null;
    };

    let parcelInfo = extractParcelInfo(product.parcel_id);

    // Fallback a la plantilla si no viene parcel_id en product.product
    const templateId = Array.isArray(product.product_tmpl_id)
      ? product.product_tmpl_id[0]
      : product.product_tmpl_id;

    if (!parcelInfo && templateId) {
      try {
        const tmpl = await executeKw(
          session,
          'product.template',
          'read',
          [[templateId]],
          { fields: ['parcel_id'] }
        );
        if (Array.isArray(tmpl) && tmpl[0]) {
          parcelInfo = extractParcelInfo(tmpl[0].parcel_id);
        }
      } catch (_) {
        // ignorar si el campo no existe
      }
    }

    if (!parcelInfo || parcelInfo.id == null) {
      return res.status(404).json({ error: 'Parcela asociada no encontrada en Odoo' });
    }

    parcelaId = parcelInfo.id;
    parcelaNombre = parcelInfo.name || '';

    // Leer porcentaje de donación desde product.parcel
    try {
      const parcels = await executeKw(
        session,
        'product.parcel',
        'read',
        [[parcelaId]],
        { fields: ['name', 'contract_percentage'] }
      );
      if (Array.isArray(parcels) && parcels[0]) {
        parcelaNombre = parcels[0].name || parcelaNombre;
        if (parcels[0].contract_percentage != null) {
          contractPercentage = Number(parcels[0].contract_percentage);
        }
      }
    } catch (_) {
      // ignorar si el modelo o el campo no existen
    }

    // Guardar copia local mínima para usar offline y evitar fallos de FK
    try {
      await upsertOdooParcelLocal({
        id: parcelaId,
        name: parcelaNombre || '',
        common_name: '',
        company: '',
        contract_percentage: contractPercentage,
        notes: '',
      }, country);
      await ensureParcelaStub({
        id: parcelaId,
        name: parcelaNombre || '',
        common_name: '',
        contract_percentage: contractPercentage,
      }, country);
      await upsertOdooOlivoLocal({
        id: product.id,
        name: product.name || '',
        default_code: trimmedRef,
        parcel_id: parcelaId,
        product_tmpl_id: templateId || null,
      }, country);
    } catch (_) {
      // Si falla la persistencia local, no bloqueamos la respuesta
    }

    return res.json({
      reference: trimmedRef,
      product_id: product.id,
      parcela_id: parcelaId,
      parcela_nombre: parcelaNombre,
      contract_percentage: contractPercentage,
    });
  } catch (err) {
    return res.status(400).json({ error: normalizeOdooError(err) });
  }
});

router.post('/odoo/products/:id/photo', requireAuth, requireAdmin, async (req, res) => {
  const productId = Number(req.params.id);
  const { image_base64, filename, latitude, longitude, template_id, reference } = req.body || {};
  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({ error: 'ID de producto inválido' });
  }
  const base64 = extractBase64Image(image_base64);
  if (!base64) return res.status(400).json({ error: 'Imagen requerida' });
  const coords = parseCoords(latitude, longitude);
  const country = resolveCountry(req, req.body && req.body.country_code);
  const stored = await fetchConfigByCountry(country);
  const effective = buildEffectiveConfig({ ...(req.body || {}), country_code: country }, stored, country);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeRef = reference && String(reference).trim() ? String(reference).trim() : `PRODUCTO-${productId}`;
  const fallbackName = `Olivo-${safeRef}_${timestamp}-foto.jpg`;
  const safeName = (filename && String(filename).trim()) ? String(filename).trim() : fallbackName;
  const descriptionParts = ['Subida desde TrazOliva'];
  if (coords) {
    descriptionParts.push(`GPS: ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`);
  }
  const templateIdNum = Number(template_id);
  const hasTemplate = Number.isInteger(templateIdNum) && templateIdNum > 0;
  const resModel = hasTemplate ? 'product.template' : 'product.product';
  const resId = hasTemplate ? templateIdNum : productId;

  try {
    const session = await createOdooSession(effective);
    let effectiveTemplateId = templateIdNum;
    if (!hasTemplate) {
      try {
        const prodRead = await executeKw(
          session,
          'product.product',
          'read',
          [[productId]],
          { fields: ['product_tmpl_id'] }
        );
        if (Array.isArray(prodRead) && prodRead[0] && prodRead[0].product_tmpl_id) {
          const raw = prodRead[0].product_tmpl_id;
          const tmplId = Array.isArray(raw) ? raw[0] : raw;
          if (Number.isInteger(Number(tmplId))) {
            effectiveTemplateId = Number(tmplId);
          }
        }
      } catch (_) {
        // ignorar si el campo no existe
      }
    }

    let imageId = null;
    if (Number.isInteger(effectiveTemplateId) && effectiveTemplateId > 0) {
      imageId = await executeKw(session, 'product.image', 'create', [{
        product_tmpl_id: effectiveTemplateId,
        name: safeName,
        image_1920: base64,
      }]);
    }

    const attachmentId = await executeKw(session, 'ir.attachment', 'create', [{
      name: safeName,
      datas: base64,
      res_model: resModel,
      res_id: resId,
      mimetype: 'image/jpeg',
      description: descriptionParts.join(' | '),
    }]);
    if (coords) {
      try {
        const records = await executeKw(
          session,
          resModel,
          'read',
          [[resId]],
          { fields: ['description'] }
        );
        let currentDesc = '';
        if (Array.isArray(records) && records[0] && typeof records[0].description === 'string') {
          currentDesc = records[0].description;
        }
        const gpsNote = `GPS TrazOliva: ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`;
        if (!currentDesc.includes(gpsNote)) {
          const nextDesc = currentDesc && currentDesc.trim().length
            ? `${currentDesc.trim()}\n${gpsNote}`
            : gpsNote;
          await executeKw(
            session,
            resModel,
            'write',
            [[resId], { description: nextDesc }]
          );
        }
      } catch (_) {
        // ignorar errores al actualizar notas internas
      }
    }
    return res.json({
      ok: true,
      attachment_id: attachmentId,
      res_model: resModel,
      res_id: resId,
      image_id: imageId,
      coords: coords || null,
    });
  } catch (err) {
    return res.status(400).json({ error: normalizeOdooError(err) });
  }
});

router.get('/odoo/parcelas', requireAuth, requireAdmin, async (req, res) => {
  const country = resolveCountry(req, req.query && req.query.country_code);
  const stored = await fetchConfigByCountry(country);
  const effective = buildEffectiveConfig({ ...(req.query || {}), country_code: country }, stored, country);
  try {
    const session = await createOdooSession(effective);
    const { items: landscapes, map: landscapeMap } = await fetchLandscapesFromOdoo(session);
    const limitRaw = Number(req.query && req.query.limit);
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 2000) : 1000;
    const domain = []; // todas las parcelas
    const parcels = await executeKw(
      session,
      'product.parcel',
      'search_read',
      [domain],
      {
        fields: ['id', 'name', 'common_name', 'company_id', 'contract_percentage', 'notes', 'sigpac_ids', 'landscape_id'],
        limit,
      }
    );
    const sigpacsByParcel = await fetchSigpacsForParcels(session, parcels);
    const items = Array.isArray(parcels)
      ? parcels.map((p) => mapParcelRecord(p, sigpacsByParcel.get(p.id) || [], landscapeMap))
      : [];
    return res.json({ items, count: items.length, landscapes: landscapes.length });
  } catch (err) {
    return res.status(400).json({ error: normalizeOdooError(err) });
  }
});

// Sincroniza parcelas de Odoo a tabla local odoo_parcelas y asegura stub en parcelas
router.post('/odoo/parcelas/sync', requireAuth, requireAdmin, async (req, res) => {
  const country = resolveCountry(req, req.body && req.body.country_code);
  const stored = await fetchConfigByCountry(country);
  const effective = buildEffectiveConfig({ ...(req.body || {}), country_code: country }, stored, country);
  try {
    const session = await createOdooSession(effective);
    const { items: landscapes, map: landscapeMap } = await fetchLandscapesFromOdoo(session);
    let landscapesSynced = 0;
    for (const landscape of landscapes) {
      try {
        const inserted = await upsertLandscapeLocal(landscape, country);
        if (inserted) landscapesSynced += 1;
      } catch (_) {
        // ignorar errores individuales
      }
    }
    const limitRaw = Number(req.body && req.body.limit);
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 5000) : 2000;
    const parcels = await executeKw(
      session,
      'product.parcel',
      'search_read',
      [[]],
      {
        fields: ['id', 'name', 'common_name', 'company_id', 'contract_percentage', 'notes', 'sigpac_ids', 'landscape_id'],
        limit,
      }
    );
    const sigpacsByParcel = await fetchSigpacsForParcels(session, parcels);
    const items = Array.isArray(parcels)
      ? parcels.map((p) => mapParcelRecord(p, sigpacsByParcel.get(p.id) || [], landscapeMap))
      : [];
    let synced = 0;
    let ensuredParcelas = 0;
    for (const parcel of items) {
      try {
        await upsertOdooParcelLocal(parcel, country);
        await replaceOdooParcelSigpacs(parcel.id, parcel.sigpacs || [], country);
        await upsertParcelaFromOdoo(parcel, country);
        synced += 1;
        ensuredParcelas += 1;
      } catch (_) {
        // continuar con el resto
      }
    }
    return res.json({
      ok: true,
      synced,
      ensuredParcelas,
      landscapesSynced,
      country_code: country,
    });
  } catch (err) {
    return res.status(400).json({ error: normalizeOdooError(err) });
  }
});

// Lee las parcelas sincronizadas localmente (sin ir a Odoo)
router.get('/odoo/parcelas/local', requireAuth, requireAdmin, async (req, res) => {
  const country = resolveCountry(req, req.query && req.query.country_code);
  try {
    const parcels = await db.public.many(
      `SELECT op.id, op.name, op.common_name, op.company, op.contract_percentage, op.notes, op.landscape_id, op.updated_at, ol.name AS landscape_name
         FROM odoo_parcelas op
         LEFT JOIN odoo_landscapes ol ON ol.id = op.landscape_id AND ol.country_code = op.country_code
        WHERE op.country_code = $1
        ORDER BY op.id`,
      [country]
    );
    const sigpacsRows = await db.public.many(
      `SELECT id, parcel_id, municipio, poligono, parcela, recinto
         FROM odoo_parcel_sigpacs
        WHERE country_code = $1
        ORDER BY parcel_id, id`,
      [country]
    ).catch(() => []);
    const sigpacsByParcel = new Map();
    for (const row of Array.isArray(sigpacsRows) ? sigpacsRows : []) {
      if (!row || !Number.isInteger(row.parcel_id)) continue;
      if (!sigpacsByParcel.has(row.parcel_id)) sigpacsByParcel.set(row.parcel_id, []);
      sigpacsByParcel.get(row.parcel_id).push({
        id: row.id,
        municipio: row.municipio || '',
        poligono: row.poligono || '',
        parcela: row.parcela || '',
        recinto: row.recinto || '',
      });
    }
    const items = parcels.map((p) => ({
      ...p,
      landscape_id: p.landscape_id != null ? Number(p.landscape_id) : null,
      landscape_name: p.landscape_name || '',
      sigpacs: sigpacsByParcel.get(p.id) || [],
    }));
    const lastSyncRow = await db.public.one(
      'SELECT MAX(updated_at) AS last_sync FROM odoo_parcelas WHERE country_code = $1',
      [country]
    );
    return res.json({
      items,
      count: items.length,
      last_sync_at: lastSyncRow?.last_sync || null,
    });
  } catch (err) {
    return res.status(500).json({ error: 'No se pudieron leer las parcelas locales' });
  }
});

router.post('/odoo/parajes/sync', requireAuth, requireAdmin, async (req, res) => {
  const country = resolveCountry(req, req.body && req.body.country_code);
  const stored = await fetchConfigByCountry(country);
  const effective = buildEffectiveConfig({ ...(req.body || {}), country_code: country }, stored, country);
  try {
    const session = await createOdooSession(effective);
    const { items } = await fetchLandscapesFromOdoo(session);
    let synced = 0;
    for (const landscape of items) {
      try {
        const inserted = await upsertLandscapeLocal(landscape, country);
        if (inserted) synced += 1;
      } catch (_) {
        // continuar con el resto
      }
    }
    return res.json({ ok: true, synced, country_code: country });
  } catch (err) {
    return res.status(400).json({ error: normalizeOdooError(err) });
  }
});

router.get('/odoo/parajes/local', requireAuth, requireAdmin, async (req, res) => {
  const country = resolveCountry(req, req.query && req.query.country_code);
  try {
    const rows = await db.public.many(
      `SELECT id, name, updated_at
         FROM odoo_landscapes
        WHERE country_code = $1
        ORDER BY name`,
      [country]
    );
    const items = rows.map((row) => ({
      id: Number(row.id),
      name: row.name || '',
      updated_at: row.updated_at || null,
    }));
    return res.json({ items, count: items.length });
  } catch (err) {
    return res.status(500).json({ error: 'No se pudieron leer los parajes locales' });
  }
});

router.post('/odoo/olivos/sync', requireAuth, requireAdmin, async (req, res) => {
  const country = resolveCountry(req, req.body && req.body.country_code);
  const stored = await fetchConfigByCountry(country);
  const effective = buildEffectiveConfig({ ...(req.body || {}), country_code: country }, stored, country);
  try {
    const session = await createOdooSession(effective);
    const limitRaw = Number(req.body && req.body.limit);
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 20000) : 10000;
    const olivos = await fetchOlivosFromOdoo(session, limit);
    let synced = 0;
    let ensuredParcelas = 0;
    for (const olivo of olivos) {
      try {
        const parcelIdRaw = Array.isArray(olivo.parcel_id) ? olivo.parcel_id[0] : olivo.parcel_id;
        if (Number.isInteger(Number(parcelIdRaw)) && Number(parcelIdRaw) > 0) {
          ensuredParcelas += 1;
        }
        const mapped = {
          id: olivo.id,
          name: olivo.name,
          default_code: olivo.default_code,
          parcel_id: parcelIdRaw,
          product_tmpl_id: Array.isArray(olivo.product_tmpl_id) ? olivo.product_tmpl_id[0] : olivo.product_tmpl_id,
        };
        const ok = await upsertOdooOlivoLocal(mapped, country);
        if (ok) synced += 1;
      } catch (_) {
        // ignorar y continuar
      }
    }
    return res.json({ ok: true, synced, ensuredParcelas, country_code: country });
  } catch (err) {
    return res.status(400).json({ error: normalizeOdooError(err) });
  }
});

router.get('/odoo/olivos/local', requireAuth, requireAdmin, async (req, res) => {
  const country = resolveCountry(req, req.query && req.query.country_code);
  try {
    const rows = await db.public.many(
      `SELECT oo.id,
              oo.name,
              oo.default_code,
              oo.parcel_id,
              oo.product_tmpl_id,
              op.name AS parcela_nombre,
              op.common_name AS parcela_nombre_interno
         FROM odoo_olivos oo
         LEFT JOIN odoo_parcelas op ON op.id = oo.parcel_id AND op.country_code = oo.country_code
        WHERE oo.country_code = $1
        ORDER BY oo.id`,
      [country]
    );
    const lastSyncRow = await db.public.one(
      'SELECT MAX(updated_at) AS last_sync FROM odoo_olivos WHERE country_code = $1',
      [country]
    );
    return res.json({
      items: rows,
      count: rows.length,
      last_sync_at: lastSyncRow?.last_sync || null,
    });
  } catch (err) {
    return res.status(500).json({ error: 'No se pudieron leer los olivos locales' });
  }
});

module.exports = router;
