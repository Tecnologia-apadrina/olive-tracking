import React, { useEffect, useRef, useState } from 'react';
import {
  initOfflineStore,
  saveAuthSession,
  loadAuthSession,
  clearAuthSession,
  clearAllOfflineData,
  listRelations,
  listRelationsByParcela,
  getPalotByCodigo,
  enqueueEnsurePalot,
  enqueueRelation,
  getParcelaByOlivo as offlineGetParcelaByOlivo,
  getParcelaById,
  getPendingOps,
  getLastSnapshotIso,
} from './offline/db';
import { syncAll, syncDown, syncUp } from './offline/sync';

const normalizeRole = (role) => {
  if (!role) return '';
  return role === 'user' ? 'campo' : role;
};

function App() {
  // Auth
  const [authUser, setAuthUser] = useState('');
  const [authPass, setAuthPass] = useState('');
  const [authToken, setAuthToken] = useState(''); // base64 username:password
  const [authRole, setAuthRole] = useState('');
  const [view, setView] = useState('main'); // main | users | olivos | parcelas | palots
  const [palotInput, setPalotInput] = useState('');
  const [palotList, setPalotList] = useState([]);
  const [palotKgs, setPalotKgs] = useState('');
  const [palotAddError, setPalotAddError] = useState('');
  const [showOwnPalotsOnly, setShowOwnPalotsOnly] = useState(false);
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
  const [kgsDraft, setKgsDraft] = useState({}); // { [relationKey]: string }
  const [kgSaveStatus, setKgSaveStatus] = useState({}); // { [relationKey]: 'idle'|'saving'|'ok'|'error' }
  const [collapsedPalots, setCollapsedPalots] = useState({}); // { [palotId]: boolean }
  const [palotProcessing, setPalotProcessing] = useState({}); // { [palotKey]: 'saving'|'error' }
  const debounceRef = useRef(null);
  const [appVersion, setAppVersion] = useState('');
  const [dbUrl, setDbUrl] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [parcelaWarning, setParcelaWarning] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSync, setLastSync] = useState(null);
  const [offlineReady, setOfflineReady] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  const syncTimeoutRef = useRef(null);
  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        await initOfflineStore();
        if (cancelled) return;
        setOfflineReady(true);
        const session = await loadAuthSession().catch(() => null);
        let token = session?.token || '';
        let username = session?.username || '';
        let role = session?.role || '';
        if (!token) {
          const legacyToken = localStorage.getItem('authToken');
          const legacyUser = localStorage.getItem('authUser');
          token = legacyToken || '';
          username = legacyUser || username;
          if (legacyToken) {
            const safeRole = normalizeRole(role);
            saveAuthSession({ token: legacyToken, username: legacyUser || '', role: safeRole || '' }).catch(() => {});
          }
        }
        if (!cancelled && token) {
          setAuthToken(token);
          setAuthUser(username || '');
          setAuthRole(normalizeRole(role));
        }
        const last = await getLastSnapshotIso();
        if (!cancelled && last) setLastSync(last);
        const pending = await getPendingOps().catch(() => []);
        if (!cancelled) setPendingCount(pending.length);
      } catch (_) {}
      if (cancelled) return;
      const initialPath = window.location?.pathname || '/';
      if (initialPath === '/logout') {
        clearToken();
        if (window.history && window.location) {
          window.history.replaceState({}, '', '/');
        }
      }
      const basePath = initialPath === '/logout' ? '/' : initialPath;
      setView(basePath === '/users' ? 'users' : (basePath === '/olivos' ? 'olivos' : (basePath === '/parcelas' ? 'parcelas' : (basePath === '/palots' ? 'palots' : 'main'))));
    };

    bootstrap();

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
    return () => {
      cancelled = true;
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  useEffect(() => {
    const updateStatus = () => setIsOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    return () => {
      window.removeEventListener('online', updateStatus);
      window.removeEventListener('offline', updateStatus);
    };
  }, []);

  useEffect(() => () => {
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
  }, []);

  // API base fija usando proxy de Nginx en Docker
  const apiBase = '/api';
  // Load app version whenever online
  useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;
    fetch(`${apiBase}/version`).then(r => r.ok ? r.json() : null).then(v => {
      if (cancelled || !v) return;
      if (v.appVersion || v.version) {
        setAppVersion(v.appVersion || v.version);
      }
      const safeDb = v?.details?.db?.safe || v?.details?.db?.url || '';
      if (safeDb) setDbUrl(safeDb);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isOnline]);
  const authHeaders = authToken ? { Authorization: `Basic ${authToken}` } : {};
  const applySession = async ({ username, token, role, persist = true }) => {
    setAuthToken(token);
    setAuthUser(username);
    const safeRole = normalizeRole(role);
    setAuthRole(safeRole);
    if (persist) {
      try {
        localStorage.setItem('authToken', token);
        localStorage.setItem('authUser', username);
      } catch (_) {}
      try {
        await saveAuthSession({ token, username, role: safeRole || '' });
      } catch (_) {}
    }
  };

  useEffect(() => {
    if (authRole !== 'campo' && showOwnPalotsOnly) {
      setShowOwnPalotsOnly(false);
    }
  }, [authRole, showOwnPalotsOnly]);

  const performLogin = async (u, p) => {
    try {
      setLoginError('');
      setLoginBusy(true);
      const token = btoa(`${u}:${p}`);
      if (!isOnline) {
        const session = await loadAuthSession().catch(() => null);
        if (session && session.token === token) {
          await applySession({ username: session.username || u, token, role: session.role || '' });
          setAuthPass('');
          return;
        }
        throw new Error('offline-login');
      }
      const res = await fetch(`${apiBase}/me`, { headers: { Authorization: `Basic ${token}` } });
      if (!res.ok) throw new Error('Credenciales no válidas');
      const me = await res.json();
      await applySession({ username: u, token, role: me?.role || '' });
      setAuthPass('');
      await runSync();
    } catch (err) {
      if (err.message === 'offline-login') {
        setLoginError('Necesitas autenticarte en línea al menos una vez.');
      } else if (err?.status === 401) {
        setLoginError('Credenciales incorrectas.');
      } else if (!isOnline) {
        setLoginError('Sin conexión. Guarda tus credenciales online primero.');
      } else {
        setLoginError('Credenciales incorrectas.');
      }
    } finally {
      setLoginBusy(false);
    }
  };

  const clearToken = () => {
    setAuthToken('');
    setAuthUser('');
    setAuthPass('');
    setAuthRole('');
    setPendingCount(0);
    setLastSync(null);
    setAllRels([]);
    setRelPalots([]);
    setParcelaNombre('');
    setParcelaId(null);
    setParcelaPct(null);
    setPalotKgs('');
    setKgsDraft({});
    setKgSaveStatus({});
    try {
      localStorage.removeItem('authToken');
      localStorage.removeItem('authUser');
    } catch (_) {}
    clearAuthSession().catch(() => {});
    clearAllOfflineData().catch(() => {});
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
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!olivo || olivo.trim() === '') {
      setStatus('idle');
      setParcelaNombre('');
      setParcelaId(null);
      setParcelaPct(null);
      setPalotKgs('');
      return;
    }

    setStatus('waiting');
    debounceRef.current = setTimeout(async () => {
      setStatus('loading');
      try {
        let parcelaData = null;
        if (isOnline) {
          try {
            const res = await fetch(`${apiBase}/olivos/${encodeURIComponent(olivo)}/parcela`, { headers: { ...authHeaders } });
            if (res.ok) {
              parcelaData = await res.json();
            } else if (res.status === 404) {
              parcelaData = null;
            } else if (res.status === 401) {
              throw new Error('No autenticado');
            } else {
              throw new Error('network');
            }
          } catch (err) {
            if (typeof navigator !== 'undefined' && !navigator.onLine) {
              parcelaData = null;
            } else if (err.message === 'No autenticado') {
              throw err;
            }
          }
        }
        if (!parcelaData) {
          parcelaData = await offlineGetParcelaByOlivo(olivo);
        }
        if (!parcelaData) {
          throw new Error('No encontrado');
        }
        setParcelaNombre(parcelaData.nombre || '');
        setParcelaId(parcelaData.id ?? null);
        setParcelaPct(parcelaData.porcentaje ?? null);
        setPalotKgs('');
        setStatus('success');
        loadRelPalots(parcelaData.id ?? null);
      } catch (err) {
        setParcelaNombre('');
        setParcelaId(null);
        setParcelaPct(null);
        setPalotKgs('');
        setStatus('error');
        loadRelPalots(null);
      }
    }, 800);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [olivo, isOnline, authToken]);

  

  const refreshAllData = async () => {
    const [relations, pending] = await Promise.all([
      listRelations().catch(() => []),
      getPendingOps().catch(() => []),
    ]);
    const rows = Array.isArray(relations) ? relations : [];
    setAllRels(rows);
    const map = new Map();
    for (const r of rows) {
      const key = getRelationKey(r);
      if (!key || map.has(key)) continue;
      map.set(key, r.kgs == null ? '' : String(r.kgs));
    }
    setKgsDraft(Object.fromEntries(map));
    setKgSaveStatus({});
    setPendingCount(Array.isArray(pending) ? pending.length : 0);
    return rows;
  };

  const loadAllRels = async () => {
    setAllStatus('loading');
    try {
      await refreshAllData();
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
      const data = await listRelationsByParcela(pid);
      setRelPalots(Array.isArray(data) ? data : []);
      setRelStatus('ready');
    } catch (e) {
      setRelStatus('error');
    }
  };

  const runSync = async ({ mode } = {}) => {
    if (!authToken || syncingRef.current) return;
    if (!isOnline) {
      setSyncMessage('Sin conexión. No se puede sincronizar.');
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
      return;
    }
    syncingRef.current = true;
    setSyncing(true);
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
    setSyncMessage('Sincronizando…');
    try {
      const headers = { Authorization: `Basic ${authToken}` };
      if (mode === 'push') {
        await syncUp(apiBase, headers);
      } else if (mode === 'pull') {
        await syncDown(apiBase, headers);
      } else {
        await syncAll(apiBase, headers);
      }
      await refreshAllData();
      const stamp = new Date().toISOString();
      setLastSync(stamp);
      setSyncMessage('Sincronización completada.');
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = setTimeout(() => setSyncMessage(''), 4000);
    } catch (err) {
      console.error('Sync error', err);
      setSyncMessage('Error al sincronizar. Revisa la conexión.');
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  };

  const formatDateTime = (iso) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString();
    } catch (_) {
      return iso;
    }
  };

  // Cargar todas las relaciones al montar (solo con sesión)
  useEffect(() => {
    if (authToken && offlineReady) loadAllRels();
  }, [authToken, offlineReady]);

  useEffect(() => {
    if (!authToken || !isOnline || !offlineReady) return;
    runSync();
  }, [authToken, isOnline, offlineReady]);

  const handleDeleteRelation = async (relation) => {
    if (!relation) return;
    if (!window.confirm('¿Eliminar la relación parcela-palot?')) return;
    if (!isOnline) {
      setSyncMessage('Sin conexión. No se puede eliminar la relación.');
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
      return;
    }
    try {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
      setSyncMessage('Eliminando relación…');
      const res = await fetch(`${apiBase}/parcelas/${relation.parcela_id}/palots/${relation.palot_id}`, {
        method: 'DELETE',
        headers: { ...authHeaders },
      });
      if (res.status !== 204) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || 'No se pudo eliminar la relación');
      }
      await runSync({ mode: 'pull' });
      setSyncMessage('Relación eliminada.');
      syncTimeoutRef.current = setTimeout(() => setSyncMessage(''), 4000);
    } catch (err) {
      console.error('Delete relation error', err);
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
      setSyncMessage(err?.message ? `Error al eliminar: ${err.message}` : 'Error al eliminar la relación.');
    }
  };

  const getRelationKey = (relation) => {
    if (!relation) return '';
    if (relation.id !== undefined && relation.id !== null) return String(relation.id);
    if (relation.key) return String(relation.key);
    return `${relation.parcela_id ?? 'p'}-${relation.palot_id ?? 'palot'}-${relation.created_at ?? 'unknown'}`;
  };

  const parseKgsInput = (value) => {
    if (value === undefined || value === null) {
      return { hasValue: false, value: null, valid: true };
    }
    const normalized = String(value).replace(',', '.').trim();
    if (normalized === '') {
      return { hasValue: false, value: null, valid: true };
    }
    const num = Number(normalized);
    if (Number.isNaN(num)) {
      return { hasValue: true, value: null, valid: false };
    }
    return { hasValue: true, value: num, valid: true };
  };

  const togglePalotCollapse = (palotId) => {
    setCollapsedPalots((prev) => ({ ...prev, [palotId]: !prev[palotId] }));
  };

  const persistPalotCodes = async ({
    codes,
    normalizedKgs,
    parcelaInfoOverride = null,
    successMessage,
    offlineMessage,
    resetMode = 'full',
  }) => {
    const uniqueCodes = Array.from(new Set((codes || []).map((raw) => String(raw).trim()).filter(Boolean)));
    if (uniqueCodes.length === 0) {
      setSaveStatus('fail');
      setMessage('Añade al menos un número de palot.');
      return { ok: false, reason: 'no-codes' };
    }

    const parcelaInfo = parcelaInfoOverride ?? (await getParcelaById(parcelaId).catch(() => null));
    const defaultSuccessMsg = uniqueCodes.length > 1
      ? `Relaciones guardadas para ${uniqueCodes.length} palots.`
      : 'Relación guardada correctamente.';
    const defaultOfflineMsg = uniqueCodes.length > 1
      ? `Relaciones guardadas sin conexión (${uniqueCodes.length}). Se sincronizarán al recuperar la red.`
      : 'Guardado sin conexión. Se sincronizará al recuperar la red.';
    const successMsg = successMessage || defaultSuccessMsg;
    const offlineMsg = offlineMessage || defaultOfflineMsg;

    const resetAfterSuccess = () => {
      if (resetMode === 'full') {
        setPalotList([]);
        setPalotInput('');
        setPalotAddError('');
        setOlivo('');
        setParcelaNombre('');
        setParcelaId(null);
        setParcelaPct(null);
        setPalotKgs('');
        setStatus('idle');
      } else if (resetMode === 'input') {
        setPalotList((prev) => prev.filter((code) => !uniqueCodes.includes(code)));
        setPalotInput('');
        setPalotAddError('');
        setOlivo('');
        setParcelaNombre('');
        setParcelaId(null);
        setParcelaPct(null);
        setPalotKgs('');
        setStatus('idle');
      }
    };

    const handleRemainingCodes = (remaining) => {
      if (resetMode === 'full') {
        setPalotList(remaining);
        setPalotInput(remaining[0] || '');
      } else if (resetMode === 'input') {
        setPalotInput(remaining[0] || '');
        setPalotAddError('');
      }
    };

    const saveOfflineCodes = async (msg, codesToSave = uniqueCodes) => {
      const targets = Array.from(new Set((codesToSave || []).map((raw) => String(raw).trim()).filter(Boolean)));
      if (targets.length === 0) return;
      for (const palotCode of targets) {
        const existingPalot = await getPalotByCodigo(palotCode).catch(() => null);
        if (!existingPalot || existingPalot.source !== 'server') {
          await enqueueEnsurePalot(palotCode);
        }
        await enqueueRelation({
          parcela_id: parcelaId,
          palot_codigo: palotCode,
          parcela_nombre: parcelaInfo?.nombre || parcelaNombre || '',
          parcela_variedad: parcelaInfo?.variedad || '',
          parcela_porcentaje: parcelaInfo?.porcentaje ?? parcelaPct ?? null,
          parcela_nombre_interno: parcelaInfo?.nombre_interno || '',
          sigpac_municipio: parcelaInfo?.sigpac_municipio || '',
          sigpac_poligono: parcelaInfo?.sigpac_poligono || '',
          sigpac_parcela: parcelaInfo?.sigpac_parcela || '',
          sigpac_recinto: parcelaInfo?.sigpac_recinto || '',
          kgs: normalizedKgs,
          created_at: new Date().toISOString(),
          created_by: authUser || '',
          created_by_username: authUser || '',
        });
      }
      await refreshAllData();
      await loadRelPalots(parcelaId);
      setSaveStatus('ok');
      setMessage(msg || offlineMsg);
      resetAfterSuccess();
    };

    setSaveStatus('saving');
    const processedCodes = [];

    try {
      if (!isOnline) {
        await saveOfflineCodes(offlineMsg);
        return { ok: true, mode: 'offline' };
      }

      const listRes = await fetch(`${apiBase}/palots`, { headers: { ...authHeaders } });
      if (listRes.status === 401) {
        const err = new Error('No autenticado');
        err.status = 401;
        throw err;
      }
      const palots = listRes.ok ? await listRes.json() : [];
      const palotMap = new Map();
      for (const item of Array.isArray(palots) ? palots : []) {
        palotMap.set(String(item.codigo).trim(), item);
      }

      for (const palotCode of uniqueCodes) {
        let palotRow = palotMap.get(palotCode);
        if (!palotRow) {
          const createRes = await fetch(`${apiBase}/palots`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ codigo: palotCode })
          });
          if (createRes.status === 401) {
            const err = new Error('No autenticado');
            err.status = 401;
            throw err;
          }
          if (!createRes.ok) throw new Error(`No se pudo crear el palot ${palotCode}`);
          palotRow = await createRes.json();
          palotMap.set(String(palotRow.codigo).trim(), palotRow);
        }

        const relRes = await fetch(`${apiBase}/parcelas/${parcelaId}/palots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ palot_id: palotRow.id, kgs: normalizedKgs })
        });
        if (relRes.status === 401) {
          const err = new Error('No autenticado');
          err.status = 401;
          throw err;
        }
        if (!relRes.ok) {
          const errBody = await relRes.json().catch(() => ({}));
          const baseMsg = errBody.error || 'No se pudo guardar la relación';
          throw new Error(`${baseMsg} (palot ${palotCode})`);
        }
        processedCodes.push(palotCode);
      }

      setSaveStatus('ok');
      setMessage(successMsg);
      await runSync({ mode: 'pull' });
      await loadRelPalots(parcelaId);
      resetAfterSuccess();
      return { ok: true, mode: 'online' };
    } catch (e) {
      const remainingCodes = uniqueCodes.filter((code) => !processedCodes.includes(code));
      if (!isOnline || e.name === 'TypeError' || e.message === 'Failed to fetch' || e.message === 'network') {
        if (remainingCodes.length > 0) {
          await saveOfflineCodes(offlineMsg, remainingCodes);
        } else {
          setSaveStatus('ok');
          setMessage(successMsg);
          await refreshAllData();
          await loadRelPalots(parcelaId);
          resetAfterSuccess();
        }
        return { ok: true, mode: 'offline-fallback' };
      }

      setSaveStatus('fail');
      if (e.status === 401 || (e.message && e.message.includes('401'))) {
        setMessage('No autenticado. Inicia sesión.');
      } else {
        setMessage(e.message || 'Error al guardar.');
      }
      handleRemainingCodes(remainingCodes);
      return { ok: false, error: e };
    }
  };

  const handleSave = async () => {
    setMessage('');
    setPalotAddError('');
    if (!parcelaId) {
      setSaveStatus('fail');
      setMessage('Primero busca un olivo válido para obtener su parcela.');
      return;
    }

    const typedCode = String(palotInput ?? '').trim();
    const palotCodes = [];
    const pushCode = (raw) => {
      if (raw === null || raw === undefined) return;
      const code = String(raw).trim();
      if (!code) return;
      if (!palotCodes.includes(code)) palotCodes.push(code);
    };
    palotList.forEach(pushCode);
    pushCode(typedCode);

    if (palotCodes.length === 0) {
      setSaveStatus('fail');
      setMessage('Añade al menos un número de palot.');
      return;
    }

    if (typedCode && !palotList.includes(typedCode)) {
      setPalotList((prev) => (prev.includes(typedCode) ? prev : [...prev, typedCode]));
    }

    const parcelaInfo = await getParcelaById(parcelaId).catch(() => null);
    const parcelaPercent = parcelaInfo?.porcentaje ?? parcelaPct;
    const hasPct = parcelaPercent != null && parcelaPercent !== '' && !Number.isNaN(Number(parcelaPercent)) && Number(parcelaPercent) > 0;
    const rawKgsInput = hasPct ? palotKgs : '';
    const parsedKgs = parseKgsInput(rawKgsInput);
    let normalizedKgs = null;

    if (hasPct) {
      if (!parsedKgs.hasValue) {
        const confirmed = typeof window === 'undefined' ? true : window.confirm('La parcela tiene porcentaje y no has introducido los kgs. ¿Quieres continuar sin registrarlos?');
        if (!confirmed) {
          setSaveStatus('idle');
          setMessage('Introduce los kgs para continuar o confirma que deseas omitirlos.');
          return;
        }
      } else if (!parsedKgs.valid) {
        setSaveStatus('fail');
        setMessage('Introduce un valor numérico en Kgs.');
        return;
      } else {
        normalizedKgs = parsedKgs.value;
      }
    } else if (parsedKgs.hasValue) {
      if (!parsedKgs.valid) {
        setSaveStatus('fail');
        setMessage('Introduce un valor numérico en Kgs.');
        return;
      }
      normalizedKgs = parsedKgs.value;
    }

    await persistPalotCodes({
      codes: palotCodes,
      normalizedKgs,
      parcelaInfoOverride: parcelaInfo,
      successMessage: palotCodes.length > 1 ? `Relaciones guardadas para ${palotCodes.length} palots.` : 'Relación guardada correctamente.',
      offlineMessage: 'Guardado sin conexión. Se sincronizará al recuperar la red.',
      resetMode: 'full',
    });
  };

  const pendingPalotsCount = palotList.length + (String(palotInput ?? '').trim() ? 1 : 0);
  const canSave = status === 'success' && !!parcelaId && pendingPalotsCount > 0 && saveStatus !== 'saving';

  const addPalotToCustomList = () => {
    const trimmed = String(palotInput ?? '').trim();
    if (!trimmed) {
      setPalotAddError('Introduce un número antes de añadir.');
      return;
    }
    if (palotList.includes(trimmed)) {
      setPalotAddError('Ese palot ya está en la lista.');
      return;
    }
    setPalotList((prev) => [...prev, trimmed]);
    setPalotInput('');
    setPalotAddError('');
  };

  const handleQuickAdd = async () => {
    if (saveStatus === 'saving') return;
    if (!parcelaHasPct) {
      addPalotToCustomList();
      return;
    }
    setPalotAddError('');
    if (!parcelaId) {
      setSaveStatus('fail');
      setMessage('Primero busca un olivo válido para obtener su parcela.');
      return;
    }
    const trimmed = String(palotInput ?? '').trim();
    if (!trimmed) {
      setPalotAddError('Introduce un número antes de añadir.');
      return;
    }
    const parcelaInfo = await getParcelaById(parcelaId).catch(() => null);
    await persistPalotCodes({
      codes: [trimmed],
      normalizedKgs: 300,
      parcelaInfoOverride: parcelaInfo,
      successMessage: `Palot ${trimmed} guardado con 300 kgs.`,
      offlineMessage: `Palot ${trimmed} guardado sin conexión (300 kgs). Se sincronizará al recuperar la red.`,
      resetMode: 'input',
    });
  };

  const removePalotFromList = (index) => {
    setPalotList((prev) => prev.filter((_, i) => i !== index));
    setPalotAddError('');
  };

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

  useEffect(() => {
    if (!parcelaId) {
      setParcelaWarning('');
      setPalotKgs('');
      return;
    }
    const hasRelationToday = Array.isArray(allRels) && allRels.some((r) => {
      if (Number(r.parcela_id) !== Number(parcelaId)) return false;
      if (!r.created_at) return false;
      return dateKeyLocal(r.created_at) === todayKey;
    });
    setParcelaWarning(hasRelationToday ? 'Advertencia: la parcela ya tiene relaciones registradas hoy.' : '');
  }, [parcelaId, allRels, todayKey]);

  // Lista a mostrar según filtro de palot, ordenada por fecha creación desc
  const relsToShow = (allRels || [])
    .filter((r) => {
      const matchesPalot = String(r.palot_codigo || '').toLowerCase().includes(String(filterPalot || '').trim().toLowerCase());
      if (!matchesPalot) return false;
      if (showOwnPalotsOnly) {
        const owner = String(r.created_by_username || r.created_by || '').trim().toLowerCase();
        return owner && owner === String(authUser || '').trim().toLowerCase();
      }
      return true;
    })
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

  const palotKeyForState = (palotId, palotCodigo) => {
    if (palotId != null && palotId !== '') return String(palotId);
    return `code:${String(palotCodigo ?? '')}`;
  };

  // Agrupar por palot
  const palotGroups = React.useMemo(() => {
    const base = relTab === 'today' ? relsByTab.today : relsByTab.prev;
    const map = new Map(); // palot_id -> { palot_id, palot_codigo, items: [], hasPct: boolean, processed: boolean }
    for (const r of base) {
      const key = r.palot_id;
      if (!map.has(key)) map.set(key, { palot_id: r.palot_id, palot_codigo: r.palot_codigo, items: [], hasPct: false, processed: Boolean(r.palot_procesado) });
      const g = map.get(key);
      g.items.push(r);
      if (!g.hasPct && r.parcela_porcentaje != null && Number(r.parcela_porcentaje) > 0) g.hasPct = true;
      if (!g.processed && r.palot_procesado) g.processed = Boolean(r.palot_procesado);
    }
    // Keep deterministic order: by palot code asc
    return Array.from(map.values()).sort((a, b) => String(a.palot_codigo).localeCompare(String(b.palot_codigo)));
  }, [relsByTab, relTab]);

  const syncStatusClass = React.useMemo(() => {
    if (!syncMessage) return 'state muted';
    if (syncMessage.includes('completada')) return 'state ok';
    if (syncMessage.includes('Sincronizando')) return 'state muted';
    return 'state error';
  }, [syncMessage]);

  const parcelaHasPct = parcelaPct != null && parcelaPct !== '' && !Number.isNaN(Number(parcelaPct)) && Number(parcelaPct) > 0;
  const canManagePalots = authRole === 'admin' || authRole === 'molino';
  const canExport = canManagePalots;

  const exportCsv = (mode) => {
    // Columnas: codigo_palot, id_parcela, nombre_parcela, sigpac_municipio, sigpac_poligono, sigpac_parcela, sigpac_recinto, parcela_variedad, parcela_porcentaje, kgs, fecha_creacion, creado_por
    const header = ['codigo_palot', 'id_parcela', 'nombre_parcela', 'sigpac_municipio', 'sigpac_poligono', 'sigpac_parcela', 'sigpac_recinto', 'parcela_variedad', 'parcela_porcentaje', 'kgs', 'fecha_creacion', 'creado_por'];
    const escape = (v) => '"' + String(v ?? '').replaceAll('"', '""') + '"';
    const source = mode === 'today' ? relsByTab.today : allRels;
    const rows = (source || []).map(r => [
      r.palot_codigo,
      r.parcela_id,
      r.parcela_nombre || '',
      r.sigpac_municipio || '',
      r.sigpac_poligono || '',
      r.sigpac_parcela || '',
      r.sigpac_recinto || '',
      r.parcela_variedad || '',
      r.parcela_porcentaje != null ? r.parcela_porcentaje : '',
      r.kgs != null ? r.kgs : '',
      r.created_at ? new Date(r.created_at).toISOString() : '',
      r.created_by_username || r.created_by || ''
    ]);
    const csv = [header.join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = mode === 'today' ? 'relaciones_parcela_palot_hoy.csv' : 'relaciones_parcela_palot_general.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleTogglePalotProcessed = async ({ palotId, palotCodigo, processed }) => {
    if (!canManagePalots || !authToken) return;
    const numericId = Number(palotId);
    if (!Number.isFinite(numericId)) return;
    if (!isOnline) return;
    const palotKey = palotKeyForState(palotId, palotCodigo);
    setPalotProcessing((prev) => ({ ...prev, [palotKey]: 'saving' }));
    try {
      const res = await fetch(`${apiBase}/palots/${numericId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ procesado: !processed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo actualizar el estado');
      }
      await syncDown(apiBase, authHeaders);
      await refreshAllData();
      setLastSync(new Date().toISOString());
      setPalotProcessing((prev) => {
        const next = { ...prev };
        delete next[palotKey];
        return next;
      });
    } catch (err) {
      console.error('Error actualizando procesado del palot', err);
      setPalotProcessing((prev) => ({ ...prev, [palotKey]: 'error' }));
    }
  };

  const handleKgsBlur = async (relation) => {
    const relKey = getRelationKey(relation);
    if (!relKey) return;
    const draftValue = kgsDraft[relKey] ?? '';
    const parsed = parseKgsInput(draftValue);
    if (parsed.hasValue && !parsed.valid) {
      setKgSaveStatus((s) => ({ ...s, [relKey]: 'error' }));
      return;
    }

    const newVal = parsed.hasValue && parsed.valid ? parsed.value : null;
    const nextDraftValue = parsed.hasValue && parsed.valid ? String(parsed.value) : '';
    const numericId = Number(relation?.id);
    if (Number.isNaN(numericId)) return;

    const existingVal = relation?.kgs == null ? null : Number(relation.kgs);
    if ((!parsed.hasValue && existingVal == null) || (parsed.hasValue && parsed.valid && existingVal === newVal)) {
      setKgsDraft((s) => ({ ...s, [relKey]: nextDraftValue }));
      setKgSaveStatus((s) => ({ ...s, [relKey]: 'idle' }));
      return;
    }

    setKgSaveStatus((s) => ({ ...s, [relKey]: 'saving' }));
    try {
      const res = await fetch(`${apiBase}/parcelas-palots/${numericId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ kgs: newVal })
      });
      if (!res.ok) throw new Error('No se pudo guardar');
      setKgsDraft((s) => ({ ...s, [relKey]: nextDraftValue }));
      setKgSaveStatus((s) => ({ ...s, [relKey]: 'ok' }));
      setAllRels((rows) => rows.map((r) => (getRelationKey(r) === relKey ? { ...r, kgs: newVal } : r)));
      setRelPalots((rows) => rows.map((r) => (getRelationKey(r) === relKey ? { ...r, kgs: newVal } : r)));
      setTimeout(() => setKgSaveStatus((s) => ({ ...s, [relKey]: 'idle' })), 1200);
    } catch (e) {
      setKgSaveStatus((s) => ({ ...s, [relKey]: 'error' }));
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

        <div className="controls" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <span className={`state ${isOnline ? 'ok' : 'error'}`}>
            {isOnline ? 'Modo en línea' : 'Sin conexión: modo offline'}
          </span>
          {pendingCount > 0 && (
            <span className="pill danger" style={{ background: '#f97316', borderColor: '#f97316' }}>
              Pendientes por sincronizar: {pendingCount}
            </span>
          )}
          {lastSync && (
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              Última sincronización: {formatDateTime(lastSync)}
            </span>
          )}
          <button
            className={syncing ? 'btn' : 'btn btn-outline'}
            onClick={() => runSync()}
            disabled={syncing}
          >
            {syncing ? 'Sincronizando…' : 'Sincronizar'}
          </button>
        </div>
        {syncMessage && (
          <span className={syncStatusClass} style={{ marginTop: '-0.25rem' }}>
            {syncMessage}
          </span>
        )}

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
          <label>Introduce números de palot</label>
          <div className="palot-input-group">
            <input
              value={palotInput}
              onChange={(e) => {
                setPalotInput(e.target.value);
                if (palotAddError) setPalotAddError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (e.shiftKey || !parcelaHasPct) {
                    addPalotToCustomList();
                  } else {
                    handleQuickAdd();
                  }
                }
              }}
              placeholder="Ej. 42"
              inputMode="numeric"
            />
          </div>
          <button
            type="button"
            className="btn-link"
            onClick={addPalotToCustomList}
          >
            Añadir a lista para guardar con Kgs personalizados
          </button>
          {palotAddError && <span className="state error" style={{ marginTop: '0.35rem' }}>{palotAddError}</span>}
          {palotList.length > 0 && (
            <div className="palot-chip-list">
              {palotList.map((code, idx) => (
                <span key={`${code}-${idx}`} className="palot-chip">
                  <span className="palot-chip-code">{code}</span>
                  <button type="button" className="palot-chip-remove" aria-label={`Eliminar palot ${code}`} onClick={() => removePalotFromList(idx)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {parcelaHasPct && (
          <div className="row">
            <label>Introduce los kgs para esta parcela cedente</label>
            <div className="kgs-input-group">
              <input
                value={palotKgs}
                onChange={(e) => setPalotKgs(e.target.value)}
                placeholder="Ej. 1200"
                inputMode="decimal"
              />
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={handleQuickAdd}
                disabled={!String(palotInput ?? '').trim() || saveStatus === 'saving'}
              >
                Añadir completo
              </button>
            </div>
            <span className="muted">Se aplica porcentaje {String(parcelaPct)}%.</span>
          </div>
        )}

        <div className="controls">
          <button className="btn" onClick={handleSave} disabled={!canSave}>
            {saveStatus === 'saving' ? 'Guardando…' : 'Guardar'}
          </button>
          {message && (
            <span className={`state ${saveStatus === 'ok' ? 'ok' : saveStatus === 'fail' ? 'error' : 'muted'}`}>
              {message}
            </span>
          )}
          {parcelaWarning && (
            <span className="state warning">{parcelaWarning}</span>
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
            {authRole === 'campo' && (
              <button
                type="button"
                className={`btn ${showOwnPalotsOnly ? '' : 'btn-outline'}`}
                onClick={() => setShowOwnPalotsOnly((prev) => !prev)}
              >
                {showOwnPalotsOnly ? 'Todos los palots' : 'Mis palots'}
              </button>
            )}
            {canExport && (
              <div className="export-group">
                <button className="btn btn-outline" onClick={() => exportCsv('today')} disabled={relsByTab.today.length === 0}>Exportar hoy</button>
                <button className="btn btn-outline" onClick={() => exportCsv('all')} disabled={allRels.length === 0}>Exportar todo</button>
              </div>
            )}
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
              {palotGroups.map((g) => {
                const isCollapsed = !!collapsedPalots[g.palot_id];
                const palotStateKey = palotKeyForState(g.palot_id, g.palot_codigo);
                const processingState = palotProcessing[palotStateKey];
                const isProcessing = processingState === 'saving';
                const processingError = processingState === 'error';
                const hasServerId = Number.isFinite(Number(g.palot_id));
                const isProcessed = Boolean(g.processed);
                const buttonDisabled = isProcessing || !hasServerId || !isOnline;
                const buttonLabel = isProcessing ? 'Guardando…' : isProcessed ? 'Procesado ✓' : 'Procesado';
                const buttonTitle = !hasServerId
                  ? 'Disponible tras sincronizar este palot'
                  : !isOnline
                    ? 'Sin conexión. Conecta para actualizar.'
                    : isProcessed
                      ? 'Marcar como no procesado'
                      : 'Marcar como procesado';
                const showActions = canManagePalots || isProcessed || processingError;
                return (
                  <div key={g.palot_id} className={`cell ${isCollapsed ? 'cell-collapsed' : ''}`}>
                    <div className="cell-title">
                      <button
                        type="button"
                        className="collapse-toggle"
                        onClick={() => togglePalotCollapse(g.palot_id)}
                        aria-label={isCollapsed ? 'Expandir palot' : 'Colapsar palot'}
                      >
                        {isCollapsed ? '▶' : '▼'}
                      </button>
                      <span className="cell-title-text">
                        Palot {g.palot_codigo}
                        <span className="muted" style={{ marginLeft: '0.5rem', fontSize: '0.8rem' }}>({g.items.length})</span>
                      </span>
                      {g.hasPct && <span className="pill pill-warning">Parcela cedente</span>}
                      {showActions && (
                        <div className="cell-actions">
                          {isProcessed && <span className="pill pill-success">Procesado</span>}
                          {canManagePalots && (
                            <button
                              type="button"
                              className={`btn btn-sm ${isProcessed ? 'btn-success' : 'btn-outline'}`}
                              disabled={buttonDisabled}
                              aria-pressed={isProcessed}
                              title={buttonTitle}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (buttonDisabled) return;
                                handleTogglePalotProcessed({ palotId: g.palot_id, palotCodigo: g.palot_codigo, processed: isProcessed });
                              }}
                            >
                              {buttonLabel}
                            </button>
                          )}
                          {processingError && (
                            <span className="muted" style={{ color: '#b91c1c', fontWeight: 600 }}>Error</span>
                          )}
                        </div>
                      )}
                    </div>
                    {!isCollapsed && (
                      <div className="cell-details">
                        {g.items.map((r) => {
                          const relKey = getRelationKey(r);
                          const hasPct = r.parcela_porcentaje != null && Number(r.parcela_porcentaje) > 0;
                          const showKgEditor = hasPct || (r.kgs != null && r.kgs !== '');
                          const canEditKg = !r.pending && !Number.isNaN(Number(r?.id));
                          const draftValue = kgsDraft[relKey] ?? (r.kgs == null ? '' : String(r.kgs));
                          const status = kgSaveStatus[relKey];
                          return (
                            <div
                              key={r.id}
                              className={`kv ${r.pending ? 'kv-pending-card' : ''} ${hasPct ? 'kv-cedente' : ''}`}
                              onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                            >
                              {r.pending && (
                                <span className="kv-pending" style={{ gridColumn: '1 / -1' }}>Pendiente de sincronización</span>
                              )}
                              {hasPct && (
                                <span className="kv-warning" style={{ gridColumn: '1 / -1' }}>Parcela cedente ({String(r.parcela_porcentaje)}%)</span>
                              )}
                              {showKgEditor && (
                                <div className="cell-inline" style={{ gridColumn: '1 / -1' }}>
                                  <label className="kg-label" htmlFor={`kg-${relKey}`}>Kgs</label>
                                  <input
                                    id={`kg-${relKey}`}
                                    className="kg-input"
                                    value={draftValue}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setKgsDraft((s) => ({ ...s, [relKey]: val }));
                                      setKgSaveStatus((s) => ({ ...s, [relKey]: 'idle' }));
                                    }}
                                    onBlur={() => canEditKg && handleKgsBlur(r)}
                                    placeholder="0"
                                    inputMode="decimal"
                                    disabled={!canEditKg}
                                  />
                                  {status === 'saving' && <span className="muted">Guardando…</span>}
                                  {status === 'ok' && <span className="state ok">OK</span>}
                                  {status === 'error' && <span className="state error">Error</span>}
                                  {!canEditKg && !r.pending && <span className="muted">Sin id de servidor</span>}
                                </div>
                              )}
                              <span className="kv-label">Parcela</span><span className="kv-value">{r.parcela_nombre || '-'}</span>
                              <span className="kv-label">Creado por</span><span className="kv-value">{r.created_by_username || r.created_by || '-'}</span>
                              <span className="kv-label">Fecha</span><span className="kv-value">{r.created_at ? new Date(r.created_at).toLocaleString() : '-'}</span>
                              <button
                                className="cell-close"
                                onClick={(event) => { event.stopPropagation(); handleDeleteRelation(r); }}
                                disabled={!isOnline || syncing}
                                aria-label="Eliminar relación"
                              >
                                ×
                              </button>
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
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
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
  const [role, setRole] = React.useState('campo');
  const [drafts, setDrafts] = React.useState({}); // {id: {username, role, password}}

  const load = async () => {
    setStatus('loading');
    try {
      const res = await fetch(`${apiBase}/users`, { headers: { ...authHeaders } });
      if (!res.ok) throw new Error('No autorizado o error');
      const data = await res.json();
      const arr = Array.isArray(data) ? data.map(us => ({ ...us, role: normalizeRole(us.role) })) : [];
      setUsers(arr);
      const d = {};
      for (const us of arr) d[us.id] = { username: us.username, role: normalizeRole(us.role), password: '' };
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
      setU(''); setP(''); setRole('campo');
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
      const normalized = { ...updated, role: normalizeRole(updated.role) };
      setUsers(list => list.map(x => x.id === id ? normalized : x));
      setDrafts(d0 => ({ ...d0, [id]: { username: normalized.username, role: normalized.role, password: '' } }));
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
            <option value="campo">campo</option>
            <option value="molino">molino</option>
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
              <select value={drafts[us.id]?.role ?? 'campo'} onChange={e => setDrafts(d => ({ ...d, [us.id]: { ...(d[us.id]||{}), role: e.target.value } }))}>
                <option value="campo">campo</option>
                <option value="molino">molino</option>
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

  const toggleProcesado = async (palot) => {
    setMsg('');
    try {
      const res = await fetch(`${apiBase}/palots/${palot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ procesado: !palot.procesado })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Error al actualizar procesado');
      }
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
              <div>
                <span className="name">#{p.id}</span> <span className="code">{p.codigo}</span>
                {p.procesado && <span className="pill pill-success" style={{ marginLeft: '0.5rem' }}>Procesado</span>}
              </div>
              <div className="controls">
                <button
                  className={`btn btn-sm ${p.procesado ? 'btn-success' : 'btn-outline'}`}
                  onClick={() => toggleProcesado(p)}
                >
                  {p.procesado ? 'Procesado ✓' : 'Procesado'}
                </button>
                <button className="btn btn-outline" onClick={() => remove(p.id)}>Eliminar</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
