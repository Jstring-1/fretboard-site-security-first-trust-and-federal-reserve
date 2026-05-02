/* ============================================================
   Feature flags — js/features.js

   Lightweight switchboard for staged rollouts: each named feature
   has one of three stages, edited in this file:

     'admin'   visible only to Clerk users in SF_Auth.isAdmin()
     'public'  visible to everyone (signed in or not)
     'hidden'  visible to nobody — fully off

   To flip a feature live, change its value below and ship. The DOM
   gets a `body[data-features="…"]` attribute listing every visible
   feature name, separated by spaces, so CSS can use the standard
   `[data-features~="X"]` selector to gate elements:

     .feature_X                              { display: none; }
     body[data-features~="X"] .feature_X     { display: block; }

   Mark gated DOM nodes with class="feature_<name>".

   This module reads SF_Auth.isAdmin() each time applyToBody() runs,
   so auth.js calls it whenever the Clerk auth state changes — and
   on initial load in case admin status was already known.
   ============================================================ */
(function () {
  'use strict';

  // The single source of truth. Edit values to flip rollouts.
  var FLAGS = {
    'tab':         'admin',  // Tab editor
    'sheetmusic':  'admin',  // Sheet music / chord-progression viewer (WIP)
  };

  function isAdminUser() {
    return !!(window.SF_Auth && typeof window.SF_Auth.isAdmin === 'function'
              && window.SF_Auth.isAdmin());
  }

  function isVisible(feature) {
    var stage = FLAGS[feature];
    if (stage == null || stage === 'public') return true;
    if (stage === 'hidden') return false;
    if (stage === 'admin') return isAdminUser();
    return false;
  }

  function applyToBody() {
    if (!document.body) return;
    var on = [];
    for (var f in FLAGS) {
      if (Object.prototype.hasOwnProperty.call(FLAGS, f) && isVisible(f)) on.push(f);
    }
    if (on.length) document.body.setAttribute('data-features', on.join(' '));
    else           document.body.removeAttribute('data-features');
  }

  window.SF_Features = {
    isVisible:    isVisible,
    applyToBody:  applyToBody,
    flags:        FLAGS,
  };

  // First pass — admin status may not yet be known (Clerk hasn't loaded).
  // auth.js will call applyToBody() again on each auth-state change.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyToBody);
  } else {
    applyToBody();
  }
})();
