// ─── CONFIGURATION ────────────────────────────────────────────────────────────
// Fill in your Supabase project values before loading this file.
const SUPABASE_URL = 'https://samuwgxtsgbkyybbfurf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Y4Aw_FZ1fMrlZAhYiRRiWg_HPW1kwIp';
// ──────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // Supabase UMD build exposes window.supabase after its <script> tag loads.
  if (!window.supabase) {
    console.error(
      '[SupabaseAuth] Supabase client not found. ' +
      'Load the Supabase CDN script before supabase.js.'
    );
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Internal state — read via window.SupabaseAuth._state
  const _state = {
    session: null,
    status: null,   // 'pending' | 'approved' | 'rejected' | null
    ready: false,
  };

  // ── Profiles table ──────────────────────────────────────────────────────────

  async function getStatus() {
    const { data: { session } } = await client.auth.getSession();
    if (!session) return null;

    const { data, error } = await client
      .from('profiles')
      .select('status')
      .eq('id', session.user.id)
      .single();

    if (error) {
      console.error('[SupabaseAuth] profiles lookup failed:', error.message);
      return null;
    }
    return data.status;
  }

  // ── Auth actions ────────────────────────────────────────────────────────────

  async function signInWithGoogle() {
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href },
    });
    if (error) console.error('[SupabaseAuth] signInWithGoogle failed:', error.message);
  }

  async function signOut() {
    const { error } = await client.auth.signOut();
    if (error) console.error('[SupabaseAuth] signOut failed:', error.message);
    _state.session = null;
    _state.status = null;
  }

  async function getSession() {
    const { data: { session } } = await client.auth.getSession();
    return session;
  }

  // ── Auth state listener ─────────────────────────────────────────────────────

  const _listeners = [];

  function onAuthStateChange(callback) {
    _listeners.push(callback);
    // If already ready, fire immediately with current state
    if (_state.ready) {
      callback({ event: 'INITIAL', session: _state.session, status: _state.status });
    }
  }

  function _notify(event, session, status) {
    _listeners.forEach(fn => {
      try { fn({ event, session, status }); }
      catch (e) { console.error('[SupabaseAuth] listener error:', e); }
    });
  }

  client.auth.onAuthStateChange(async (event, session) => {
    _state.session = session;
    const status = session ? await getStatus() : null;
    _state.status = status;
    _notify(event, session, status);
  });

  // ── Initialise on load ──────────────────────────────────────────────────────
  // Resolves any existing session (including after OAuth redirect).

  (async function init() {
    const session = await getSession();
    _state.session = session;
    _state.status = session ? await getStatus() : null;
    _state.ready = true;
    _notify('INITIAL', _state.session, _state.status);
  })();

  // ── Public API ──────────────────────────────────────────────────────────────

  window.SupabaseAuth = {
    signInWithGoogle,
    signOut,
    getSession,
    getStatus,
    onAuthStateChange,
    _state,
  };

  console.log('[SupabaseAuth] module loaded.');
})();
