/* ============================================================
   Settings sync — js/settings_sync.js
   Cloud-syncs user settings (tab state, chord boxes) when signed in.
   Anonymous users continue to use localStorage as before — this
   module is a no-op for them.
   ============================================================ */
(function () {
  'use strict';

  // In-memory mirror of the server's data blob. Populated after pull,
  // mutated by queue() before the debounced PUT lands. Reads (get(key))
  // come from this so callers don't have to await network round-trips.
  var cached = null;
  var pendingTimer = null;
  var DEBOUNCE_MS = 800;
  var lastPushedJson = '';   // dedupe — skip PUT if the payload didn't change
  var pulled = false;        // have we successfully pulled at least once?

  function _signedIn() {
    return !!(window.SF_Auth && window.SF_Auth.isSignedIn());
  }

  async function _authHeader() {
    if (!window.SF_Auth) return null;
    var tok = await window.SF_Auth.getToken();
    return tok ? { Authorization: 'Bearer ' + tok } : null;
  }

  // Pull the server's blob into `cached`. On success returns the data
  // object (possibly empty {}); returns null if signed out / network
  // fail. Idempotent — safe to call many times.
  async function pull() {
    if (!_signedIn()) return null;
    var hdr = await _authHeader();
    if (!hdr) return null;
    try {
      var r = await fetch('/api/settings', { headers: hdr });
      if (!r.ok) {
        console.warn('[settings] pull failed:', r.status);
        return null;
      }
      var j = await r.json();
      cached = (j && j.data) || {};
      pulled = true;
      lastPushedJson = JSON.stringify(cached);
      return cached;
    } catch (e) {
      console.warn('[settings] pull error:', e);
      return null;
    }
  }

  // Push the current cached blob to the server. Skips if the JSON is
  // identical to the last successful push (dedupe — saves writes).
  async function _flush() {
    pendingTimer = null;
    if (!_signedIn() || !cached) return;
    var json = JSON.stringify(cached);
    if (json === lastPushedJson) return;
    var hdr = await _authHeader();
    if (!hdr) return;
    hdr['Content-Type'] = 'application/json';
    try {
      var r = await fetch('/api/settings', {
        method: 'PUT',
        headers: hdr,
        body: JSON.stringify({ data: cached }),
      });
      if (r.ok) lastPushedJson = json;
      else console.warn('[settings] push failed:', r.status);
    } catch (e) {
      console.warn('[settings] push error:', e);
    }
  }

  // Public — called by tab.js (and any future sync producer). Mutates
  // the cached blob's `key` to `value`, then debounces a PUT. If the
  // user is signed out we still mirror to `cached` so a later sign-in
  // can decide whether to push or pull.
  function queue(key, value) {
    if (!cached) cached = {};
    cached[key] = value;
    if (!_signedIn()) return;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(_flush, DEBOUNCE_MS);
  }

  function get(key) {
    if (!cached) return null;
    return Object.prototype.hasOwnProperty.call(cached, key) ? cached[key] : null;
  }

  // Auth state change — fired by auth.js whenever Clerk emits a change.
  // On sign-in we pull. If the server has tab data, apply it to the
  // running tab editor. If the server is empty, push the user's local
  // state up so the next device finds it.
  async function onAuthChange() {
    if (_signedIn()) {
      var data = await pull();
      if (!data) return;
      var serverTab = data.tab;
      if (serverTab && Object.keys(serverTab).length > 0
          && window.SF_Tab && typeof window.SF_Tab.applyState === 'function') {
        window.SF_Tab.applyState(serverTab);
      } else if (window.SF_Tab && typeof window.SF_Tab.serialise === 'function') {
        // Server is empty for this user — push our local state up so
        // we don't lose the anonymous work after sign-in.
        var local = window.SF_Tab.serialise();
        if (local) {
          cached.tab = local;
          await _flush();
        }
      }
    } else {
      // Signed out — clear cache so the next sign-in pulls fresh.
      cached = null;
      pulled = false;
      lastPushedJson = '';
    }
  }

  window.SF_Settings = {
    pull:          pull,
    queue:         queue,
    get:           get,
    onAuthChange:  onAuthChange,
    isPulled:      function () { return pulled; },
    isSignedIn:    _signedIn,
  };
})();
