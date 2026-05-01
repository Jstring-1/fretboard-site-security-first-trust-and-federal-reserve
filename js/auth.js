/* ============================================================
   Auth widget — js/auth.js
   Top-right Clerk sign-in / signed-in badge.
   Stage 3: just identity. Stage 4 will add settings save/load.
   ============================================================ */
(function () {
  'use strict';

  // The widget's mount point is created on first render — the DOM only
  // needs an empty target div to exist. Falling back to body if absent.
  function mount() {
    var el = document.getElementById('auth_widget');
    if (!el) {
      el = document.createElement('div');
      el.id = 'auth_widget';
      document.body.appendChild(el);
    }
    return el;
  }

  // Heavily-truncated email: first 3 chars of the local part, then '…'.
  // "kjnostudio@gmail.com" -> "kjn…".  Empty string for missing emails.
  function shortEmail(email) {
    if (!email) return '';
    var local = String(email).split('@')[0] || '';
    if (local.length <= 3) return local + '…';
    return local.slice(0, 3) + '…';
  }

  function render() {
    var Clerk = window.Clerk;
    var el = mount();
    if (!Clerk || !Clerk.loaded) {
      el.innerHTML = '<div class="auth_loading">…</div>';
      return;
    }
    var user = Clerk.user;
    if (!user) {
      el.innerHTML = '<button class="auth_btn auth_signin" type="button">Sign in</button>';
      el.querySelector('.auth_signin').addEventListener('click', function () {
        Clerk.openSignIn();
      });
      return;
    }
    var email = (user.primaryEmailAddress && user.primaryEmailAddress.emailAddress) || '';
    var label = shortEmail(email) || '✓';
    el.innerHTML =
        '<div class="auth_pill">'
      +   '<button type="button" class="auth_btn auth_user" title="' + escAttr(email) + '">'
      +     escHtml(label)
      +   '</button>'
      +   '<div class="auth_menu" hidden>'
      +     '<button type="button" class="auth_menu_item" data-act="profile">Manage account</button>'
      +     '<button type="button" class="auth_menu_item" data-act="signout">Sign out</button>'
      +   '</div>'
      + '</div>';
    var pill = el.querySelector('.auth_pill');
    var menu = pill.querySelector('.auth_menu');
    pill.querySelector('.auth_user').addEventListener('click', function (e) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    menu.addEventListener('click', function (e) {
      var btn = e.target.closest('.auth_menu_item');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      menu.hidden = true;
      if (act === 'profile') Clerk.openUserProfile();
      else if (act === 'signout') Clerk.signOut();
    });
    document.addEventListener('click', function () { menu.hidden = true; }, { once: true });
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }

  // Wait for Clerk to be ready, then render and subscribe to auth changes.
  // Clerk loads async via the script tag in index.html — `await Clerk.load()`
  // is the official kick-off for vanilla JS.
  async function init() {
    var tries = 0;
    while (!window.Clerk && tries < 100) {
      await new Promise(function (r) { setTimeout(r, 50); });
      tries++;
    }
    if (!window.Clerk) {
      console.warn('[auth] Clerk JS failed to load');
      return;
    }
    try {
      await window.Clerk.load();
    } catch (e) {
      console.error('[auth] Clerk.load() failed:', e);
      return;
    }
    render();
    // Kick off settings sync — pulls cloud blob if signed in, applies
    // tab state if present, otherwise pushes local up. No-op for
    // anonymous users.
    if (window.SF_Settings && typeof window.SF_Settings.onAuthChange === 'function') {
      window.SF_Settings.onAuthChange();
    }
    if (window.Clerk.addListener) {
      window.Clerk.addListener(function () {
        render();
        if (window.SF_Settings && typeof window.SF_Settings.onAuthChange === 'function') {
          window.SF_Settings.onAuthChange();
        }
      });
    }
  }

  // Tiny helper exported for the rest of the app — Stage 4 settings
  // sync uses this to attach the bearer token to every API request.
  // Returns null when signed out so callers can decide whether to send
  // an anonymous request or skip the call entirely.
  window.SF_Auth = {
    isSignedIn: function () {
      return !!(window.Clerk && window.Clerk.loaded && window.Clerk.user);
    },
    getToken: async function () {
      if (!window.Clerk || !window.Clerk.session) return null;
      try {
        return await window.Clerk.session.getToken();
      } catch (e) {
        return null;
      }
    },
    user: function () { return (window.Clerk && window.Clerk.user) || null; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
