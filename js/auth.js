/* ============================================================
   Auth widget — js/auth.js
   Top-right Clerk sign-in / signed-in badge.
   Stage 3: just identity. Stage 4 will add settings save/load.
   ============================================================ */
(function () {
  'use strict';

  // Admin allow-list. Sign-in alone doesn't grant admin — only Clerk
  // user IDs in this list flip body[data-admin="true"], which CSS uses
  // to gate admin-only UI (e.g. the Tab editor pre-launch). Frontend
  // gating only — fine for "hide WIP UI from casual users", not for
  // protecting secret content.
  var ADMIN_USER_IDS = [
    'user_3D6pP9Gad4nTmmp5tJGq858ar77',  // kylejester@gmail.com
  ];

  function _applyAdminFlag() {
    var u = window.Clerk && window.Clerk.user;
    var isAdmin = !!(u && ADMIN_USER_IDS.indexOf(u.id) !== -1);
    if (isAdmin) document.body.setAttribute('data-admin', 'true');
    else         document.body.removeAttribute('data-admin');
    // Recompute SF_Features visibility too — admin status feeds into it.
    if (window.SF_Features && typeof window.SF_Features.applyToBody === 'function') {
      window.SF_Features.applyToBody();
    }
  }

  // Clerk Appearance config — matches the site's dark theme + cyan
  // accent so the sign-in modal and user-profile overlays don't look
  // like a foreign element. Passed both to Clerk.load() (so the
  // initial load picks it up) and to each openSignIn / openUserProfile
  // call (defensive — works even if auto-init beat us to load()).
  var APPEARANCE = {
    variables: {
      colorPrimary:                  '#5fe8e0',
      colorTextOnPrimaryBackground:  '#001014',
      colorBackground:               '#1a1a1a',
      colorText:                     '#f0f0f0',
      colorTextSecondary:            '#888',
      colorNeutral:                  '#f0f0f0',
      colorInputBackground:          '#0e0e0e',
      colorInputText:                '#f0f0f0',
      colorDanger:                   '#ef4444',
      colorSuccess:                  '#5fe8e0',
      colorWarning:                  '#fbbf24',
      borderRadius:                  '6px',
      fontFamily:                    'Optima, "Avenir Next", "Helvetica Neue", system-ui, sans-serif',
      fontSize:                      '0.95rem'
    },
    elements: {
      // Card border + shadow so it reads as a panel against the dark page.
      card:        { border: '1px solid #2e2e2e', boxShadow: '0 12px 36px rgba(0,0,0,0.7)' },
      // Drop the Clerk dev-mode footer's noisy default styling.
      footer:      { background: 'transparent' },
      // Make the "Sign up" / "Sign in" cross-link match the accent.
      footerActionLink: { color: '#5fe8e0' }
    }
  };

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
        Clerk.openSignIn({ appearance: APPEARANCE });
      });
      return;
    }
    var email = (user.primaryEmailAddress && user.primaryEmailAddress.emailAddress) || '';
    var label = shortEmail(email) || '✓';
    // Single button — clicking opens the custom account modal directly.
    // Replaces the prior dropdown menu of "Manage account / Sign out".
    el.innerHTML = '<button type="button" class="auth_btn auth_user" title="'
                 + escAttr(email) + '">' + escHtml(label) + '</button>';
    el.querySelector('.auth_user').addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openAccountModal();
    });
  }

  // ---------- custom account modal --------------------------------------
  function fmtDate(d) {
    if (!d) return '—';
    try {
      var dt = (d instanceof Date) ? d : new Date(d);
      if (isNaN(dt.getTime())) return '—';
      return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (_) { return '—'; }
  }
  function openAccountModal() {
    var modal = document.getElementById('account_modal');
    var Clerk = window.Clerk;
    var user  = Clerk && Clerk.user;
    if (!modal || !user) return;
    var email = (user.primaryEmailAddress && user.primaryEmailAddress.emailAddress) || '';
    var name  = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.username || email || 'Account';
    var $name      = modal.querySelector('[data-am-name]');
    var $email     = modal.querySelector('[data-am-email]');
    var $created   = modal.querySelector('[data-am-created]');
    var $lastsign  = modal.querySelector('[data-am-lastsignin]');
    var $avatar    = modal.querySelector('.am_avatar');
    if ($name)     $name.textContent  = name;
    if ($email)    $email.textContent = email;
    if ($created)  $created.textContent  = fmtDate(user.createdAt);
    if ($lastsign) $lastsign.textContent = fmtDate(user.lastSignInAt);
    if ($avatar) {
      $avatar.style.backgroundImage = user.imageUrl ? ('url(' + user.imageUrl + ')') : 'none';
      $avatar.textContent = user.imageUrl ? '' : (name.charAt(0) || '?').toUpperCase();
    }
    modal.hidden = false;
    if (modal._bound) return;
    modal._bound = true;
    modal.addEventListener('click', function (e) {
      if (e.target.matches('[data-am-close]')) {
        e.preventDefault();
        modal.hidden = true;
        return;
      }
      var act = e.target.getAttribute && e.target.getAttribute('data-am-act');
      if (act === 'signout') {
        modal.hidden = true;
        if (window.Clerk) window.Clerk.signOut();
      }
    });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        modal.hidden = true;
        document.removeEventListener('keydown', escHandler);
      }
    });
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
      await window.Clerk.load({ appearance: APPEARANCE });
    } catch (e) {
      console.error('[auth] Clerk.load() failed:', e);
      return;
    }
    render();
    _applyAdminFlag();
    // Kick off settings sync — pulls cloud blob if signed in, applies
    // tab state if present, otherwise pushes local up. No-op for
    // anonymous users.
    if (window.SF_Settings && typeof window.SF_Settings.onAuthChange === 'function') {
      window.SF_Settings.onAuthChange();
    }
    if (window.Clerk.addListener) {
      window.Clerk.addListener(function () {
        render();
        _applyAdminFlag();
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
    isAdmin: function () {
      var u = window.Clerk && window.Clerk.user;
      return !!(u && ADMIN_USER_IDS.indexOf(u.id) !== -1);
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
