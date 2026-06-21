const SUPABASE_URL = 'https://samuwgxtsgbkyybbfurf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhbXV3Z3h0c2dia3l5YmJmdXJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MjIyNzQsImV4cCI6MjA5NDE5ODI3NH0.rrAE1nzKMEKIqCqaps__qb7i8WuLuXWu8n9wE1OWkFo';

(function () {
  'use strict';

  if (!window.supabase) { console.error('[SA] Supabase CDN not loaded.'); return; }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true },
  });

  const _state = { session: null, status: null, ready: false };

  async function getStatus(session) {
    if (!session) return null;
    try {
      const resp = await fetch(
        SUPABASE_URL + '/rest/v1/profiles?select=status&id=eq.' + session.user.id + '&limit=1',
        { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + session.access_token } }
      );
      const data = await resp.json();
      if (!Array.isArray(data) || data.length === 0) return null;
      return data[0].status;
    } catch(e) {
      console.error('[SA] getStatus error:', e.message);
      return null;
    }
  }

  const _cleanUrl = window.location.origin + window.location.pathname;

  async function signInWithGoogle() {
    const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: _cleanUrl } });
    if (error) console.error('[SA] signIn error:', error.message);
  }

  async function signOut() {
    await client.auth.signOut();
    _state.session = null;
    _state.status = null;
    window.history.replaceState({}, document.title, _cleanUrl);
  }

  async function getSession() {
    const { data: { session } } = await client.auth.getSession();
    return session;
  }

  const _listeners = [];

  function onAuthStateChange(callback) {
    _listeners.push(callback);
    if (_state.ready) callback({ event: 'INITIAL', session: _state.session, status: _state.status });
  }

  function _notify(event, session, status) {
    _listeners.forEach(fn => { try { fn({ event, session, status }); } catch(e) {} });
  }

  client.auth.onAuthStateChange(async (event, session) => {
    _state.session = session;
    _state.status = await getStatus(session);
    _notify(event, session, _state.status);
  });

  (async function init() {
    // Clean the URL hash after Supabase has read the tokens (detectSessionInUrl:true handles extraction)
    if (window.location.hash && window.location.hash.includes('access_token=')) {
      window.history.replaceState({}, document.title, _cleanUrl);
    }
    // Give Supabase a tick to finish processing the hash before we call getSession
    await new Promise(r => setTimeout(r, 50));
    if (!_state.session) {
      const session = await getSession();
      _state.session = session;
      _state.status = await getStatus(session);
    }
    _state.ready = true;
    _notify('INITIAL', _state.session, _state.status);
  })();

  // ===== Phase 2a: Supabase data mirror =====
  // Writes a copy of localStorage data up to Supabase. Reads stay on localStorage
  // (window.storage.get returns null) so the app behaves exactly as before. Fail-safe:
  // pe()/se() wrap these in try/catch and still use localStorage if anything errors.
  const _V = {
    entries:'bd-e5', cats:'bd-c5', tags:'bd-t5', chat:'bd-ch5', docs:'bd-d5',
    dark:'bd-dk5', notifs:'bd-n5', review:'bd-r5', recur:'bd-rc5',
    dinstr:'bd-di5', winstr:'bd-wi5', tokens:'bd-tok5', expenses:'bd-exp5'
  };
  let _ws = null, _wsPromise = null;
  async function _getWorkspace() {
    if (_ws) return _ws;
    if (!_state.session) return null;
    if (!_wsPromise) _wsPromise = (async () => {
      try {
        const r = await client.from('workspaces').select('id').eq('owner_id', _state.session.user.id).limit(1);
        if (r.data && r.data.length) return (_ws = r.data[0].id);
        const m = await client.from('workspace_members').select('workspace_id').limit(1);
        if (m.data && m.data.length) return (_ws = m.data[0].workspace_id);
      } catch (e) { console.warn('[SA] workspace lookup:', e.message); }
      return null;
    })();
    return _wsPromise;
  }
  const _iso = (v) => { try { return new Date(v || Date.now()).toISOString(); } catch (e) { return new Date().toISOString(); } };
  const _today = () => new Date().toISOString().slice(0, 10);
  function _taskRows(ws, b) {
    const out = [];
    if (b && typeof b === 'object') for (const cat of Object.keys(b)) (b[cat] || []).forEach((t, i) => {
      if (t && t.id) out.push({ id: String(t.id), workspace_id: ws, text: t.text || '', notes: t.notes || '',
        category: t.category || cat, status: t.status || 'todo', priority: t.priority || '',
        due_date: t.dueDate || null, tags: Array.isArray(t.tags) ? t.tags.map(String) : [],
        sort_order: i, created_at: _iso(t.createdAt) });
    });
    return out;
  }
  function _catRows(ws, b) { return (Array.isArray(b) ? b : []).filter(c => c && c.id).map((c, i) => ({
    id: String(c.id), workspace_id: ws, emoji: c.emoji || null, label: c.label || '', color: c.color || null,
    sort_order: i, is_default: !!c.is_default, created_at: _iso(c.createdAt) })); }
  function _tagRows(ws, b) { return (Array.isArray(b) ? b : []).filter(t => t && t.id).map(t => ({
    id: String(t.id), workspace_id: ws, label: t.label || '', color: t.color || null })); }
  function _txnRows(ws, b) {
    const out = []; const add = (arr, type) => (arr || []).forEach(t => { if (t && t.id) out.push({
      id: String(t.id), workspace_id: ws, type: type, amount: Number(t.amount) || 0, category: t.category || null,
      subcategory: t.subcategory || null, description: t.description || '', date: t.date || _today(), created_at: _iso(t.createdAt) }); });
    add(b && b.expenses, 'expense'); add(b && b.income, 'income'); return out;
  }
  function _streamRows(ws, b) { return ((b && b.streams) || []).filter(s => s && s.id).map(s => ({
    id: String(s.id), workspace_id: ws, type: s.type || null, label: s.label || null, category: s.category || null,
    subcategory: s.subcategory || null, amount: Number(s.amount) || 0, created_at: _iso(s.createdAt) })); }
  function _budgetRows(ws, b) { const o = (b && b.budgets) || {}; return Object.keys(o).map(cat => ({
    workspace_id: ws, category: cat, amount: Number(o[cat]) || 0 })); }
  // coerce a chat message's content (string | array | {text|content}) to text — mirrors the app's bdStr
  function _str(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.map(_str).join(' ');
    if (typeof v === 'object') return typeof v.text === 'string' ? v.text : _str(v.content);
    return '';
  }
  function _chatRows(ws, b) { // blob = flat message array (no ids) -> synthesize stable index ids
    return (Array.isArray(b) ? b : []).map((m, i) => ({ m, i })).filter(x => x.m && _str(x.m.content).trim() !== '')
      .map(({ m, i }) => ({ id: 'c' + i, workspace_id: ws, role: m.role || '', content: _str(m.content),
        thread_id: 'main', created_at: _iso(m.ts) }));
  }
  function _docRows(ws, b) { // blob = { [docId]: {title, notes, messages[], createdAt} }
    const out = [];
    if (b && typeof b === 'object') for (const id of Object.keys(b)) { const d = b[id]; if (!d) continue;
      out.push({ id: String(id), workspace_id: ws, title: d.title || '', body: '', notes: d.notes || '',
        messages: Array.isArray(d.messages) ? d.messages : [], created_at: _iso(d.createdAt) }); }
    return out;
  }
  function _notifRows(ws, b) { // blob = [ {id, title, body, read, createdAt} ]
    return (Array.isArray(b) ? b : []).filter(n => n && n.id).map(n => ({ id: String(n.id), workspace_id: ws,
      title: n.title || '', body: n.body || '', is_read: !!n.read, created_at: _iso(n.createdAt) }));
  }
  async function _syncTable(table, ws, rows, keyField) {
    keyField = keyField || 'id';
    const keys = rows.map(r => String(r[keyField]));
    if (rows.length) { const { error } = await client.from(table).upsert(rows, { onConflict: 'workspace_id,' + keyField }); if (error) throw error; }
    const { data: existing, error: e1 } = await client.from(table).select(keyField).eq('workspace_id', ws);
    if (e1) throw e1;
    const toDel = (existing || []).map(r => String(r[keyField])).filter(k => keys.indexOf(k) === -1);
    if (toDel.length) { const { error: e2 } = await client.from(table).delete().eq('workspace_id', ws).in(keyField, toDel); if (e2) throw e2; }
  }
  async function _syncSettings(patch) {
    const { error } = await client.from('user_settings').upsert(
      Object.assign({ user_id: _state.session.user.id, updated_at: new Date().toISOString() }, patch), { onConflict: 'user_id' });
    if (error) throw error;
  }
  async function _mirror(key, blob) {
    const ws = await _getWorkspace();
    if (!ws) return;
    if (key === _V.entries) await _syncTable('tasks', ws, _taskRows(ws, blob));
    else if (key === _V.cats) await _syncTable('categories', ws, _catRows(ws, blob));
    else if (key === _V.tags) await _syncTable('tags', ws, _tagRows(ws, blob));
    else if (key === _V.expenses) {
      await _syncTable('transactions', ws, _txnRows(ws, blob));
      await _syncTable('streams', ws, _streamRows(ws, blob));
      await _syncTable('budgets', ws, _budgetRows(ws, blob), 'category');
    }
    else if (key === _V.dark) await _syncSettings({ dark_mode: !!blob });
    else if (key === _V.dinstr) await _syncSettings({ daily_instructions: blob || '' });
    else if (key === _V.winstr) await _syncSettings({ weekly_instructions: blob || '' });
    else if (key === _V.chat) await _syncTable('chat_messages', ws, _chatRows(ws, blob));
    else if (key === _V.docs) await _syncTable('docs', ws, _docRows(ws, blob));
    else if (key === _V.notifs) await _syncTable('notifications', ws, _notifRows(ws, blob));
    // review / recur / tokens: settings-ish, still cloud-synced via app_state; no relational projection needed
  }
  // ----- Phase 2b: app_state key→blob store (the read path / cross-device sync) -----
  // Stores the EXACT blob the app writes, so reads round-trip identically (no
  // reconstruction). get() returns the cloud blob or null; null => pe() falls
  // back to localStorage, so the worst case is exactly today's behavior.
  let _kv = null, _kvPromise = null;
  async function _loadKV() {
    if (_kv) return _kv;
    const ws = await _getWorkspace();
    if (!ws) return null;
    if (!_kvPromise) _kvPromise = (async () => {
      try {
        const r = await client.from('app_state').select('key,value').eq('workspace_id', ws);
        if (r.error) throw r.error;
        const map = {};
        (r.data || []).forEach(row => { map[row.key] = row.value; });
        // record the last-synced cloud snapshot for the shared data keys (merge base)
        [_DK.tasks, _DK.cats, _DK.exp].forEach(k => { if (map[k] != null) _baseSet(k, map[k]); });
        return (_kv = map);
      } catch (e) { console.warn('[SA] kv load:', e && e.message); _kvPromise = null; return null; }
    })();
    return _kvPromise;
  }
  async function _kvSet(key, blob) {
    const ws = await _getWorkspace();
    if (!ws) return;
    const { error } = await client.from('app_state').upsert(
      { workspace_id: ws, key: key, value: blob, updated_at: new Date().toISOString() },
      { onConflict: 'workspace_id,key' });
    if (error) throw error;
    if (_kv) _kv[key] = blob;
  }

  // ===== 3-way merge: Kiko + the app (and other devices) can't overwrite each other =====
  // Shared data keys that multiple writers touch. For these, every save MERGES with the
  // freshest cloud copy using a "base" snapshot (last value we synced) so that: adds from
  // either side are kept, real deletes propagate, and an empty/failed load can't wipe data.
  const _DK = { tasks: 'bd-e5', cats: 'bd-c5', exp: 'bd-exp5' };
  const _isData = (k) => k === _DK.tasks || k === _DK.cats || k === _DK.exp;
  const _baseGet = (k) => { try { const v = localStorage.getItem('bd-base-' + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
  const _baseSet = (k, v) => { try { localStorage.setItem('bd-base-' + k, JSON.stringify(v)); } catch (e) {} };
  function _mergeArr(base, ours, theirs) {
    base = Array.isArray(base) ? base : []; ours = Array.isArray(ours) ? ours : []; theirs = Array.isArray(theirs) ? theirs : [];
    if (ours.length === 0 && theirs.length > 0) return theirs.slice(); // anti-wipe: never let empty erase a full cloud
    const ourIds = new Set(ours.map(x => x && x.id)), baseIds = new Set(base.map(x => x && x.id));
    const out = ours.slice();
    for (const t of theirs) if (t && t.id != null && !ourIds.has(t.id) && !baseIds.has(t.id)) out.push(t); // external add → keep
    return out;
  }
  function _mergeObj(base, ours, theirs) { // budgets {category: amount}
    base = base || {}; ours = ours || {}; theirs = theirs || {};
    const out = Object.assign({}, theirs, ours);
    for (const k of Object.keys(base)) if (!(k in ours)) delete out[k]; // honor deletes
    return out;
  }
  const _flatTasks = (o) => { const out = []; if (o && typeof o === 'object') for (const c of Object.keys(o)) (Array.isArray(o[c]) ? o[c] : []).forEach(t => { if (t && t.id != null) out.push(Object.assign({}, t, { category: t.category || c })); }); return out; };
  function _mergeExp(base, ours, theirs) {
    base = base || {}; ours = ours || {}; theirs = theirs || {};
    return {
      expenses: _mergeArr(base.expenses, ours.expenses, theirs.expenses),
      income: _mergeArr(base.income, ours.income, theirs.income),
      streams: _mergeArr(base.streams, ours.streams, theirs.streams),
      budgets: _mergeObj(base.budgets, ours.budgets, theirs.budgets),
    };
  }
  function _mergeEntries(base, ours, theirs) {
    const merged = _mergeArr(_flatTasks(base), _flatTasks(ours), _flatTasks(theirs));
    const g = {}; merged.forEach(t => { const c = t.category || 'todo'; (g[c] = g[c] || []).push(t); });
    if (ours && typeof ours === 'object') for (const c of Object.keys(ours)) if (!(c in g)) g[c] = []; // keep empty columns
    return g;
  }
  function _mergeBlob(key, ours, theirs) {
    const base = _baseGet(key);
    if (key === _DK.exp) return _mergeExp(base, ours, theirs);
    if (key === _DK.tasks) return _mergeEntries(base, ours, theirs);
    if (key === _DK.cats) return _mergeArr(base, ours, theirs);
    return ours;
  }
  async function _freshCloud(key) { // value | null (no row / no ws) | undefined (read FAILED)
    const ws = await _getWorkspace(); if (!ws) return null;
    try {
      const r = await client.from('app_state').select('value').eq('workspace_id', ws).eq('key', key).limit(1);
      if (r.error) throw r.error;
      return (r.data && r.data.length) ? r.data[0].value : null;
    } catch (e) { console.warn('[SA] fresh read', key, e && e.message); return undefined; }
  }

  window.storage = {
    get: async function (key) {
      try { const kv = await _loadKV(); if (kv && kv[key] != null) return { value: JSON.stringify(kv[key]) }; }
      catch (e) { console.warn('[SA] get failed for', key, e && e.message); }
      return null; // -> pe() falls back to localStorage
    },
    set: async function (key, jsonStr) {
      let blob; try { blob = JSON.parse(jsonStr); } catch (e) { return; }
      if (_isData(key)) {
        const theirs = await _freshCloud(key);
        if (theirs === undefined) { console.warn('[SA] cloud read failed; skipping cloud write for', key); return; } // never clobber on a failed read
        blob = _mergeBlob(key, blob, theirs); // 3-way merge: keep both sides' adds, honor deletes
        _baseSet(key, blob);
      }
      try { await _kvSet(key, blob); } catch (e) { console.warn('[SA] kv set failed for', key, e && e.message); }
      try { await _mirror(key, blob); } catch (e) { console.warn('[SA] mirror failed for', key, e && e.message); }
    }
  };

  let _migrated = false;
  async function _migrateOnce() {
    const ws = await _getWorkspace();
    if (!ws) return;
    // one-time relational mirror seed (v2 adds chat/docs/notifs projection)
    if (!_migrated && !localStorage.getItem('bd-mirror-v2')) {
      _migrated = true;
      for (const k of [_V.entries, _V.cats, _V.tags, _V.expenses, _V.dark, _V.dinstr, _V.winstr, _V.chat, _V.docs, _V.notifs]) {
        try { const v = localStorage.getItem(k); if (v != null) await _mirror(k, JSON.parse(v)); }
        catch (e) { console.warn('[SA] migrate', k, e && e.message); }
      }
      localStorage.setItem('bd-mirror-v2', '1');
      console.log('[SA] initial cloud mirror complete');
    }
    // one-time app_state (blob) seed — pushes every local key up so other devices can read it
    if (!localStorage.getItem('bd-kv-v1')) {
      for (const k of Object.values(_V)) {
        try { const v = localStorage.getItem(k); if (v != null) await _kvSet(k, JSON.parse(v)); }
        catch (e) { console.warn('[SA] kv seed', k, e && e.message); }
      }
      localStorage.setItem('bd-kv-v1', '1');
      console.log('[SA] app_state seed complete');
    }
  }
  // one-time: remove the retired "research" board column + move its tasks to To Do
  async function _cleanupResearchOnce() {
    if (localStorage.getItem('bd-research-removed-v1')) return;
    const ws = await _getWorkspace();
    if (!ws) return;
    const kv = await _loadKV();
    const read = (k) => { if (kv && kv[k] != null) return kv[k];
      try { const v = localStorage.getItem(k); return v != null ? JSON.parse(v) : null; } catch (e) { return null; } };
    const write = async (k, val) => { const s = JSON.stringify(val);
      try { localStorage.setItem(k, s); } catch (e) {}
      try { await _kvSet(k, val); } catch (e) {}
      try { await _mirror(k, val); } catch (e) {} };
    try {
      const cats = read('bd-c5');
      if (Array.isArray(cats) && cats.some(c => c && c.id === 'research'))
        await write('bd-c5', cats.filter(c => !(c && c.id === 'research')));
      const ent = read('bd-e5');
      if (ent && typeof ent === 'object' && 'research' in ent) {
        const moved = Array.isArray(ent.research) ? ent.research.map(t => ({ ...t, category: 'todo' })) : [];
        ent.todo = [...moved, ...(Array.isArray(ent.todo) ? ent.todo : [])];
        delete ent.research;
        await write('bd-e5', ent);
      }
      localStorage.setItem('bd-research-removed-v1', '1');
      console.log('[SA] research cleanup complete');
    } catch (e) { console.warn('[SA] research cleanup:', e && e.message); }
  }
  client.auth.onAuthStateChange((_e, session) => { if (session) { _migrateOnce().then(_cleanupResearchOnce); } });

  window.SupabaseAuth = { signInWithGoogle, signOut, getSession, getStatus, onAuthStateChange, _state };
})();
