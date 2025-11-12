const express = require('express');
const router = express.Router();
const db = require('../db');
const { resolveRequestCountry } = require('../utils/country');

const requireAuth = (req, res, next) => {
  if (!req.userId) return res.status(401).json({ error: 'No autenticado' });
  next();
};
const requireAdmin = (req, res, next) => {
  if (!req.userId || req.userRole !== 'admin') return res.status(403).json({ error: 'Requiere admin' });
  next();
};

function normalizeKey(s) {
  return String(s || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/º/g, 'o')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function pickCsvValue(row, names) {
  for (const raw of names) {
    const key = normalizeKey(raw);
    if (row[key] !== undefined && row[key] !== '') return row[key];
  }
  return '';
}

function parseCsv(text) {
  if (!text || typeof text !== 'string') return { header: [], rows: [] };
  // Strip BOM if present
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // Autodetect delimiter on first line
  let delim = ',';
  {
    let firstLine = '';
    for (let j = 0; j < text.length; j++) {
      const ch = text[j];
      if (ch === '\n') { break; }
      if (ch === '\r') { if (text[j + 1] === '\n') j++; break; }
      firstLine += ch;
    }
    const cand = [',',';','\t','|'];
    let best = ','; let bestCount = -1;
    for (const c of cand) {
      const cnt = (firstLine.match(new RegExp(`\\${c}`, 'g')) || []).length;
      if (cnt > bestCount) { bestCount = cnt; best = c; }
    }
    delim = best;
  }
  const rows = [];
  let row = [''];
  let inQuotes = false;
  let i = 0;
  let lineNo = 1; // 1-based
  const pushRow = () => {
    // Ignore completely empty trailing row
    if (row.length === 1 && row[0] === '') { row = ['']; return; }
    rows.push({ fields: row.slice(), line: lineNo });
    row = [''];
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        row[row.length - 1] += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i += 1;
      continue;
    }
    if (!inQuotes && ch === delim) {
      row.push('');
      i += 1;
      continue;
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      // Handle CRLF as single newline
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      pushRow();
      lineNo += 1;
      i += 1;
      continue;
    }
    // Regular character (including newlines inside quotes)
    row[row.length - 1] += ch;
    i += 1;
  }
  // Push last row if not already
  if (row.length !== 1 || row[0] !== '') {
    rows.push({ fields: row, line: lineNo });
  }
  if (rows.length === 0) return { header: [], rows: [] };
  const header = rows[0].fields.map(h => normalizeKey(h));
  const outRows = [];
  for (let r = 1; r < rows.length; r++) {
    const rec = rows[r];
    const partsRaw = rec.fields.map(v => String(v));
    const origLen = partsRaw.length;
    // Normalize column count: pad missing, trim extras
    if (partsRaw.length < header.length) {
      while (partsRaw.length < header.length) partsRaw.push('');
    } else if (partsRaw.length > header.length) {
      partsRaw.length = header.length;
    }
    const parts = partsRaw.map(v => v.trim());
    const obj = {};
    header.forEach((h, idx) => { obj[h] = parts[idx]; });
    obj._line = rec.line;
    obj._partsLen = origLen;
    outRows.push(obj);
  }
  return { header, rows: outRows };
}

// Clear tables: relations, olivos, palots, parcelas
router.post('/import/clear', requireAuth, requireAdmin, async (req, res) => {
  const countryCode = resolveRequestCountry(req);
  await db.public.none('DELETE FROM parcelas_palots WHERE country_code = $1', [countryCode]);
  await db.public.none('DELETE FROM olivos WHERE country_code = $1', [countryCode]);
  await db.public.none('DELETE FROM palots WHERE country_code = $1', [countryCode]);
  await db.public.none('DELETE FROM parcelas WHERE country_code = $1', [countryCode]);
  res.json({ ok: true });
});

// Clear only olivos
router.post('/import/clear/olivos', requireAuth, requireAdmin, async (req, res) => {
  const countryCode = resolveRequestCountry(req);
  await db.public.none('DELETE FROM olivos WHERE country_code = $1', [countryCode]);
  res.json({ ok: true });
});

// Clear parcelas (and dependents to satisfy FKs)
router.post('/import/clear/parcelas', requireAuth, requireAdmin, async (req, res) => {
  const countryCode = resolveRequestCountry(req);
  await db.public.none('DELETE FROM parcelas_palots WHERE country_code = $1', [countryCode]);
  await db.public.none('DELETE FROM olivos WHERE country_code = $1', [countryCode]);
  await db.public.none('DELETE FROM parcelas WHERE country_code = $1', [countryCode]);
  res.json({ ok: true });
});

