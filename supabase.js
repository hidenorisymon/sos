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

  window.SupabaseAuth = { signInWithGoogle, signOut, getSession, getStatus, onAuthStateChange, _state };
})();
