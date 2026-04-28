/* ============================================================
   Tab Editor (test page) — js/tab.js
   Vanilla JS, no build step. Reads window.SF_DATA.tunings.
   State is autosaved to localStorage and shareable via URL.
   ============================================================ */
(function () {
  'use strict';

  var DATA = window.SF_DATA || {};
  var TUNINGS = DATA.tunings || {};

  // ---- DOM refs ------------------------------------------------------------
  // Captured inside init() — when this IIFE runs in <head>, the body hasn't
  // parsed yet so document.getElementById returns null for everything.
  var $ = function (id) { return document.getElementById(id); };
  var ctlTitle, ctlStrings, ctlTuning, ctlMeasures, ctlBeats, ctlSubdiv,
      ctlPerLine, grid, paper, titlePrint, subPrint, btnClear, btnFlip,
      tabRoot, btnPrint, btnPrintBl, btnShare;

  function captureDom() {
    ctlTitle    = $('ctl_title');
    ctlStrings  = $('ctl_strings');
    ctlTuning   = $('ctl_tuning');
    ctlMeasures = $('ctl_measures');
    ctlBeats    = $('ctl_beats');
    ctlSubdiv   = $('ctl_subdiv');
    ctlPerLine  = $('ctl_per_line');
    grid        = $('tab_grid');
    paper       = $('tab_paper');
    titlePrint  = $('tab_title_print');
    subPrint    = $('tab_subtitle_print');
    btnClear    = $('btn_clear');
    btnFlip     = $('btn_low_high');
    // Scope to #tab_section_root so we don't clash with main-site buttons.
    tabRoot     = $('tab_section_root');
    btnPrint    = tabRoot && tabRoot.querySelector('.btn_print');
    btnPrintBl  = tabRoot && tabRoot.querySelector('.btn_print_blank');
    btnShare    = tabRoot && tabRoot.querySelector('.btn_share');
  }

  // ---- State ---------------------------------------------------------------
  var state = {
    title:   'Untitled',
    strings: 8,
    tuning:  '',          // tuning key (lookup in TUNINGS) or '' = custom
    notes:   [],          // array of strings, ordered "high to low" for the grid
    measures: 8,
    beats:    4,
    subdiv:   2,
    perLine:  4,
    flipped:  false,      // false = top row is highest pitch (standard)
    cells:    {}          // sparse: "row_col" -> "12h"
  };

  // ---- Tuning helpers ------------------------------------------------------
  // Uses loose-equality on `strs` so the filter works whether data.js stores
  // it as a number or string. Returns every matching preset, sorted by name
  // then by notes string for stable ordering.
  function tuningsForStringCount(n) {
    var nNum = +n;
    var out = [];
    for (var key in TUNINGS) {
      if (TUNINGS[key] && +TUNINGS[key].strs === nNum) {
        out.push({
          key:   key,
          name:  TUNINGS[key].name  || '',
          notes: TUNINGS[key].notes || '',
          info:  TUNINGS[key].info  || ''
        });
      }
    }
    out.sort(function (a, b) {
      if (a.name === b.name) return a.notes.localeCompare(b.notes);
      return a.name.localeCompare(b.name);
    });
    return out;
  }

  function populateTuningSelect() {
    var n = state.strings;
    var list = tuningsForStringCount(n);
    var html = '<option value="">(custom — write your own)</option>';
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      var label = t.name + ' — ' + t.notes + (t.info ? '  (' + t.info + ')' : '');
      html += '<option value="' + escAttr(t.key) + '">' + escHtml(label) + '</option>';
    }
    ctlTuning.innerHTML = html;
    if (state.tuning && (!TUNINGS[state.tuning] || +TUNINGS[state.tuning].strs !== +n)) {
      state.tuning = '';
    }
    ctlTuning.value = state.tuning;
    syncStateNotesFromTuning();
  }

  function syncStateNotesFromTuning() {
    var n = state.strings;
    if (state.tuning && TUNINGS[state.tuning]) {
      // Tunings in data.js list strings low->high in `notes` (left side = string 1, low).
      // For tab convention we put the highest pitch on top, so reverse.
      var arr = TUNINGS[state.tuning].notes.split(/\s+/).slice(0, n);
      arr.reverse();
      state.notes = arr;
    } else {
      // custom — keep whatever the user has, padded/truncated to n
      var cur = (state.notes || []).slice(0, n);
      while (cur.length < n) cur.push('');
      state.notes = cur;
    }
    if (state.flipped) state.notes.reverse();
  }

  // ---- HTML escapers -------------------------------------------------------
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escAttr(s) {
    return escHtml(s).replace(/"/g, '&quot;');
  }

  // ---- Rendering -----------------------------------------------------------
  function render() {
    titlePrint.textContent = state.title || '';
    var tuning = state.tuning && TUNINGS[state.tuning];
    subPrint.textContent = tuning
      ? (tuning.name + '  —  ' + tuning.notes + '   (' + state.strings + ' string)')
      : (state.strings + ' string');

    var beatsPerMeasure = state.beats;
    var subdiv = state.subdiv;
    var cellsPerMeasure = beatsPerMeasure * subdiv;
    var measures = state.measures;
    var perLine = state.perLine;
    var systems = Math.ceil(measures / perLine);

    var html = '';
    var cellIdx = 0;
    for (var s = 0; s < systems; s++) {
      var firstMeasure = s * perLine;
      var lastMeasure  = Math.min(firstMeasure + perLine, measures);
      var measuresThisSystem = lastMeasure - firstMeasure;
      var totalCells = measuresThisSystem * cellsPerMeasure;
      var cellsTemplate = 'repeat(' + totalCells + ', minmax(18px, 1fr))';
      // Outer row: just label-column + everything-else-column. The inner
      // .tab_cells grid then fans the cells across the full 1fr space.
      // (Earlier this used the full cellsTemplate at the outer level which
      // gave us 33 grid slots but only 2 children — so 31 of them ended up
      // empty and the right half of every system rendered as bare lines.)
      var rowTemplate   = '36px 1fr';
      var measureGridTemplate = 'repeat(' + measuresThisSystem + ', 1fr)';

      html += '<div class="tab_system">';

      // measure numbers row
      html += '<div class="tab_measure_numbers" style="grid-template-columns: ' + rowTemplate + ';">';
      html += '<div></div><div class="nums" style="grid-template-columns: ' + measureGridTemplate + '; display: grid;">';
      for (var m = 0; m < measuresThisSystem; m++) {
        html += '<div class="num">' + (firstMeasure + m + 1) + '</div>';
      }
      html += '</div></div>';

      // string rows
      for (var r = 0; r < state.strings; r++) {
        var label = state.notes[r] || '';
        var rowExtra = (r === 0 ? ' tab_row_first' : '') +
                       (r === state.strings - 1 ? ' tab_row_last' : '');
        html += '<div class="tab_row' + rowExtra + '" style="grid-template-columns: ' + rowTemplate + ';">';
        // Staff line — a real DOM element so it renders as a foreground
        // stroke (border) that prints regardless of the browser's
        // "background graphics" setting. Positioned absolutely at the
        // row's vertical centre, spanning from the label column to the
        // right edge.
        html += '<div class="staff_line" aria-hidden="true"></div>';
        // Editable string label — lets users write a tuning we don't have a
        // preset for. Preset selection prefills these; manual edits override.
        html += '<input class="tab_label tab_label_input" type="text" maxlength="3" '
              + 'data-r="' + r + '" value="' + escAttr(label) + '" '
              + 'placeholder="—" autocomplete="off" spellcheck="false">';
        html += '<div class="tab_cells" style="grid-template-columns: ' + cellsTemplate + ';">';
        for (var c = 0; c < totalCells; c++) {
          var globalCol = firstMeasure * cellsPerMeasure + c;
          var key = r + '_' + globalCol;
          var val = state.cells[key] || '';
          var isBar = (c % cellsPerMeasure === 0 && c !== 0);
          html += '<div class="tab_cell' + (isBar ? ' barline' : '') + '">';
          // The single-space placeholder is what makes :placeholder-shown match
          // when the input is empty — that's how the CSS keeps the staff line
          // visible behind unfilled cells. Don't drop it.
          html += '<input type="text" maxlength="3" data-r="' + r + '" data-c="' + globalCol
                + '" value="' + escAttr(val) + '" placeholder=" " autocomplete="off" spellcheck="false">';
          html += '</div>';
        }
        html += '</div></div>';
        cellIdx++;
      }

      html += '</div>';
    }
    grid.innerHTML = html;

    // wire input handlers (delegated)
    grid.querySelectorAll('input.tab_label_input').forEach(function (inp) {
      inp.addEventListener('input', onLabelInput);
      inp.addEventListener('keydown', onLabelKey);
    });
    grid.querySelectorAll('input:not(.tab_label_input)').forEach(function (inp) {
      inp.addEventListener('input', onCellInput);
      inp.addEventListener('keydown', onCellKey);
    });
  }

  // The 12 chromatic notes, used by the arrow-cycle on tuning-label inputs.
  var ALLNOTES = (DATA.allnotes && DATA.allnotes.length === 12)
    ? DATA.allnotes.slice()
    : ['A','A♯','B','C','C♯','D','D♯','E','F','F♯','G','G♯'];

  // Normalise whatever a user has typed into an exact ALLNOTES entry, or
  // return null if it's not a real note. Accepts ascii (#, b) and unicode
  // (♯, ♭) accidentals interchangeably.
  function _canonNote(s) {
    if (!s) return null;
    var v = String(s).trim()
      .replace(/^([a-g])/, function (m) { return m.toUpperCase(); })
      .replace(/#/g, '♯')
      .replace(/([A-G])b\b/g, '$1♭')
      .replace(/([A-G])b$/, '$1♭');
    // Convert flats to enharmonic sharps so we land on an ALLNOTES key
    var FLAT_TO_SHARP = {
      'A♭': 'G♯', 'B♭': 'A♯', 'C♭': 'B', 'D♭': 'C♯', 'E♭': 'D♯', 'F♭': 'E', 'G♭': 'F♯'
    };
    if (FLAT_TO_SHARP[v]) v = FLAT_TO_SHARP[v];
    return ALLNOTES.indexOf(v) === -1 ? null : v;
  }

  // Up / Down on a tuning-label input moves focus to the prev / next string's
  // label so users can chord through the column quickly. Left / Right defer
  // to the browser so the user can position the caret normally; Enter focuses
  // the first cell on the same row.
  function onLabelKey(e) {
    var inp = e.target;
    var r = +inp.getAttribute('data-r');
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      var dir = (e.key === 'ArrowUp') ? -1 : 1;
      var next = grid.querySelector('input.tab_label_input[data-r="' + (r + dir) + '"]');
      if (next) {
        e.preventDefault();
        next.focus();
        next.select();
      }
    } else if (e.key === 'Enter') {
      // Enter from the label drops into the first cell on this string row.
      var firstCell = grid.querySelector('input[data-r="' + r + '"][data-c="0"]');
      if (firstCell) {
        e.preventDefault();
        firstCell.focus();
        firstCell.select();
      }
    }
  }

  // Editable string-label input. Supports plain notes (A, F#, Bb, C♯, D♭).
  // We normalise # → ♯ and b (after a letter) → ♭ for the on-screen label,
  // and keep state.notes in sync so the share URL captures custom tunings.
  function onLabelInput(e) {
    var inp = e.target;
    var r = +inp.getAttribute('data-r');
    var raw = inp.value;
    // Normalise ascii accidentals to unicode glyphs once the user has typed
    // the full token. This is a soft normalisation — we only swap when the
    // input ends in '#' or a letter+b, so an in-progress 'B' isn't eaten.
    var v = raw
      .replace(/#/g, '♯')
      .replace(/([A-Ga-g])b\b/g, '$1♭')
      .replace(/([A-Ga-g])b$/, '$1♭');
    if (v !== raw) inp.value = v;
    state.notes[r] = v;
    saveLocal();
  }

  function onCellInput(e) {
    var inp = e.target;
    var r = inp.getAttribute('data-r');
    var c = inp.getAttribute('data-c');
    var v = inp.value.replace(/[^0-9hpx~/\\\-]/gi, '').slice(0, 3);
    if (v !== inp.value) inp.value = v;
    var key = r + '_' + c;
    if (v) state.cells[key] = v;
    else   delete state.cells[key];
    saveLocal();
  }

  function onCellKey(e) {
    var inp = e.target;
    var r = +inp.getAttribute('data-r');
    var c = +inp.getAttribute('data-c');
    var dr = 0, dc = 0;
    if (e.key === 'ArrowRight')      dc = 1;
    else if (e.key === 'ArrowLeft')  dc = -1;
    else if (e.key === 'ArrowUp')    dr = -1;
    else if (e.key === 'ArrowDown')  dr = 1;
    else if (e.key === 'Enter')      dr = 1;          // Enter steps down a string
    else return;
    var next = grid.querySelector('input[data-r="' + (r + dr) + '"][data-c="' + (c + dc) + '"]');
    if (next) {
      e.preventDefault();
      next.focus();
      next.select();
    }
  }

  // ---- Persistence ---------------------------------------------------------
  var LS_KEY = 'sfp_tab_v1';

  function saveLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(serialise())); } catch (_) {}
  }

  function loadLocal() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) deserialise(JSON.parse(raw));
    } catch (_) {}
  }

  function serialise() {
    return {
      v: 1,
      title: state.title,
      strings: state.strings,
      tuning: state.tuning,
      measures: state.measures,
      beats: state.beats,
      subdiv: state.subdiv,
      perLine: state.perLine,
      flipped: state.flipped,
      notes: state.notes,
      cells: state.cells
    };
  }
  function deserialise(o) {
    if (!o || o.v !== 1) return;
    if (typeof o.title === 'string')      state.title    = o.title;
    if (typeof o.strings === 'number')    state.strings  = o.strings;
    if (typeof o.tuning === 'string')     state.tuning   = o.tuning;
    if (typeof o.measures === 'number')   state.measures = o.measures;
    if (typeof o.beats === 'number')      state.beats    = o.beats;
    if (typeof o.subdiv === 'number')     state.subdiv   = o.subdiv;
    if (typeof o.perLine === 'number')    state.perLine  = o.perLine;
    if (typeof o.flipped === 'boolean')   state.flipped  = o.flipped;
    if (Array.isArray(o.notes))           state.notes    = o.notes;
    if (o.cells && typeof o.cells === 'object') state.cells = o.cells;
  }

  // ---- URL share -----------------------------------------------------------
  // Tab state is encoded as `?td=<base64-json>` (separate from the main
  // site's URL state model so the two don't clobber each other).
  function buildShareUrl() {
    var payload = serialise();
    var json = JSON.stringify(payload);
    var b64 = btoa(unescape(encodeURIComponent(json)));
    var url = location.origin + location.pathname + '?td=' + b64;
    return url;
  }

  function loadFromUrl() {
    var m = location.search.match(/[?&]td=([^&]+)/);
    if (!m) return false;
    try {
      var json = decodeURIComponent(escape(atob(m[1])));
      deserialise(JSON.parse(json));
      return true;
    } catch (_) { return false; }
  }

  // ---- Bind controls -------------------------------------------------------
  function pullFromControls() {
    state.title    = ctlTitle.value;
    state.strings  = +ctlStrings.value;
    state.measures = Math.max(1, Math.min(64, +ctlMeasures.value || 1));
    state.beats    = Math.max(2, Math.min(12, +ctlBeats.value || 4));
    state.subdiv   = +ctlSubdiv.value;
    state.perLine  = +ctlPerLine.value;
    state.tuning   = ctlTuning.value;
  }

  function pushToControls() {
    ctlTitle.value    = state.title;
    ctlStrings.value  = String(state.strings);
    ctlMeasures.value = String(state.measures);
    ctlBeats.value    = String(state.beats);
    ctlSubdiv.value   = String(state.subdiv);
    ctlPerLine.value  = String(state.perLine);
    // tuning select is repopulated based on string count
    populateTuningSelect();
    if (state.tuning) ctlTuning.value = state.tuning;
  }

  function bindControls() {
    ctlTitle.addEventListener('input', function () {
      state.title = ctlTitle.value;
      titlePrint.textContent = state.title;
      saveLocal();
    });

    ctlStrings.addEventListener('change', function () {
      state.strings = +ctlStrings.value;
      // dropping rows that no longer exist
      Object.keys(state.cells).forEach(function (k) {
        var r = +k.split('_')[0];
        if (r >= state.strings) delete state.cells[k];
      });
      populateTuningSelect();
      render();
      saveLocal();
    });

    ctlTuning.addEventListener('change', function () {
      state.tuning = ctlTuning.value;
      syncStateNotesFromTuning();
      render();
      saveLocal();
    });

    [ctlMeasures, ctlBeats, ctlSubdiv, ctlPerLine].forEach(function (el) {
      el.addEventListener('change', function () {
        pullFromControls();
        // dropping cells past the new column count
        var maxCol = state.measures * state.beats * state.subdiv - 1;
        Object.keys(state.cells).forEach(function (k) {
          var c = +k.split('_')[1];
          if (c > maxCol) delete state.cells[k];
        });
        render();
        saveLocal();
      });
    });

    btnClear.addEventListener('click', function () {
      if (!confirm('Clear all notes from the grid?')) return;
      state.cells = {};
      render();
      saveLocal();
    });

    btnFlip.addEventListener('click', function () {
      state.flipped = !state.flipped;
      state.notes.reverse();
      // also flip the cell rows
      var n = state.strings;
      var newCells = {};
      Object.keys(state.cells).forEach(function (k) {
        var parts = k.split('_');
        var r = +parts[0];
        var c = +parts[1];
        newCells[(n - 1 - r) + '_' + c] = state.cells[k];
      });
      state.cells = newCells;
      render();
      saveLocal();
    });

    // Print routing: set body[data-print]="section_8" so the main-site CSS
    // hides every other section while the tab prints. Restore on afterprint.
    function _printRouted(blankSnap) {
      var sec = document.getElementById('section_8');
      var restoreClosed = false;
      if (sec && sec.tagName === 'DETAILS' && !sec.open) {
        restoreClosed = true;
        sec.open = true;
      }
      document.body.setAttribute('data-print', 'section_8');
      function cleanup() {
        document.body.removeAttribute('data-print');
        if (restoreClosed && sec) sec.open = false;
        if (blankSnap) {
          paper.classList.remove('blank');
          state.cells    = blankSnap.cells;
          state.measures = blankSnap.measures;
          state.subdiv   = blankSnap.subdiv;
          state.perLine  = blankSnap.perLine;
          state.title    = blankSnap.title;
          titlePrint.textContent = blankSnap.title || '';
          render();
        }
        window.removeEventListener('afterprint', cleanup);
      }
      window.addEventListener('afterprint', cleanup);
      setTimeout(function () { window.print(); }, 50);
    }

    btnPrint.addEventListener('click', function (e) {
      e.preventDefault();
      paper.classList.remove('blank');
      _printRouted(null);
    });

    btnPrintBl.addEventListener('click', function (e) {
      e.preventDefault();
      // Blank-print formatting modelled on the user's reference layout:
      // no title, 3 measures per system, ~5 systems / page, subdiv=1 so only
      // bar-lines (not beat ticks) show. State is snapped here and restored
      // by _printRouted's afterprint cleanup.
      var snap = {
        cells:    state.cells,
        measures: state.measures,
        beats:    state.beats,
        subdiv:   state.subdiv,
        perLine:  state.perLine,
        title:    state.title
      };
      var BLANK_PER_LINE = 3;
      // System count per string count, tuned so each string-count fills
      // exactly one landscape letter page. Fewer strings = taller systems
      // fit fewer; more strings = each system is taller so fewer fit.
      // System count per string count — tuned to fill exactly one
      // landscape letter page in blank mode (which uses tighter rows).
      var BLANK_SYSTEMS_BY_STRINGS = {
        4: 8, 5: 7, 6: 6,
        7: 5, 8: 5,
        9: 4, 10: 4,
        11: 3, 12: 3
      };
      var BLANK_SYSTEMS = BLANK_SYSTEMS_BY_STRINGS[state.strings] || 5;
      state.cells    = {};
      state.subdiv   = 1;
      state.perLine  = BLANK_PER_LINE;
      state.measures = BLANK_PER_LINE * BLANK_SYSTEMS;
      state.title    = '';
      titlePrint.textContent = '';
      subPrint.textContent = '';
      paper.classList.add('blank');
      render();
      _printRouted(snap);
    });

    // Browsers strip placeholder text from <input> elements when printing,
    // so empty string labels would print as blank cells. Before each print
    // pass, swap empty label values for "—" (the same character used as
    // placeholder), then restore on afterprint.
    window.addEventListener('beforeprint', function () {
      document.querySelectorAll('input.tab_label_input').forEach(function (inp) {
        if (!inp.value) {
          inp.setAttribute('data-print-restore', '1');
          inp.value = '—';
        }
      });
    });
    window.addEventListener('afterprint', function () {
      document.querySelectorAll('input.tab_label_input').forEach(function (inp) {
        if (inp.getAttribute('data-print-restore') === '1') {
          inp.value = '';
          inp.removeAttribute('data-print-restore');
        }
      });
    });

    if (btnShare) {
      btnShare.addEventListener('click', function (e) {
        e.preventDefault();
        var url = buildShareUrl();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            flashShare('Link copied');
          }, function () { prompt('Copy this link:', url); });
        } else {
          prompt('Copy this link:', url);
        }
      });
    }
  }

  function flashShare(msg) {
    if (!btnShare) return;
    var orig = btnShare.textContent;
    btnShare.textContent = msg;
    setTimeout(function () { btnShare.textContent = orig; }, 1400);
  }

  // ---- Init ----------------------------------------------------------------
  function init() {
    captureDom();
    // The Tab section is part of the main page now — bail out cleanly if
    // we're loaded somewhere that doesn't have the tab editor markup.
    if (!ctlTitle || !grid || !paper) return;
    // priority: URL > localStorage > defaults
    var fromUrl = loadFromUrl();
    if (!fromUrl) loadLocal();
    pushToControls();
    syncStateNotesFromTuning();
    render();
    bindControls();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
