import React, { useEffect, useRef, useState } from 'react';

function App() {
  // Auth
  const [authUser, setAuthUser] = useState('');
  const [authPass, setAuthPass] = useState('');
  const [authToken, setAuthToken] = useState(''); // base64 username:password
  const [authRole, setAuthRole] = useState('');
  const [view, setView] = useState('main'); // main | users | olivos | parcelas | palots
  const [palot, setPalot] = useState('');
  const [olivo, setOlivo] = useState('');
  const [parcelaNombre, setParcelaNombre] = useState('');
  const [parcelaId, setParcelaId] = useState(null);
  const [parcelaPct, setParcelaPct] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | waiting | loading | success | error
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | ok | fail
  const [message, setMessage] = useState('');
  const [allRels, setAllRels] = useState([]);
  const [allStatus, setAllStatus] = useState('idle'); // idle | loading | ready | error
  const [filterPalot, setFilterPalot] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [relPalots, setRelPalots] = useState([]);
  const [relStatus, setRelStatus] = useState('idle'); // idle | loading | ready | error
  const [kgsDraft, setKgsDraft] = useState({}); // { [palotId]: string }
  const [kgSaveStatus, setKgSaveStatus] = useState({}); // { [palotId]: 'idle'|'saving'|'ok'|'error' }
  const debounceRef = useRef(null);
  const [appVersion, setAppVersion] = useState('');
  const [dbUrl, setDbUrl] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  useEffect(() => {
    // Restore token
    const t = localStorage.getItem('authToken');
    const u = localStorage.getItem('authUser');
    if (t) setAuthToken(t);
    if (u) setAuthUser(u);
    // Handle /logout URL: limpia sesión y vuelve a inicio
    const initialPath = window.location?.pathname || '/';
    if (initialPath === '/logout') {
      clearToken();
      if (window.history && window.location) {
        window.history.replaceState({}, '', '/');
      }
    }
    if (t) {
      fetch(`${apiBase}/me`, { headers: { Authorization: `Basic ${t}` } })
        .then(r => r.ok ? r.json() : null)
        .then(me => setAuthRole(me?.role || ''))
        .catch(() => setAuthRole(''));
    }
    // Initialize route from path
    const path = (window.location?.pathname || '/') === '/logout' ? '/' : (window.location?.pathname || '/');
    setView(path === '/users' ? 'users' : (path === '/olivos' ? 'olivos' : (path === '/parcelas' ? 'parcelas' : (path === '/palots' ? 'palots' : 'main'))));
    const onPop = () => {
      const p = window.location?.pathname || '/';
      if (p === '/logout') {
        clearToken();
        if (window.history && window.location) {
          window.history.replaceState({}, '', '/');
        }
        setView('main');
        return;
      }
      setView(p === '/users' ? 'users' : (p === '/olivos' ? 'olivos' : (p === '/parcelas' ? 'parcelas' : (p === '/palots' ? 'palots' : 'main'))));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // API base configurable: usa VITE_API_URL si está definida, si no, usa ruta relativa '/api'
  // En despliegue con Nginx, se proxia '/api' al backend.
  const apiBase = import.meta.env?.VITE_API_URL || '/api';
  // Load app version once
  useEffect(() => {
    fetch(`${apiBase}/version`).then(r => r.ok ? r.json() : null).then(v => {
      if (v && (v.appVersion || v.version)) {
        setAppVersion(v.appVersion || v.version);
      }
      const safeDb = v?.details?.db?.safe || v?.details?.db?.url || '';
      if (safeDb) setDbUrl(safeDb);
    }).catch(() => {});
  }, []);
  const authHeaders = authToken ? { Authorization: `Basic ${authToken}` } : {};
  const setToken = (u, p) => {
    const token = btoa(`${u}:${p}`);
    setAuthToken(token);
    setAuthUser(u);
    localStorage.setItem('authToken', token);
    localStorage.setItem('authUser', u);
    // fetch role
    fetch(`${apiBase}/me`, { headers: { Authorization: `Basic ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(me => setAuthRole(me?.role || ''))
      .catch(() => setAuthRole(''));
  };

  // Login con validación: solo guarda token si /me responde OK
  const performLogin = async (u, p) => {
    try {
      setLoginError('');
      setLoginBusy(true);
      const token = btoa(`${u}:${p}`);
      const res = await fetch(`${apiBase}/me`, { headers: { Authorization: `Basic ${token}` } });
      if (!res.ok) throw new Error('Credenciales no válidas');
      setToken(u, p);
    } catch (_) {
      setLoginError('Credenciales incorrectas.');
    } finally {
      setLoginBusy(false);
    }
  };
  const clearToken = () => {
    setAuthToken('');
    setAuthUser('');
    setAuthPass('');
    setAuthRole('');
    localStorage.removeItem('authToken');
    localStorage.removeItem('authUser');
  };

  // No hagas returns antes de todos los hooks; la UI de login se renderiza condicionalmente más abajo

  const navigate = (path) => {
    if (window.history && window.location) {
      window.history.pushState({}, '', path);
      setView(path === '/users' ? 'users' : (path === '/olivos' ? 'olivos' : (path === '/parcelas' ? 'parcelas' : (path === '/palots' ? 'palots' : 'main'))));
    } else {
      // Fallback: update state only
      setView(path === '/users' ? 'users' : (path === '/olivos' ? 'olivos' : (path === '/parcelas' ? 'parcelas' : (path === '/palots' ? 'palots' : 'main'))));
    }
  };

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
        const res = await fetch(`${apiBase}/olivos/${encodeURIComponent(olivo)}/parcela`, { headers: { ...authHeaders } });
        if (!res.ok) {
          throw new Error('No encontrado');
        }
        const data = await res.json();
        setParcelaNombre(data.nombre || '');
        setParcelaId(data.id ?? null);
        setParcelaPct(data.porcentaje ?? null);
        setStatus('success');
        // cargar listado de palots relacionados con la parcela
        loadRelPalots(data.id ?? null);
      } catch (err) {
        setParcelaNombre('');
        setParcelaId(null);
        setParcelaPct(null);
        setStatus('error');
        loadRelPalots(null);
      }
    }, 800);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [olivo]);

  

  const loadAllRels = async () => {
    setAllStatus('loading');
    try {
      const res = await fetch(`${apiBase}/parcelas-palots`, { headers: { ...authHeaders } });
      if (!res.ok) throw new Error('No se pudo cargar');
      const data = await res.json();
      setAllRels(Array.isArray(data) ? data : []);
      setAllStatus('ready');
      // seed kgs drafts por palot
      const map = new Map();
      for (const r of (Array.isArray(data) ? data : [])) {
        if (!map.has(r.palot_id)) map.set(r.palot_id, r.kgs == null ? '' : String(r.kgs));
      }
      setKgsDraft(Object.fromEntries(map));
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
      const res = await fetch(`${apiBase}/parcelas/${pid}/palots`, { headers: { ...authHeaders } });
      if (!res.ok) throw new Error('No se pudo cargar');
      const data = await res.json();
      setRelPalots(Array.isArray(data) ? data : []);
      setRelStatus('ready');
    } catch (e) {
      setRelStatus('error');
    }
  };

  // Cargar todas las relaciones al montar (solo con sesión)
  useEffect(() => {
    if (authToken) loadAllRels();
  }, [authToken]);

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
      const listRes = await fetch(`${apiBase}/palots`, { headers: { ...authHeaders } });
      const palots = listRes.ok ? await listRes.json() : [];
      let palotRow = palots.find(p => String(p.codigo) === String(palot).trim());
      if (!palotRow) {
        // 2) Si no existe, crearlo
        const createRes = await fetch(`${apiBase}/palots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ codigo: String(palot).trim() })
        });
        if (!createRes.ok) throw new Error('No se pudo crear el palot');
        palotRow = await createRes.json();
      }

      // 3) Guardar relación parcela–palot
      const relRes = await fetch(`${apiBase}/parcelas/${parcelaId}/palots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
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
      setParcelaPct(null);
      setStatus('idle');
    } catch (e) {
      setSaveStatus('fail');
      if (e.message && e.message.includes('401')) {
        setMessage('No autenticado. Inicia sesión.');
      } else {
        setMessage(e.message || 'Error al guardar.');
      }
    }
  };

  const canSave = status === 'success' && !!parcelaId && String(palot).trim() !== '' && saveStatus !== 'saving';

  // Tabs for relations: today | previous
  const [relTab, setRelTab] = useState('today');

  const dateKeyLocal = (dt) => {
    const d = new Date(dt);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
    };
  const todayKey = dateKeyLocal(new Date());

  // Lista a mostrar según filtro de palot, ordenada por fecha creación desc
  const relsToShow = (allRels || [])
    .filter((r) => String(r.palot_codigo || '').toLowerCase().includes(String(filterPalot || '').trim().toLowerCase()))
    .sort((a, b) => {
      const ad = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bd = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bd - ad;
    });

  // Partition according to tab
  const relsByTab = React.useMemo(() => {
    const today = [];
    const prev = [];
    for (const r of relsToShow) {
      const key = r.created_at ? dateKeyLocal(r.created_at) : null;
      if (key === todayKey) today.push(r); else prev.push(r);
    }
    return { today, prev };
  }, [relsToShow]);

  // Agrupar por palot
  const palotGroups = React.useMemo(() => {
    const base = relTab === 'today' ? relsByTab.today : relsByTab.prev;
    const map = new Map(); // palot_id -> { palot_id, palot_codigo, kgs, items: [] }
    for (const r of base) {
      const key = r.palot_id;
      if (!map.has(key)) map.set(key, { palot_id: r.palot_id, palot_codigo: r.palot_codigo, kgs: r.kgs ?? null, items: [] });
      const g = map.get(key);
      g.items.push(r);
      if (g.kgs == null && r.kgs != null) g.kgs = r.kgs;
    }
    // Keep deterministic order: by palot code asc
    return Array.from(map.values()).sort((a, b) => String(a.palot_codigo).localeCompare(String(b.palot_codigo)));
  }, [relsByTab, relTab]);

  const exportCsv = () => {
    // Columnas: codigo_palot, id_parcela, nombre_parcela, sigpac_municipio, sigpac_poligono, sigpac_parcela, sigpac_recinto, variedad
    const header = ['codigo_palot', 'id_parcela', 'nombre_parcela', 'sigpac_municipio', 'sigpac_poligono', 'sigpac_parcela', 'sigpac_recinto', 'variedad'];
    const escape = (v) => '"' + String(v ?? '').replaceAll('"', '""') + '"';
    const base = relTab === 'today' ? relsByTab.today : relsByTab.prev;
    const rows = (base || []).map(r => [
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

  const handleKgsBlur = async (palotId, relId) => {
    const value = kgsDraft[palotId];
    setKgSaveStatus(s => ({ ...s, [palotId]: 'saving' }));
    try {
      const res = await fetch(`${apiBase}/parcelas-palots/${relId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ kgs: value === '' ? null : value })
      });
      if (!res.ok) throw new Error('No se pudo guardar');
      setKgSaveStatus(s => ({ ...s, [palotId]: 'ok' }));
      // refresh all relations with same palot to keep kgs consistent
      setAllRels(rows => {
        const pid = palotId;
        const newVal = value === '' ? null : Number(value);
        return rows.map(r => (pid && r.palot_id === pid) ? { ...r, kgs: newVal } : r);
      });
      // reset indicator after a moment
      setTimeout(() => setKgSaveStatus(s => ({ ...s, [palotId]: 'idle' })), 1200);
    } catch (e) {
      setKgSaveStatus(s => ({ ...s, [palotId]: 'error' }));
    }
  };

  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="container">
      {!authToken ? (
        <>
          <div className="card" style={{ maxWidth: 420, margin: '4rem auto' }}>
            <h1>Iniciar sesión</h1>
            <div className="row">
              <label>Usuario</label>
              <input style={{ width: '100%' }} placeholder="usuario" value={authUser} onChange={e => setAuthUser(e.target.value)} />
            </div>
            <div className="row">
              <label>Contraseña</label>
              <input style={{ width: '100%' }} placeholder="contraseña" type="password" value={authPass} onChange={e => setAuthPass(e.target.value)} />
            </div>
            <div className="controls" style={{ justifyContent: 'space-between' }}>
              <span className="muted">Usa tus credenciales de TrazOliva</span>
              <button className="btn" onClick={() => performLogin(authUser, authPass)} disabled={!authUser || !authPass || loginBusy}>
                {loginBusy ? 'Entrando…' : 'Entrar'}
              </button>
            </div>
            {/* Admin hints removed intentionally */}
            {loginError && (
              <div className="row">
                <span className="state error">{loginError}</span>
              </div>
            )}
          </div>
          <div style={{ marginTop: '1rem', textAlign: 'right' }}>
            <span className="muted" style={{ fontSize: '0.85rem', display: 'block' }}>
              Versión: {appVersion || 'cargando…'}
            </span>
            {dbUrl && (
              <span className="muted" style={{ fontSize: '0.85rem', display: 'block' }}>
                DB: {dbUrl}
              </span>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="card header" style={{ marginBottom: '1rem' }}>
            <div className="brand">
              <a href="/" className="brand-logo-link" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
                <img src="/Trazoliva-trans_tiny.png" alt="Trazoliva" className="logo clickable" />
              </a>
            </div>
            <button className="hamburger" aria-label="Abrir menú" aria-expanded={menuOpen} onClick={() => setMenuOpen(o => !o)}>
              ☰
            </button>
            <div className={`header-nav ${menuOpen ? 'open' : ''}`}>
              <span className="pill">Sesión: {authUser}</span>
              {authRole && <span className="pill">Rol: {authRole}</span>}
              <a className={`btn ${view === 'main' ? '' : 'btn-outline'}`} href="/" onClick={(e) => { e.preventDefault(); navigate('/'); setMenuOpen(false); }}>App</a>
              {authRole === 'admin' && (
                <a className={`btn ${view === 'users' ? '' : 'btn-outline'}`} href="/users" onClick={(e) => { e.preventDefault(); navigate('/users'); setMenuOpen(false); }}>Usuarios</a>
              )}
              {authRole === 'admin' && (
                <a className={`btn ${view === 'olivos' ? '' : 'btn-outline'}`} href="/olivos" onClick={(e) => { e.preventDefault(); navigate('/olivos'); setMenuOpen(false); }}>Olivos</a>
              )}
              {authRole === 'admin' && (
                <a className={`btn ${view === 'parcelas' ? '' : 'btn-outline'}`} href="/parcelas" onClick={(e) => { e.preventDefault(); navigate('/parcelas'); setMenuOpen(false); }}>Parcelas</a>
              )}
              {authRole === 'admin' && (
                <a className={`btn ${view === 'palots' ? '' : 'btn-outline'}`} href="/palots" onClick={(e) => { e.preventDefault(); navigate('/palots'); setMenuOpen(false); }}>Palots</a>
              )}
              <button className="btn btn-outline" onClick={() => { clearToken(); setMenuOpen(false); }}>Salir</button>
            </div>
          </div>

      {view === 'main' && (
        <>
      <div className="card grid">

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
            <div className="state ok">
              Parcela: {parcelaNombre} <span className="muted">(id {parcelaId})</span>
              {parcelaPct != null && parcelaPct !== '' && (
                <span className="pill danger" style={{ marginLeft: '0.5rem' }}>Advertencia: porcentaje {String(parcelaPct)}%</span>
              )}
            </div>
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
          <div className="controls">
            <div className="tabs">
              <button className={`btn ${relTab === 'today' ? '' : 'btn-outline'}`} onClick={() => setRelTab('today')}>Hoy</button>
              <button className={`btn ${relTab === 'previous' ? '' : 'btn-outline'}`} onClick={() => setRelTab('previous')}>Anteriores</button>
            </div>
            <button className="btn btn-outline" onClick={exportCsv} disabled={(relTab==='today'?relsByTab.today.length:relsByTab.prev.length)===0}>Exportar CSV</button>
          </div>
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
          {palotGroups.length > 0 && (
            <div className="cells">
              {palotGroups.map((g) => (
                <div key={g.palot_id} className="cell">
                  <div className="cell-title">Palot {g.palot_codigo}</div>
                  <div className="cell-inline">
                    <label className="kg-label" htmlFor={`kg-${g.palot_id}`}>Kgs</label>
                    <input
                      id={`kg-${g.palot_id}`}
                      className="kg-input"
                      value={kgsDraft[g.palot_id] ?? (g.kgs == null ? '' : String(g.kgs))}
                      onChange={(e) => setKgsDraft(s => ({ ...s, [g.palot_id]: e.target.value }))}
                      onBlur={() => handleKgsBlur(g.palot_id, g.items[0]?.id)}
                      placeholder="0"
                      inputMode="decimal"
                    />
                    {kgSaveStatus[g.palot_id] === 'saving' && <span className="muted">Guardando…</span>}
                    {kgSaveStatus[g.palot_id] === 'ok' && <span className="state ok">OK</span>}
                    {kgSaveStatus[g.palot_id] === 'error' && <span className="state error">Error</span>}
                  </div>
                  <div className="cell-details">
                    {g.items.map((r) => (
                      <div key={r.id} className="kv" onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
                        <span className="kv-label">Parcela</span><span className="kv-value">{r.parcela_nombre || '-'}</span>
                        <span className="kv-label">Creado por</span><span className="kv-value">{r.created_by_username || r.created_by || '-'}</span>
                        <span className="kv-label">Fecha</span><span className="kv-value">{r.created_at ? new Date(r.created_at).toLocaleString() : '-'}</span>
                        {expandedId === r.id && (
                          <>
                            <span className="kv-label">Municipio</span><span className="kv-value">{r.sigpac_municipio || '-'}</span>
                            <span className="kv-label">Polígono</span><span className="kv-value">{r.sigpac_poligono || '-'}</span>
                            <span className="kv-label">Parcela</span><span className="kv-value">{r.sigpac_parcela || '-'}</span>
                            <span className="kv-label">Recinto</span><span className="kv-value">{r.sigpac_recinto || '-'}</span>
                            <span className="kv-label">Variedad</span><span className="kv-value">{r.parcela_variedad || '-'}</span>
                            <span className="kv-label">Porcentaje</span><span className="kv-value">{r.parcela_porcentaje != null ? String(r.parcela_porcentaje) + '%' : '-'}</span>
                            <span className="kv-label">Nombre interno</span><span className="kv-value">{r.parcela_nombre_interno || '-'}</span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={{ marginTop: '1rem', textAlign: 'right' }}>
        <span className="muted" style={{ fontSize: '0.85rem', display: 'block' }}>
          Versión: {appVersion || 'cargando…'}
        </span>
        {dbUrl && (
          <span className="muted" style={{ fontSize: '0.85rem', display: 'block' }}>
            DB: {dbUrl}
          </span>
        )}
      </div>
    </>
    )}

      {authToken && view === 'users' && (
        <UsersView apiBase={apiBase} authHeaders={authHeaders} appVersion={appVersion} dbUrl={dbUrl} />
      )}


      {authToken && view === 'olivos' && (
        <OlivosView apiBase={apiBase} authHeaders={authHeaders} />
      )}

      {authToken && view === 'parcelas' && (
        <ParcelasView apiBase={apiBase} authHeaders={authHeaders} />
      )}

      {authToken && view === 'palots' && (
        <PalotsView apiBase={apiBase} authHeaders={authHeaders} />
      )}
        </>
      )}
    </div>
  );
}

function UsersView({ apiBase, authHeaders, appVersion, dbUrl }) {
  const [users, setUsers] = React.useState([]);
  const [status, setStatus] = React.useState('idle');
  const [u, setU] = React.useState('');
  const [p, setP] = React.useState('');
  const [role, setRole] = React.useState('user');
  const [drafts, setDrafts] = React.useState({}); // {id: {username, role, password}}

  const load = async () => {
    setStatus('loading');
    try {
      const res = await fetch(`${apiBase}/users`, { headers: { ...authHeaders } });
      if (!res.ok) throw new Error('No autorizado o error');
      const data = await res.json();
      const arr = Array.isArray(data) ? data : [];
      setUsers(arr);
      const d = {};
      for (const us of arr) d[us.id] = { username: us.username, role: us.role, password: '' };
      setDrafts(d);
      setStatus('ready');
    } catch (e) {
      setStatus('error');
    }
  };
  React.useEffect(() => { load(); }, []);

  const createUser = async () => {
    const res = await fetch(`${apiBase}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ username: u, password: p, role })
    });
    if (res.ok) {
      setU(''); setP(''); setRole('user');
      load();
    } else {
      alert('No se pudo crear');
    }
  };

  const remove = async (id) => {
    if (!confirm('¿Eliminar usuario?')) return;
    const res = await fetch(`${apiBase}/users/${id}`, { method: 'DELETE', headers: { ...authHeaders } });
    if (res.status === 204) load();
  };

  const saveRow = async (id) => {
    const d = drafts[id] || {};
    const payload = { username: d.username, role: d.role };
    if (d.password && d.password.trim() !== '') payload.password = d.password;
    const res = await fetch(`${apiBase}/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const updated = await res.json();
      setUsers(list => list.map(x => x.id === id ? updated : x));
      setDrafts(d0 => ({ ...d0, [id]: { username: updated.username, role: updated.role, password: '' } }));
    } else {
      alert('No se pudo guardar cambios');
    }
  };

  return (
    <div className="card grid">
      <div className="controls" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Gestión de usuarios</h1>
          <span className="muted">Solo administradores</span>
        </div>
        <button className="btn btn-outline" onClick={load}>Recargar</button>
      </div>
      <div className="row">
        <label>Crear usuario</label>
        <div className="controls">
          <input style={{ width: 160 }} placeholder="usuario" value={u} onChange={e => setU(e.target.value)} />
          <input style={{ width: 160 }} placeholder="contraseña" type="password" value={p} onChange={e => setP(e.target.value)} />
          <select value={role} onChange={e => setRole(e.target.value)}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
          <button className="btn" onClick={createUser} disabled={!u || !p}>Crear</button>
        </div>
      </div>
      <div className="row">
        {status === 'loading' && <span className="muted">Cargando…</span>}
        {status === 'error' && <span className="state error">No autorizado o error.</span>}
        {status === 'ready' && users.length === 0 && <span className="muted">Sin usuarios.</span>}
        {users.map(us => (
          <div key={us.id} className="list-row" style={{ justifyContent: 'space-between' }}>
            <div className="controls">
              <input style={{ width: 160 }} value={drafts[us.id]?.username ?? ''} onChange={e => setDrafts(d => ({ ...d, [us.id]: { ...(d[us.id]||{}), username: e.target.value } }))} />
              <select value={drafts[us.id]?.role ?? 'user'} onChange={e => setDrafts(d => ({ ...d, [us.id]: { ...(d[us.id]||{}), role: e.target.value } }))}>
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
              <input style={{ width: 160 }} placeholder="nueva contraseña" type="password" value={drafts[us.id]?.password ?? ''} onChange={e => setDrafts(d => ({ ...d, [us.id]: { ...(d[us.id]||{}), password: e.target.value } }))} />
            </div>
            <div className="controls">
              <button className="btn" onClick={() => saveRow(us.id)}>Guardar</button>
              <button className="btn btn-outline" onClick={() => remove(us.id)}>Eliminar</button>
            </div>
          </div>
        ))}
          <div style={{ marginTop: '1rem', textAlign: 'right' }}>
            <span className="muted" style={{ fontSize: '0.85rem', display: 'block' }}>
              Versión: {appVersion || 'cargando…'}
            </span>
            {dbUrl && (
              <span className="muted" style={{ fontSize: '0.85rem', display: 'block' }}>
                DB: {dbUrl}
              </span>
            )}
          </div>
      </div>
    </div>
  );
}

export default App;

 

function OlivosView({ apiBase, authHeaders }) {
  const [rows, setRows] = React.useState([]);
  const [status, setStatus] = React.useState('idle');
  const [oCsv, setOCsv] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const [result, setResult] = React.useState(null);
  const load = async () => {
    setStatus('loading');
    try {
      const res = await fetch(`${apiBase}/olivos`, { headers: { ...authHeaders } });
      if (!res.ok) throw new Error('No autorizado');
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
      setStatus('ready');
    } catch (e) {
      setStatus('error');
    }
  };
  React.useEffect(() => { load(); }, []);

  const readFile = (file, setter) => {
    const r = new FileReader();
    r.onload = () => setter(String(r.result || ''));
    r.readAsText(file);
  };

  const doImport = async () => {
    setBusy(true); setMsg(''); setResult(null);
    try {
      const res = await fetch(`${apiBase}/import/olivos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ csv: oCsv })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Error importando olivos');
      setMsg(`OK: ${data.inserted ?? 0} olivos`);
      setResult(data);
      load();
    } catch (e) {
      setMsg(e.message || 'Error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card grid">
      <div className="controls" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Olivos</h1>
          <span className="muted">Solo administradores</span>
        </div>
        <div className="controls">
          <button className="btn btn-outline" onClick={load}>Recargar</button>
          <button className="btn btn-outline" disabled={busy} onClick={async () => {
            if (!confirm('¿Limpiar tabla olivos? Esta acción no se puede deshacer.')) return;
            setBusy(true); setMsg('');
            try {
              const res = await fetch(`${apiBase}/import/clear/olivos`, { method: 'POST', headers: { ...authHeaders } });
              if (!res.ok) throw new Error('Error limpiando olivos');
              setMsg('OK: olivos limpiados');
              load();
            } catch (e) { setMsg(e.message || 'Error'); } finally { setBusy(false); }
          }}>Limpiar tabla</button>
        </div>
      </div>
      <div className="row">
        <label>Importar olivos (CSV con columnas id,id_parcela)</label>
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files && e.target.files[0] && readFile(e.target.files[0], setOCsv)} />
        <div className="controls">
          <button className="btn" onClick={doImport} disabled={!oCsv || busy}>Importar</button>
          {msg && <span className={`state ${msg.startsWith('OK') ? 'ok' : 'error'}`} style={{ marginLeft: '0.5rem' }}>{msg}</span>}
        </div>
        {result?.errorsCount > 0 && (
          <div className="list" style={{ marginTop: '0.5rem' }}>
            {(result.errors || []).map((e, i) => (
              <div key={i} className="list-row">{e}</div>
            ))}
          </div>
        )}
      </div>
      <div className="row">
        {status === 'loading' && <span className="muted">Cargando…</span>}
        {status === 'error' && <span className="state error">No autorizado o error</span>}
        {status === 'ready' && rows.length === 0 && <span className="muted">Sin datos</span>}
        <div className="list two-col">
          {rows.map(r => (
            <div key={r.id} className="list-row">
              <div className="name">Olivo #{r.id}</div>
              <div>ID parcela: {r.id_parcela}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ParcelasView({ apiBase, authHeaders }) {
  const [rows, setRows] = React.useState([]);
  const [status, setStatus] = React.useState('idle');
  const [pCsv, setPCsv] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const [result, setResult] = React.useState(null);
  const load = async () => {
    setStatus('loading');
    try {
      const res = await fetch(`${apiBase}/parcelas`, { headers: { ...authHeaders } });
      if (!res.ok) throw new Error('No autorizado');
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
      setStatus('ready');
    } catch (e) {
      setStatus('error');
    }
  };
  React.useEffect(() => { load(); }, []);
  const readFile = (file, setter) => {
    const r = new FileReader();
    r.onload = () => setter(String(r.result || ''));
    r.readAsText(file);
  };
  const doImport = async () => {
    setBusy(true); setMsg(''); setResult(null);
    try {
      const res = await fetch(`${apiBase}/import/parcelas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ csv: pCsv })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Error importando parcelas');
      setMsg(`OK: ${data.inserted ?? 0} parcelas`);
      setResult(data);
      load();
    } catch (e) {
      setMsg(e.message || 'Error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card grid">
      <div className="controls" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Parcelas</h1>
          <span className="muted">Solo administradores</span>
        </div>
        <div className="controls">
          <button className="btn btn-outline" onClick={load}>Recargar</button>
          <button className="btn btn-outline" disabled={busy} onClick={async () => {
            if (!confirm('¿Limpiar tabla parcelas? También se borrarán olivos y relaciones.')) return;
            setBusy(true); setMsg('');
            try {
              const res = await fetch(`${apiBase}/import/clear/parcelas`, { method: 'POST', headers: { ...authHeaders } });
              if (!res.ok) throw new Error('Error limpiando parcelas');
              setMsg('OK: parcelas limpiadas');
              load();
            } catch (e) { setMsg(e.message || 'Error'); } finally { setBusy(false); }
          }}>Limpiar tabla</button>
        </div>
      </div>
      <div className="row">
        <label>Importar parcelas (CSV)</label>
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files && e.target.files[0] && readFile(e.target.files[0], setPCsv)} />
        <div className="controls">
          <button className="btn" onClick={doImport} disabled={!pCsv || busy}>Importar</button>
          {msg && <span className={`state ${msg.startsWith('OK') ? 'ok' : 'error'}`} style={{ marginLeft: '0.5rem' }}>{msg}</span>}
        </div>
        {result?.errorsCount > 0 && (
          <div className="list" style={{ marginTop: '0.5rem' }}>
            {(result.errors || []).map((e, i) => (
              <div key={i} className="list-row">{e}</div>
            ))}
          </div>
        )}
      </div>
      <div className="row">
        {status === 'loading' && <span className="muted">Cargando…</span>}
        {status === 'error' && <span className="state error">No autorizado o error</span>}
        {status === 'ready' && rows.length === 0 && <span className="muted">Sin datos</span>}
        <div className="list">
          {rows.map(p => (
            <div key={p.id} className="list-row" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr' }}>
              <div className="name">#{p.id} · {p.nombre || '(sin nombre)'}</div>
              <div className="muted">
                interno: {p.nombre_interno || '-'} · porcentaje: {p.porcentaje ?? '-'} · variedad: {p.variedad || '-'} ·
                SIGPAC {p.sigpac_municipio || '-'}/{p.sigpac_poligono || '-'}/{p.sigpac_parcela || '-'}/{p.sigpac_recinto || '-'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PalotsView({ apiBase, authHeaders }) {
  const [rows, setRows] = React.useState([]);
  const [status, setStatus] = React.useState('idle');
  const [codigo, setCodigo] = React.useState('');
  const [msg, setMsg] = React.useState('');

  const load = async () => {
    setStatus('loading');
    try {
      const res = await fetch(`${apiBase}/palots`, { headers: { ...authHeaders } });
      if (!res.ok) throw new Error('No autorizado');
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
      setStatus('ready');
    } catch (e) {
      setStatus('error');
    }
  };
  React.useEffect(() => { load(); }, []);

  const createPalot = async () => {
    setMsg('');
    try {
      const res = await fetch(`${apiBase}/palots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ codigo: codigo.trim() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Error al crear palot');
      setCodigo('');
      load();
    } catch (e) {
      setMsg(e.message || 'Error');
    }
  };

  const remove = async (id) => {
    if (!confirm('¿Eliminar palot? (Se eliminarán sus relaciones)')) return;
    setMsg('');
    try {
      const res = await fetch(`${apiBase}/palots/${id}`, { method: 'DELETE', headers: { ...authHeaders } });
      if (res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo eliminar');
      }
      load();
    } catch (e) { setMsg(e.message || 'Error'); }
  };

  return (
    <div className="card grid">
      <div className="controls" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Palots</h1>
          <span className="muted">Solo administradores</span>
        </div>
        <button className="btn btn-outline" onClick={load}>Recargar</button>
      </div>
      <div className="row">
        <label>Añadir palot</label>
        <div className="controls">
          <input style={{ width: 180 }} placeholder="Código" value={codigo} onChange={e => setCodigo(e.target.value)} />
          <button className="btn" disabled={!codigo.trim()} onClick={createPalot}>Crear</button>
          {msg && <span className="state error">{msg}</span>}
        </div>
      </div>
      <div className="row">
        {status === 'loading' && <span className="muted">Cargando…</span>}
        {status === 'error' && <span className="state error">No autorizado o error</span>}
        {status === 'ready' && rows.length === 0 && <span className="muted">Sin datos</span>}
        <div className="list">
          {rows.map(p => (
            <div key={p.id} className="list-row" style={{ justifyContent: 'space-between' }}>
              <div><span className="name">#{p.id}</span> <span className="code">{p.codigo}</span></div>
              <div className="controls">
                <button className="btn btn-outline" onClick={() => remove(p.id)}>Eliminar</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