router.post('/import/parcelas', requireAuth, requireAdmin, async (req, res) => {
  const countryCode = resolveRequestCountry(req);
  const { csv } = req.body || {};
  if (!csv) return res.status(400).json({ error: 'csv requerido' });
  const { header, rows } = parseCsv(csv);
  if (rows.length === 0) return res.status(400).json({ error: 'CSV vacío' });

  // Validate required columns exist in CSV header
  const requiredOptions = [
    ['id', 'id_parcela'],
    ['name', 'nombre'],
    ['common_name', 'nombre_interno'],
    ['variety_id', 'variedad'],
    ['SIGPAC_Provincia', 'sigpac_provincia'],
    ['SIGPAC_Municipio', 'sigpac_municipio'],
    ['SIGPAC_Poligono', 'sigpac_poligono'],
    ['SIGPAC_Parcela', 'sigpac_parcela'],
    ['SIGPAC_Recinto', 'sigpac_recinto'],
    ['contract_percentage', 'porcentaje'],
  ];
  const present = new Set(header);
  const missing = requiredOptions.filter((options) => !options.some((name) => present.has(normalizeKey(name))));
  if (missing.length > 0) {
    const missingOriginal = missing.map((options) => options[0]);
    return res.status(400).json({ error: 'Faltan columnas en CSV', missing: missingOriginal });
  }
  let inserted = 0;
  const errors = [];
  for (const r of rows) {
    if (r._partsLen !== header.length) {
      errors.push(`Línea ${r._line}: número de columnas ${r._partsLen} != ${header.length} (ajustada automáticamente)`);
    }
    const idRaw = pickCsvValue(r, ['id', 'id_parcela']);
    const id = idRaw !== '' ? parseInt(idRaw, 10) : null;
    if (!Number.isInteger(id)) {
      errors.push(`Línea ${r._line}: id inválido "${idRaw ?? ''}"`);
      continue;
    }
    const nombre = pickCsvValue(r, ['nombre', 'name']) || null;
    const sigpac_municipio = pickCsvValue(r, ['sigpac_municipio']) || null;
    const sigpac_poligono = pickCsvValue(r, ['sigpac_poligono']) || null;
    const sigpac_parcela = pickCsvValue(r, ['sigpac_parcela']) || null; // Nota: esperado en DB como sigpac_parcela
    const sigpac_recinto = pickCsvValue(r, ['sigpac_recinto']) || null;
    const variedad = pickCsvValue(r, ['variedad', 'variety_id']) || null;
    const nombre_interno = pickCsvValue(r, ['nombre_interno', 'common_name']) || null;
    const porcentajeRaw = pickCsvValue(r, ['porcentaje', 'contract_percentage']);
    let porcentaje = null;
    if (porcentajeRaw !== '') {
      const normalizedPorcentaje = porcentajeRaw.replace(/\s+/g, '').replace(',', '.');
      const parsed = Number(normalizedPorcentaje);
      if (!Number.isFinite(parsed)) {
        errors.push(`Línea ${r._line}: porcentaje inválido "${porcentajeRaw}"`);
        continue;
      }
      porcentaje = parsed;
    }
    const numOlivosRaw = pickCsvValue(r, ['num_olivos', 'numero_olivos', 'n_olivos', 'numero_de_olivos', 'no_olivos', 'no_de_olivos']);
    let num_olivos = null;
    if (numOlivosRaw !== '') {
      const normalizedNumOlivos = numOlivosRaw.replace(/\s+/g, '').replace(',', '.');
      const parsed = Number(normalizedNumOlivos);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        errors.push(`Línea ${r._line}: num_olivos inválido "${numOlivosRaw}"`);
        continue;
      }
      num_olivos = parsed;
    }
    const hectareasRaw = pickCsvValue(r, ['hectareas', 'hectáreas', 'hectares']);
    let hectareas = null;
    if (hectareasRaw !== '') {
      const normalizedHectareas = hectareasRaw.replace(/\s+/g, '').replace(',', '.');
      const parsed = Number(normalizedHectareas);
      if (!Number.isFinite(parsed)) {
        errors.push(`Línea ${r._line}: hectareas inválido "${hectareasRaw}"`);
        continue;
      }
      hectareas = parsed;
    }
    if (!nombre) {
      errors.push(`Línea ${r._line}: nombre vacío`);
      continue;
    }
    await db.public.none(
        `INSERT INTO parcelas(
           id,
           nombre,
           sigpac_municipio,
           sigpac_poligono,
           sigpac_parcela,
           sigpac_recinto,
           variedad,
           nombre_interno,
           porcentaje,
           num_olivos,
           hectareas,
           country_code
         )
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET
           nombre = COALESCE(EXCLUDED.nombre, parcelas.nombre),
           sigpac_municipio = COALESCE(EXCLUDED.sigpac_municipio, parcelas.sigpac_municipio),
           sigpac_poligono  = COALESCE(EXCLUDED.sigpac_poligono,  parcelas.sigpac_poligono),
           sigpac_parcela   = COALESCE(EXCLUDED.sigpac_parcela,   parcelas.sigpac_parcela),
           sigpac_recinto   = COALESCE(EXCLUDED.sigpac_recinto,   parcelas.sigpac_recinto),
           variedad         = COALESCE(EXCLUDED.variedad,         parcelas.variedad),
           nombre_interno   = COALESCE(EXCLUDED.nombre_interno,   parcelas.nombre_interno),
           porcentaje       = COALESCE(EXCLUDED.porcentaje,       parcelas.porcentaje),
           num_olivos       = COALESCE(EXCLUDED.num_olivos,       parcelas.num_olivos),
           hectareas        = COALESCE(EXCLUDED.hectareas,        parcelas.hectareas)
         WHERE parcelas.country_code = EXCLUDED.country_code
        `,
        [id, nombre, sigpac_municipio, sigpac_poligono, sigpac_parcela, sigpac_recinto, variedad, nombre_interno, porcentaje, num_olivos, hectareas, countryCode]
      );
      inserted++;
  }
  res.json({ ok: true, inserted, errorsCount: errors.length, errors: errors.slice(0, 50) });
});

