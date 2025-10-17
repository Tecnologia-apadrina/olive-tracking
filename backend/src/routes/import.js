const express = require('express');
const router = express.Router();
const db = require('../db');

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
    .toLowerCase()
    .replace(/[\s\-]+/g, '_');
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
router.post('/import/clear', requireAuth, requireAdmin, async (_req, res) => {
  await db.public.none('DELETE FROM parcelas_palots');
  await db.public.none('DELETE FROM olivos');
  await db.public.none('DELETE FROM palots');
  await db.public.none('DELETE FROM parcelas');
  res.json({ ok: true });
});

// Clear only olivos
router.post('/import/clear/olivos', requireAuth, requireAdmin, async (_req, res) => {
  await db.public.none('DELETE FROM olivos');
  res.json({ ok: true });
});

// Clear parcelas (and dependents to satisfy FKs)
router.post('/import/clear/parcelas', requireAuth, requireAdmin, async (_req, res) => {
  await db.public.none('DELETE FROM parcelas_palots');
  await db.public.none('DELETE FROM olivos');
  await db.public.none('DELETE FROM parcelas');
  res.json({ ok: true });
});

router.post('/import/parcelas', requireAuth, requireAdmin, async (req, res) => {
  const { csv } = req.body || {};
  if (!csv) return res.status(400).json({ error: 'csv requerido' });
  const { header, rows } = parseCsv(csv);
  if (rows.length === 0) return res.status(400).json({ error: 'CSV vacío' });

  // Validate required columns exist in CSV header
  const requiredCsvNames = ['id','name','common-name','variety_id','SIGPAC_Municipio','SIGPAC_Poligono','SIGPAC_Parcela','SIGPAC_Recinto','contract_percentage'];
  const requiredNorm = requiredCsvNames.map(normalizeKey);
  const present = new Set(header);
  const missing = requiredNorm.filter(k => !present.has(k));
  if (missing.length > 0) {
    // Report missing using original names where possible
    const missingOriginal = requiredCsvNames.filter((n, i) => missing.includes(requiredNorm[i]));
    return res.status(400).json({ error: 'Faltan columnas en CSV', missing: missingOriginal });
  }
  let inserted = 0;
  const errors = [];
  for (const r of rows) {
    if (r._partsLen !== header.length) {
      errors.push(`Línea ${r._line}: número de columnas ${r._partsLen} != ${header.length} (ajustada automáticamente)`);
    }
    const id = r.id ? parseInt(r.id, 10) : null;
    if (!Number.isInteger(id)) {
      errors.push(`Línea ${r._line}: id inválido "${r.id ?? ''}"`);
      continue;
    }
    const nombre = r.nombre || null;
    const sigpac_municipio = r.sigpac_municipio || null;
    const sigpac_poligono = r.sigpac_poligono || null;
    const sigpac_parcela = r.sigpac_parcela || null; // Nota: esperado en DB como sigpac_parcela
    const sigpac_recinto = r.sigpac_recinto || null;
    const variedad = r.variedad || null;
    const nombre_interno = r.nombre_interno || null;
    const porcentaje = r.porcentaje !== undefined && r.porcentaje !== '' ? Number(r.porcentaje) : null;
    if (r.porcentaje !== undefined && r.porcentaje !== '' && Number.isNaN(porcentaje)) {
      errors.push(`Línea ${r._line}: porcentaje inválido "${r.porcentaje}"`);
      continue;
    }
    if (!nombre) {
      errors.push(`Línea ${r._line}: nombre vacío`);
      continue;
    }
    await db.public.none(
        `INSERT INTO parcelas(id, name, SIGPAC_Municipio, SIGPAC_Poligono, SIGPAC_Parcela, SIGPAC_Recinto, variety_id, common_name, porcentaje)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET
           nombre = COALESCE(EXCLUDED.nombre, parcelas.nombre),
           sigpac_municipio = COALESCE(EXCLUDED.sigpac_municipio, parcelas.sigpac_municipio),
           sigpac_poligono  = COALESCE(EXCLUDED.sigpac_poligono,  parcelas.sigpac_poligono),
           sigpac_parcela   = COALESCE(EXCLUDED.sigpac_parcela,   parcelas.sigpac_parcela),
           sigpac_recinto   = COALESCE(EXCLUDED.sigpac_recinto,   parcelas.sigpac_recinto),
           variedad         = COALESCE(EXCLUDED.variedad,         parcelas.variedad),
           nombre_interno   = COALESCE(EXCLUDED.nombre_interno,   parcelas.nombre_interno),
           porcentaje       = COALESCE(EXCLUDED.porcentaje,       parcelas.porcentaje)
        `,
        [id, nombre, sigpac_municipio, sigpac_poligono, sigpac_parcela, sigpac_recinto, variedad, nombre_interno, porcentaje]
      );
      inserted++;
  }
  res.json({ ok: true, inserted, errorsCount: errors.length, errors: errors.slice(0, 50) });
});

