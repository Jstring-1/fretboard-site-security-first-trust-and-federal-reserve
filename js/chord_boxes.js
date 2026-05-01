/* ============================================================
   Chord Boxes — js/chord_boxes.js
   Click-to-fill chord diagrams that live above the tab paper.
   Draws SVG boxes sized to whatever string count tab.js reports.
   tab.js owns persistence; this module is a pure UI surface that
   calls back through opts.onChange whenever the user edits a box.
   ============================================================ */
(function () {
  'use strict';

  var FRETS_PER_BOX = 5;     // frets visible per box (user pref)
  var MAX_FRET      = 24;    // baseFret upper bound

  // mount-time config (filled by mount())
  var rootEl       = null;
  var stringCount  = 6;
  var stringNotes  = [];     // top-to-bottom order, matches tab.js state.notes
  var siteKey      = '';
  var boxes        = [];
  var onChange     = null;

  // Note + degree helpers — duplicated lightly from tab.js so this module
  // stays self-contained.
  var ALLNOTES = (window.SF_DATA && window.SF_DATA.allnotes && window.SF_DATA.allnotes.length === 12)
    ? window.SF_DATA.allnotes.slice()
    : ['A','A♯','B','C','C♯','D','D♯','E','F','F♯','G','G♯'];
  var DEGREES = (window.SF_DATA && window.SF_DATA.degrees && window.SF_DATA.degrees.length === 12)
    ? window.SF_DATA.degrees.slice()
    : ['1','♭2','2','♭3','3','4','♭5','5','♭6','6','♭7','7'];

  function _canonNote(s) {
    if (!s) return null;
    var v = String(s).trim()
      .replace(/^([a-g])/, function (m) { return m.toUpperCase(); })
      .replace(/#/g, '♯')
      .replace(/([A-G])b\b/g, '$1♭')
      .replace(/([A-G])b$/, '$1♭');
    var FLAT_TO_SHARP = {
      'A♭': 'G♯', 'B♭': 'A♯', 'C♭': 'B', 'D♭': 'C♯',
      'E♭': 'D♯', 'F♭': 'E', 'G♭': 'F♯'
    };
    if (FLAT_TO_SHARP[v]) v = FLAT_TO_SHARP[v];
    return ALLNOTES.indexOf(v) === -1 ? null : v;
  }
  function _noteAtFret(openNote, fret) {
    var idx = ALLNOTES.indexOf(openNote);
    if (idx < 0 || fret < 0) return '';
    return ALLNOTES[(idx + fret + 12 * 100) % 12];
  }
  function _degreeForNote(note, key) {
    if (!key || !note) return '';
    var ki = ALLNOTES.indexOf(key);
    var ni = ALLNOTES.indexOf(note);
    if (ki < 0 || ni < 0) return '';
    return DEGREES[(ni - ki + 12) % 12];
  }

  function _emit() {
    if (typeof onChange === 'function') onChange(boxes);
  }

  function _newBox() {
    // length matches current string count; fingers[i] is null until clicked
    var fingers = [];
    for (var i = 0; i < stringCount; i++) fingers.push(null);
    return { name: '', baseFret: 1, fingers: fingers };
  }

  // String count can change (tab.js Strings dropdown). Pad / truncate
  // every box's fingers so renders never crash on stale data.
  function _normaliseBoxes() {
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (!b.fingers) b.fingers = [];
      while (b.fingers.length < stringCount) b.fingers.push(null);
      if (b.fingers.length > stringCount) b.fingers.length = stringCount;
      if (typeof b.baseFret !== 'number' || b.baseFret < 1) b.baseFret = 1;
      if (b.baseFret > MAX_FRET) b.baseFret = MAX_FRET;
      if (typeof b.name !== 'string') b.name = '';
    }
  }

  // ---- Render --------------------------------------------------------------
  function render() {
    if (!rootEl) return;
    _normaliseBoxes();
    var html = '';
    for (var i = 0; i < boxes.length; i++) {
      html += _renderBox(boxes[i], i);
    }
    if (!boxes.length) {
      html = '<div class="cb_empty">No chord boxes yet — click <strong>+ Add box</strong> to create one.</div>';
    }
    rootEl.innerHTML = html;
    _wireBoxes();
  }

  function _renderBox(box, idx) {
    var n = stringCount;
    var STRING_GAP = 16;             // px between strings
    var FRET_GAP   = 18;             // px between frets
    var PAD_L      = 22;             // left pad (baseFret label sits here)
    var PAD_R      = 14;
    var PAD_TOP    = 22;             // top pad (header markers)
    var PAD_BOT    = 12;
    var boxW       = (n - 1) * STRING_GAP;
    var boxH       = FRETS_PER_BOX * FRET_GAP;
    var W          = PAD_L + boxW + PAD_R;
    var H          = PAD_TOP + boxH + PAD_BOT;
    var nut        = (box.baseFret === 1);

    var svg = '<svg class="cb_svg" viewBox="0 0 ' + W + ' ' + H + '" '
            + 'preserveAspectRatio="xMidYMid meet" data-box="' + idx + '">';

    // ----- nut / first fret line -----
    var topY = PAD_TOP;
    if (nut) {
      svg += '<rect class="cb_nut" x="' + PAD_L + '" y="' + (topY - 2)
           + '" width="' + boxW + '" height="3"></rect>';
    } else {
      svg += '<line class="cb_fret" x1="' + PAD_L + '" y1="' + topY
           + '" x2="' + (PAD_L + boxW) + '" y2="' + topY + '"></line>';
      // base-fret label next to the top-right of the box
      svg += '<text class="cb_basefret" x="' + (PAD_L - 4) + '" y="' + (topY + 12)
           + '" text-anchor="end">' + box.baseFret + 'fr</text>';
    }
    // ----- horizontal frets -----
    for (var f = 1; f <= FRETS_PER_BOX; f++) {
      var y = topY + f * FRET_GAP;
      svg += '<line class="cb_fret" x1="' + PAD_L + '" y1="' + y
           + '" x2="' + (PAD_L + boxW) + '" y2="' + y + '"></line>';
    }
    // ----- vertical strings -----
    for (var s = 0; s < n; s++) {
      var x = PAD_L + s * STRING_GAP;
      svg += '<line class="cb_string" x1="' + x + '" y1="' + topY
           + '" x2="' + x + '" y2="' + (topY + boxH) + '"></line>';
    }

    // ----- per-string header markers (× / ○) and dots -----
    for (var s2 = 0; s2 < n; s2++) {
      var sx = PAD_L + s2 * STRING_GAP;
      var fing = box.fingers[s2];

      // Header marker glyph (rendered AFTER the click target so it's on top)
      var headerY = topY - 6;
      if (fing === 'x') {
        svg += '<text class="cb_x" x="' + sx + '" y="' + headerY
             + '" text-anchor="middle">×</text>';
      } else if (fing === 0 || fing === 'o') {
        svg += '<circle class="cb_o" cx="' + sx + '" cy="' + (headerY - 4)
             + '" r="4"></circle>';
      }

      // Header click target (cycles null → o → x → null)
      svg += '<rect class="cb_hit_header" x="' + (sx - STRING_GAP / 2)
           + '" y="0" width="' + STRING_GAP + '" height="' + PAD_TOP
           + '" data-string="' + s2 + '" data-fret="header"></rect>';

      // Dot if fingered within the visible window
      if (typeof fing === 'number' && fing > 0) {
        var rel = fing - box.baseFret + 1;       // 1..FRETS_PER_BOX
        if (rel >= 1 && rel <= FRETS_PER_BOX) {
          var dy = topY + (rel - 0.5) * FRET_GAP;
          svg += '<circle class="cb_dot" cx="' + sx + '" cy="' + dy + '" r="6"></circle>';
        } else {
          // Out of view — show small "↑" or "↓" hint above/below box
          var arrow = (rel < 1) ? '↑' : '↓';
          var ay = (rel < 1) ? (topY - 6) : (topY + boxH + 10);
          svg += '<text class="cb_outofview" x="' + sx + '" y="' + ay
               + '" text-anchor="middle">' + arrow + '</text>';
        }
      }

      // Fret hit targets — one per fret per string
      for (var f2 = 1; f2 <= FRETS_PER_BOX; f2++) {
        var hy = topY + (f2 - 1) * FRET_GAP;
        var absFret = box.baseFret + f2 - 1;
        svg += '<rect class="cb_hit_fret" x="' + (sx - STRING_GAP / 2)
             + '" y="' + hy + '" width="' + STRING_GAP
             + '" height="' + FRET_GAP + '" data-string="' + s2
             + '" data-fret="' + absFret + '"></rect>';
      }
    }

    svg += '</svg>';

    // Notes / degrees readout below the SVG (helpful while building)
    var readout = '';
    for (var s3 = 0; s3 < n; s3++) {
      var fing2 = box.fingers[s3];
      var openN = _canonNote(stringNotes[s3]);
      var cell = '';
      if (fing2 === 'x') cell = '<span class="cb_ro_x">×</span>';
      else if (fing2 === 0 || fing2 === 'o') {
        var nO = openN || '';
        cell = '<span class="cb_ro_note">' + nO + '</span>';
        if (siteKey && nO) {
          cell += '<span class="cb_ro_deg">' + _degreeForNote(nO, siteKey) + '</span>';
        }
      } else if (typeof fing2 === 'number' && fing2 > 0) {
        var nN = openN ? _noteAtFret(openN, fing2) : '';
        cell = '<span class="cb_ro_note">' + nN + '</span>';
        if (siteKey && nN) {
          cell += '<span class="cb_ro_deg">' + _degreeForNote(nN, siteKey) + '</span>';
        }
      } else {
        cell = '<span class="cb_ro_blank">·</span>';
      }
      readout += '<div class="cb_ro_cell">' + cell + '</div>';
    }

    return ''
      + '<div class="cb_box" data-box="' + idx + '">'
      +   '<div class="cb_box_top">'
      +     '<input class="cb_name" type="text" maxlength="20" placeholder="Chord name"'
      +       ' value="' + _escAttr(box.name || '') + '" data-box="' + idx + '">'
      +     '<div class="cb_basefret_ctl" title="Base fret (top of box)">'
      +       '<button type="button" class="cb_fret_dn" data-box="' + idx + '" aria-label="Lower base fret">−</button>'
      +       '<span class="cb_fret_val">' + box.baseFret + '</span>'
      +       '<button type="button" class="cb_fret_up" data-box="' + idx + '" aria-label="Raise base fret">+</button>'
      +     '</div>'
      +     '<button type="button" class="cb_remove" data-box="' + idx + '" title="Delete this box">×</button>'
      +   '</div>'
      +   svg
      +   '<div class="cb_readout">' + readout + '</div>'
      + '</div>';
  }

  function _escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function _escAttr(s) { return _escHtml(s).replace(/"/g, '&quot;'); }

  // ---- Wiring --------------------------------------------------------------
  function _wireBoxes() {
    rootEl.querySelectorAll('input.cb_name').forEach(function (inp) {
      inp.addEventListener('input', _onName);
    });
    rootEl.querySelectorAll('.cb_remove').forEach(function (b) {
      b.addEventListener('click', _onRemove);
    });
    rootEl.querySelectorAll('.cb_fret_up').forEach(function (b) {
      b.addEventListener('click', function (e) { _bumpFret(+e.currentTarget.getAttribute('data-box'), 1); });
    });
    rootEl.querySelectorAll('.cb_fret_dn').forEach(function (b) {
      b.addEventListener('click', function (e) { _bumpFret(+e.currentTarget.getAttribute('data-box'), -1); });
    });
    rootEl.querySelectorAll('rect.cb_hit_header').forEach(function (r) {
      r.addEventListener('click', _onHeaderClick);
    });
    rootEl.querySelectorAll('rect.cb_hit_fret').forEach(function (r) {
      r.addEventListener('click', _onFretClick);
    });
  }

  function _onName(e) {
    var idx = +e.currentTarget.getAttribute('data-box');
    if (!boxes[idx]) return;
    boxes[idx].name = e.currentTarget.value;
    _emit();
  }
  function _onRemove(e) {
    var idx = +e.currentTarget.getAttribute('data-box');
    if (idx < 0 || idx >= boxes.length) return;
    if (!confirm('Delete this chord box?')) return;
    boxes.splice(idx, 1);
    render();
    _emit();
  }
  function _bumpFret(idx, delta) {
    if (!boxes[idx]) return;
    var nf = boxes[idx].baseFret + delta;
    if (nf < 1) nf = 1;
    if (nf > MAX_FRET) nf = MAX_FRET;
    var actualDelta = nf - boxes[idx].baseFret;
    if (actualDelta !== 0) {
      // Slide fretted dots with the box so the chord SHAPE moves up/down
      // the neck rather than the box "panning over" pinned dots. Open
      // ('o' / 0) and muted ('x') markers stay as-is — those aren't
      // fret numbers, they're string-state flags.
      var fingers = boxes[idx].fingers;
      for (var i = 0; i < fingers.length; i++) {
        var f = fingers[i];
        if (typeof f === 'number' && f > 0) {
          var nfDot = f + actualDelta;
          // Drop dots that would slide below the nut — they don't make
          // sense on a fretted instrument. Mark as open if delta drove
          // the dot to fret 0 exactly so a user dialling DOWN doesn't
          // silently lose the string.
          if (nfDot < 1) fingers[i] = 'o';
          else            fingers[i] = nfDot;
        }
      }
    }
    boxes[idx].baseFret = nf;
    render();
    _emit();
  }
  function _onHeaderClick(e) {
    var svg = e.currentTarget.closest('svg');
    if (!svg) return;
    var idx = +svg.getAttribute('data-box');
    var s   = +e.currentTarget.getAttribute('data-string');
    if (!boxes[idx]) return;
    var cur = boxes[idx].fingers[s];
    // null → 'o' → 'x' → null
    var nxt;
    if (cur === 'o' || cur === 0)      nxt = 'x';
    else if (cur === 'x')              nxt = null;
    else                                nxt = 'o';
    boxes[idx].fingers[s] = nxt;
    render();
    _emit();
  }
  function _onFretClick(e) {
    var svg = e.currentTarget.closest('svg');
    if (!svg) return;
    var idx = +svg.getAttribute('data-box');
    var s   = +e.currentTarget.getAttribute('data-string');
    var f   = +e.currentTarget.getAttribute('data-fret');
    if (!boxes[idx]) return;
    var cur = boxes[idx].fingers[s];
    // Click same fret → clear; otherwise set to that fret
    if (typeof cur === 'number' && cur === f) boxes[idx].fingers[s] = null;
    else                                       boxes[idx].fingers[s] = f;
    render();
    _emit();
  }

  // ---- Public API ----------------------------------------------------------
  function mount(opts) {
    rootEl      = opts.mount || null;
    stringCount = opts.stringCount || 6;
    stringNotes = opts.stringNotes || [];
    siteKey     = opts.siteKey || '';
    boxes       = (opts.initial && Array.isArray(opts.initial)) ? opts.initial.slice() : [];
    onChange    = opts.onChange || null;
    _normaliseBoxes();
    render();
  }
  function setStringConfig(n, notes) {
    stringCount = n;
    stringNotes = notes || [];
    _normaliseBoxes();
    render();
  }
  function setSiteKey(k) {
    siteKey = k || '';
    render();
  }
  function getBoxes() { return boxes; }
  function setBoxes(arr) {
    boxes = (arr && Array.isArray(arr)) ? arr.slice() : [];
    _normaliseBoxes();
    render();
  }
  function addBox() {
    boxes.push(_newBox());
    render();
    _emit();
  }
  function clearAll() {
    if (!boxes.length) return;
    if (!confirm('Delete all chord boxes?')) return;
    boxes = [];
    render();
    _emit();
  }

  window.SF_ChordBoxes = {
    mount:            mount,
    setStringConfig:  setStringConfig,
    setSiteKey:       setSiteKey,
    getBoxes:         getBoxes,
    setBoxes:         setBoxes,
    addBox:           addBox,
    clearAll:         clearAll,
    render:           render
  };
})();
