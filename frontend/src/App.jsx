import React, { useEffect, useRef, useState } from 'react';

function App() {
  const [palot, setPalot] = useState('');
  const [olivo, setOlivo] = useState('');
  const [parcelaNombre, setParcelaNombre] = useState('');
  const [parcelaId, setParcelaId] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | waiting | loading | success | error
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | ok | fail
  const [message, setMessage] = useState('');
  const [allRels, setAllRels] = useState([]);
  const [allStatus, setAllStatus] = useState('idle'); // idle | loading | ready | error
  const [filterPalot, setFilterPalot] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [relPalots, setRelPalots] = useState([]);
  const [relStatus, setRelStatus] = useState('idle'); // idle | loading | ready | error
  const debounceRef = useRef(null);

  // Debounced lookup for olivo -> parcela
  useEffect(() => {
    // Clear pending timer
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // If input empty, reset UI
    if (!olivo || olivo.trim() === '') {
      setStatus('idle');
      setParcelaNombre('');
      setParcelaId(null);
      return;
    }

    setStatus('waiting');
    debounceRef.current = setTimeout(async () => {
      setStatus('loading');
      try {
        // Nota: usamos el backend local directo para evitar el prefijo /api
        // Ajustar a `${import.meta.env.VITE_API_URL}` si se parametriza
        const res = await fetch(`http://localhost:3000/olivos/${encodeURIComponent(olivo)}/parcela`);
        if (!res.ok) {
          throw new Error('No encontrado');
        }
        const data = await res.json();
        setParcelaNombre(data.nombre || '');
        setParcelaId(data.id ?? null);
        setStatus('success');
        // cargar listado de palots relacionados con la parcela
        loadRelPalots(data.id ?? null);
      } catch (err) {
        setParcelaNombre('');
        setParcelaId(null);
        setStatus('error');
        loadRelPalots(null);
      }
    }, 800);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [olivo]);

  const apiBase = 'http://localhost:3000';

  const loadAllRels = async () => {
    setAllStatus('loading');
    try {
      const res = await fetch(`${apiBase}/parcelas-palots`);
      if (!res.ok) throw new Error('No se pudo cargar');
      const data = await res.json();
      setAllRels(Array.isArray(data) ? data : []);
      setAllStatus('ready');
    } catch (e) {
      setAllStatus('error');
    }
  };

  const loadRelPalots = async (pid) => {
    if (!pid) {
      setRelPalots([]);
      setRelStatus('idle');
      return;
    }
    setRelStatus('loading');
    try {
      const res = await fetch(`${apiBase}/parcelas/${pid}/palots`);
      if (!res.ok) throw new Error('No se pudo cargar');
      const data = await res.json();
      setRelPalots(Array.isArray(data) ? data : []);
      setRelStatus('ready');
    } catch (e) {
      setRelStatus('error');
    }
  };

  // Cargar todas las relaciones al montar
  useEffect(() => {
    loadAllRels();
  }, []);

  const handleSave = async () => {
    setMessage('');
    if (!parcelaId) {
      setSaveStatus('fail');
      setMessage('Primero busca un olivo válido para obtener su parcela.');
      return;
    }
    if (!palot || String(palot).trim() === '') {
      setSaveStatus('fail');
      setMessage('Introduce un número de palot.');
      return;
    }
    setSaveStatus('saving');
    try {
      // 1) Intentar resolver palot_id a partir del código introducido
      const listRes = await fetch(`${apiBase}/palots`);
      const palots = listRes.ok ? await listRes.json() : [];
      let palotRow = palots.find(p => String(p.codigo) === String(palot).trim());
      if (!palotRow) {
        // 2) Si no existe, crearlo
        const createRes = await fetch(`${apiBase}/palots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ codigo: String(palot).trim() })
        });
        if (!createRes.ok) throw new Error('No se pudo crear el palot');
        palotRow = await createRes.json();
      }

      // 3) Guardar relación parcela–palot
      const relRes = await fetch(`${apiBase}/parcelas/${parcelaId}/palots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ palot_id: palotRow.id })
      });
      if (!relRes.ok) {
        const err = await relRes.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo guardar la relación');
      }
      setSaveStatus('ok');
      setMessage('Relación guardada correctamente.');
      // refrescar listado de relaciones
      loadRelPalots(parcelaId);
      loadAllRels();
      // limpiar campos e indicadores
      setPalot('');
      setOlivo('');
      setParcelaNombre('');
      setParcelaId(null);
      setStatus('idle');
    } catch (e) {
      setSaveStatus('fail');
      setMessage(e.message || 'Error al guardar.');
    }
  };

  const canSave = status === 'success' && !!parcelaId && String(palot).trim() !== '' && saveStatus !== 'saving';

  // Lista a mostrar según filtro de palot
  const relsToShow = (allRels || []).filter((r) =>
    String(r.palot_codigo || '').toLowerCase().includes(String(filterPalot || '').trim().toLowerCase())
  );

  const exportCsv = () => {
    // Columnas: codigo_palot, id_parcela, nombre_parcela, sigpac_municipio, sigpac_poligono, sigpac_parcela, sigpac_recinto, variedad
    const header = ['codigo_palot', 'id_parcela', 'nombre_parcela', 'sigpac_municipio', 'sigpac_poligono', 'sigpac_parcela', 'sigpac_recinto', 'variedad'];
    const escape = (v) => '"' + String(v ?? '').replaceAll('"', '""') + '"';
    const rows = (relsToShow || []).map(r => [
      r.palot_codigo,
      r.parcela_id,
      r.parcela_nombre || '',
      r.sigpac_municipio || '',
      r.sigpac_poligono || '',
      r.sigpac_parcela || '',
      r.sigpac_recinto || '',
      r.parcela_variedad || ''
    ]);
    const csv = [header.join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'relaciones_parcela_palot.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container">
      <div className="card grid">
        <div className="brand">
          <img src="/Trazoliva-trans_tiny.png" alt="Trazoliva" className="logo" />
          <div>
            <h1>Trazoliva</h1>
          </div>
        </div>

        <div className="row">
          <label>Introduce nº de olivo</label>
          <input
            value={olivo}
            onChange={e => setOlivo(e.target.value)}
            placeholder="Ej. 123"
            inputMode="numeric"
          />
          {status === 'waiting' && <span className="state muted">Esperando a terminar de escribir…</span>}
          {status === 'loading' && <span className="state muted">Buscando parcela…</span>}
          {status === 'success' && parcelaNombre && (
            <div className="state ok">Parcela: {parcelaNombre} <span className="muted">(id {parcelaId})</span></div>
          )}
          {status === 'error' && <span className="state error">No se encontró la parcela para ese olivo.</span>}
        </div>

        <div className="divider" />

        <div className="row">
          <label>Introduce un número de palot</label>
          <input value={palot} onChange={e => setPalot(e.target.value)} placeholder="Ej. 42" inputMode="numeric" />
        </div>

        <div className="controls">
          <button className="btn" onClick={handleSave} disabled={!canSave}>
            {saveStatus === 'saving' ? 'Guardando…' : 'Guardar'}
          </button>
          {message && (
            <span className={`state ${saveStatus === 'ok' ? 'ok' : saveStatus === 'fail' ? 'error' : 'muted'}`}>
              {message}
            </span>
          )}
        </div>
      </div>

      <div className="card grid" style={{ marginTop: '1rem' }}>
        <div className="controls" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1>Relaciones Parcela – Palot</h1>
            <span className="muted">Listado global de relaciones existentes</span>
          </div>
          <button className="btn btn-outline" onClick={exportCsv} disabled={relsToShow.length === 0}>Exportar CSV</button>
        </div>

        <div className="row">
          <label>Buscar por nº de palot</label>
          <input
            value={filterPalot}
            onChange={(e) => setFilterPalot(e.target.value)}
            placeholder="Ej. 42"
            inputMode="numeric"
          />
        </div>

        <div className="row">
          {allStatus === 'loading' && <span className="state muted">Cargando relaciones…</span>}
          {allStatus === 'error' && <span className="state error">No se pudo cargar el listado.</span>}
          {allStatus !== 'loading' && allRels.length === 0 && (
            <span className="state muted">No hay relaciones aún.</span>
          )}
          {relsToShow.length > 0 && (
            <div className="cells">
              {relsToShow.map((r) => (
                <div
                  key={r.id}
                  className="cell"
                  onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                >
                  <div className="cell-title">Palot {r.palot_codigo}</div>
                  <div className="cell-sub">{r.parcela_nombre || 'Sin nombre'}</div>
                  {expandedId === r.id && (
                    <div className="cell-details">
                      <div className="kv"><span className="kv-label">Municipio</span><span className="kv-value">{r.sigpac_municipio || '-'}</span></div>
                      <div className="kv"><span className="kv-label">Polígono</span><span className="kv-value">{r.sigpac_poligono || '-'}</span></div>
                      <div className="kv"><span className="kv-label">Parcela</span><span className="kv-value">{r.sigpac_parcela || '-'}</span></div>
                      <div className="kv"><span className="kv-label">Recinto</span><span className="kv-value">{r.sigpac_recinto || '-'}</span></div>
                      <div className="kv"><span className="kv-label">Variedad</span><span className="kv-value">{r.parcela_variedad || '-'}</span></div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
