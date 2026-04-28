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
  var $ = function (id) { return document.getElementById(id); };
  var ctlTitle    = $('ctl_title');
  var ctlStrings  = $('ctl_strings');
  var ctlTuning   = $('ctl_tuning');
  var ctlMeasures = $('ctl_measures');
  var ctlBeats    = $('ctl_beats');
  var ctlSubdiv   = $('ctl_subdiv');
  var ctlPerLine  = $('ctl_per_line');
  var grid        = $('tab_grid');
  var paper       = $('tab_paper');
  var titlePrint  = $('tab_title_print');
  var subPrint    = $('tab_subtitle_print');
  var btnClear    = $('btn_clear');
  var btnFlip     = $('btn_low_high');
  var btnPrint    = document.querySelector('.btn_print');
  var btnPrintBl  = document.querySelector('.btn_print_blank');
  var btnShare    = document.querySelector('.btn_share');
  var buildEl     = $('build_num');

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
  function tuningsForStringCount(n) {
    var out = [];
    for (var key in TUNINGS) {
      if (TUNINGS[key] && TUNINGS[key].strs === n) {
        out.push({ key: key, name: TUNINGS[key].name, notes: TUNINGS[key].notes });
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
    var html = '<option value="">(custom — blank labels)</option>';
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      var sel = (t.key === state.tuning) ? ' selected' : '';
      html += '<option value="' + escAttr(t.key) + '"' + sel + '>'
            + escHtml(t.name) + ' &mdash; ' + escHtml(t.notes) + '</option>';
    }
    ctlTuning.innerHTML = html;
    if (state.tuning && (!TUNINGS[state.tuning] || TUNINGS[state.tuning].strs !== n)) {
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
      var rowTemplate   = '36px ' + cellsTemplate;
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
        html += '<div class="tab_row" style="grid-template-columns: ' + rowTemplate + ';">';
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
          html += '<input type="text" maxlength="3" data-r="' + r + '" data-c="' + globalCol
                + '" value="' + escAttr(val) + '" autocomplete="off" spellcheck="false">';
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
    });
    grid.querySelectorAll('input:not(.tab_label_input)').forEach(function (inp) {
      inp.addEventListener('input', onCellInput);
      inp.addEventListener('keydown', onCellKey);
    });
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
  function buildShareUrl() {
    var payload = serialise();
    var json = JSON.stringify(payload);
    var b64 = btoa(unescape(encodeURIComponent(json)));
    var url = location.origin + location.pathname + '?d=' + b64;
    return url;
  }

  function loadFromUrl() {
    var m = location.search.match(/[?&]d=([^&]+)/);
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

    btnPrint.addEventListener('click', function (e) {
      e.preventDefault();
      paper.classList.remove('blank');
      window.print();
    });

    btnPrintBl.addEventListener('click', function (e) {
      e.preventDefault();
      // "Print blank" prints a full page of empty tab staves at the current
      // string count, regardless of the current notes/measures. We snapshot
      // state, stamp a generous blank layout, render, print, then restore.
      const snap = {
        cells:    state.cells,
        measures: state.measures,
        beats:    state.beats,
        subdiv:   state.subdiv,
        perLine:  state.perLine,
        title:    state.title
      };
      // ~6 systems of 4 measures gives a clean letter-page sheet at the
      // default per-line. Honour the user's perLine + beats; only force
      // measure count + clear cells.
      state.cells    = {};
      state.subdiv   = 1;                            // one cell per beat is plenty for handwriting
      state.measures = (state.perLine || 4) * 6;     // ~6 systems
      state.title    = '';                           // blank sheet — no title
      titlePrint.textContent = '';
      subPrint.textContent = state.strings + '-string blank tab —  ' +
        (state.tuning && TUNINGS[state.tuning]
          ? (TUNINGS[state.tuning].name + '  ' + TUNINGS[state.tuning].notes)
          : '');
      paper.classList.add('blank');
      render();
      window.print();
      // Restore after the print dialog closes
      setTimeout(function () {
        paper.classList.remove('blank');
        state.cells    = snap.cells;
        state.measures = snap.measures;
        state.subdiv   = snap.subdiv;
        state.perLine  = snap.perLine;
        state.title    = snap.title;
        titlePrint.textContent = snap.title || '';
        render();
      }, 500);
    });

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

  function flashShare(msg) {
    var orig = btnShare.textContent;
    btnShare.textContent = msg;
    setTimeout(function () { btnShare.textContent = orig; }, 1400);
  }

  // ---- Build stamp ---------------------------------------------------------
  function stampBuild() {
    if (!buildEl) return;
    // No auto-stamp on this page; show a static placeholder until commit hook
    // is extended. The pre-commit hook only edits index.html so this stays blank
    // unless the user wants to add tab.html to the stamp script.
    buildEl.textContent = 'tab editor — test build';
  }

  // ---- Init ----------------------------------------------------------------
  function init() {
    // priority: URL > localStorage > defaults
    var fromUrl = loadFromUrl();
    if (!fromUrl) loadLocal();
    pushToControls();
    syncStateNotesFromTuning();
    render();
    bindControls();
    stampBuild();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