router.post('/import/palots', requireAuth, requireAdmin, async (req, res) => {
  const { csv } = req.body || {};
  if (!csv) return res.status(400).json({ error: 'csv requerido' });
  const { rows } = parseCsv(csv);
  const countryCode = resolveRequestCountry(req);
  const existing = new Set(
    (await db.public.many('SELECT codigo FROM palots WHERE country_code = $1', [countryCode])).map((r) => r.codigo)
  );
  let inserted = 0;
  for (const r of rows) {
    const id = r.id ? parseInt(r.id, 10) : null;
    const codigo = r.codigo ? String(r.codigo) : null;
    if (!codigo) continue;
    if (existing.has(codigo)) continue;
    if (id) {
      await db.public.none(
        'INSERT INTO palots(id, codigo, country_code) VALUES($1, $2, $3) ON CONFLICT (id) DO UPDATE SET codigo = EXCLUDED.codigo WHERE palots.country_code = EXCLUDED.country_code',
        [id, codigo, countryCode]
      );
    } else {
      await db.public.none('INSERT INTO palots(codigo, country_code) VALUES($1, $2)', [codigo, countryCode]);
    }
    existing.add(codigo);
    inserted++;
  }
  res.json({ ok: true, inserted });
});

router.post('/import/olivos', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { csv } = req.body || {};
    if (!csv) return res.status(400).json({ error: 'csv requerido' });
    const { header, rows } = parseCsv(csv);
    if (rows.length === 0) return res.status(400).json({ error: 'CSV vacío' });
    const countryCode = resolveRequestCountry(req);

    // Validate required columns (allowing simple aliases)
    const requiredOptions = [
      ['id'],
      ['id_parcela', 'parcela_id'],
    ];
    const present = new Set(header);
    const missing = requiredOptions
      .filter((opts) => !opts.some((name) => present.has(normalizeKey(name))))
      .map((opts) => opts[0]);
    if (missing.length > 0) return res.status(400).json({ error: 'Faltan columnas en CSV', missing });

    // Preload existing parcelas to avoid FK errors and give clearer messages
    const neededParcelaIds = Array.from(new Set(rows
      .map((r) => {
        const raw = pickCsvValue(r, ['id_parcela', 'parcela_id']);
        return raw !== '' ? parseInt(raw, 10) : null;
      })
      .filter((v) => Number.isInteger(v))));
    let existingParcelaIds = new Set();
    if (neededParcelaIds.length > 0) {
      try {
        const found = await db.public.many(
          'SELECT id FROM parcelas WHERE id = ANY($1) AND country_code = $2',
          [neededParcelaIds, countryCode]
        );
        existingParcelaIds = new Set(found.map((r) => r.id));
      } catch (_) {
        existingParcelaIds = new Set();
      }
    }

    let inserted = 0;
    const errors = [];
    for (const r of rows) {
      const idRaw = pickCsvValue(r, ['id']);
      const id = idRaw !== '' ? parseInt(idRaw, 10) : null;
      const parcelaRaw = pickCsvValue(r, ['id_parcela', 'parcela_id']);
      const id_parcela = parcelaRaw !== '' ? parseInt(parcelaRaw, 10) : null;
      if (!Number.isInteger(id_parcela)) {
        errors.push(`Línea ${r._line}: id_parcela inválido "${parcelaRaw}"`);
        continue;
      }
      if (!existingParcelaIds.has(id_parcela)) {
        errors.push(`Línea ${r._line}: id_parcela ${id_parcela} no existe en parcelas (importa parcelas primero)`);
        continue;
      }
      try {
        if (Number.isInteger(id)) {
          await db.public.none(
            `INSERT INTO olivos(id, id_parcela, country_code)
             VALUES($1, $2, $3)
             ON CONFLICT (id) DO UPDATE
               SET id_parcela = EXCLUDED.id_parcela
             WHERE olivos.country_code = EXCLUDED.country_code`,
            [id, id_parcela, countryCode]
          );
        } else {
          await db.public.none('INSERT INTO olivos(id_parcela, country_code) VALUES($1, $2)', [id_parcela, countryCode]);
        }
        inserted++;
      } catch (e) {
        errors.push(`Línea ${r._line}: error BD ${e.code || ''} ${e.message || e}`);
      }
    }
    res.json({ ok: true, inserted, errorsCount: errors.length, errors: errors.slice(0, 50) });
  } catch (e) {
    console.error('Import olivos error', e);
    res.status(500).json({ error: 'Error importando olivos', details: e.message || String(e) });
  }
});

module.exports = router;