router.post('/import/palots', requireAuth, requireAdmin, async (req, res) => {
  const { csv } = req.body || {};
  if (!csv) return res.status(400).json({ error: 'csv requerido' });
  const { rows } = parseCsv(csv);
  const existing = new Set((await db.public.many('SELECT codigo FROM palots')).map(r => r.codigo));
  let inserted = 0;
  for (const r of rows) {
    const id = r.id ? parseInt(r.id, 10) : null;
    const codigo = r.codigo ? String(r.codigo) : null;
    if (!codigo) continue;
    if (existing.has(codigo)) continue;
    if (id) {
      await db.public.none('INSERT INTO palots(id, codigo) VALUES($1, $2)', [id, codigo]);
    } else {
      await db.public.none('INSERT INTO palots(codigo) VALUES($1)', [codigo]);
    }
    existing.add(codigo);
    inserted++;
  }
  res.json({ ok: true, inserted });
});

router.post('/import/olivos', requireAuth, requireAdmin, async (req, res) => {
  const { csv } = req.body || {};
  if (!csv) return res.status(400).json({ error: 'csv requerido' });
  const { header, rows } = parseCsv(csv);
  if (rows.length === 0) return res.status(400).json({ error: 'CSV vacío' });

  // Validate required columns
  const required = ['id', 'id_parcela'];
  const present = new Set(header);
  const missing = required.filter(k => !present.has(k));
  if (missing.length > 0) return res.status(400).json({ error: 'Faltan columnas en CSV', missing });

  // Preload existing parcelas to avoid FK errors and give clearer messages
  const neededParcelaIds = Array.from(new Set(rows
    .map(r => (r.id_parcela !== undefined && r.id_parcela !== '' ? parseInt(r.id_parcela, 10) : null))
    .filter((v) => Number.isInteger(v))));
  let existingParcelaIds = new Set();
  if (neededParcelaIds.length > 0) {
    try {
      const found = await db.public.many('SELECT id FROM parcelas WHERE id = ANY($1)', [neededParcelaIds]);
      existingParcelaIds = new Set(found.map(r => r.id));
    } catch (_) {
      existingParcelaIds = new Set();
    }
  }

  let inserted = 0;
  const errors = [];
  for (const r of rows) {
    const id = r.id !== undefined && r.id !== '' ? parseInt(r.id, 10) : null;
    const id_parcela = r.id_parcela !== undefined && r.id_parcela !== '' ? parseInt(r.id_parcela, 10) : null;
    if (!Number.isInteger(id_parcela)) {
      errors.push(`Línea ${r._line}: id_parcela inválido "${r.id_parcela ?? ''}"`);
      continue;
    }
    if (!existingParcelaIds.has(id_parcela)) {
      errors.push(`Línea ${r._line}: id_parcela ${id_parcela} no existe en parcelas (importa parcelas primero)`);
      continue;
    }
    try {
      if (Number.isInteger(id)) {
        await db.public.none(
          'INSERT INTO olivos(id, id_parcela) VALUES($1, $2) ON CONFLICT (id) DO UPDATE SET id_parcela = EXCLUDED.id_parcela',
          [id, id_parcela]
        );
      } else {
        await db.public.none('INSERT INTO olivos(id_parcela) VALUES($1)', [id_parcela]);
      }
      inserted++;
    } catch (e) {
      errors.push(`Línea ${r._line}: error BD ${e.code || ''} ${e.message || e}`);
    }
  }
  res.json({ ok: true, inserted, errorsCount: errors.length, errors: errors.slice(0, 50) });
});

module.exports = router;
