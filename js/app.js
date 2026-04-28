// SlantFinder.pro — client-side rewrite of the PHP renderer.
// Variable names mirror the original PHP ($x, $rev, $hilight_url) for traceability.

(function () {
  'use strict';

  const D = window.SF_DATA;
  const KEYS = D.keys;
  const ALLNOTES = D.allnotes;
  const DEGREES = D.degrees;            // ["1","♭2","2","♭3","3","4","♭5","5","♭6","6","♭7","7"]
  const EXTENSIONS = D.extensions;
  const URL_NOTE_CHECK = D.url_note_check;
  const URL_CHECK = D.url_check;
  const DEF_X = D.def_x;
  const SCALES = D.scales;
  const CHORDS = D.chords;
  const GRID = D.grid;
  const TUNINGS = D.tunings;

  // ---------- helpers ----------
  // URL with every current param except hl — used by every Clear button so
  // clearing only drops the highlight, not the key/tuning/collapsed sections.
  function clearHlHref() {
    const params = new URLSearchParams(window.location.search);
    params.delete('hl');
    const qs = params.toString();
    // Always include the leading "?" so the link interceptor catches it.
    return qs ? '?' + qs : '?';
  }

  // Escape a string so it's safe to drop inside a CSS `content: "..."` value.
  // Non-ASCII (♭, ♯) is fine, but we must escape backslashes and double quotes.
  function escapeCssString(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // ---------- URL note encoding ----------
  // We use lowercase 's' for sharp and lowercase 'b' for flat in URLs:
  //   F♯  ↔  Fs    (was F%23 — saves 4 chars per sharp, no escaping)
  //   B♭  ↔  Bb
  // Both old (#-encoded as %23) and new ('s') URLs decode the same way, so
  // links from before this change keep working.
  function urlNote(s) {
    return String(s)
      .replace(/♭/g, 'b')
      .replace(/♯/g, 's')
      .replace(/ /g, '');
  }
  function urlNoteRaw(s) {
    return String(s).replace(/♯/g, 's');
  }
  function reverseSpaceStr(s) {
    return String(s).split(' ').reverse().join(' ');
  }
  function bToFlat(s) { return String(s).replace(/b/g, '♭'); }
  function flatToB(s) { return String(s).replace(/♭/g, 'b'); }
  // sharpToHash is the URL→display path: it accepts BOTH '#' (legacy URLs
  // that pre-date the 's' encoding) and 's' immediately after a capital
  // A-G note letter. Either becomes the unicode ♯.
  function sharpToHash(s) {
    return String(s)
      .replace(/#/g, '♯')
      .replace(/([A-G])s/g, '$1♯');
  }
  function hashToSharp(s) { return String(s).replace(/♯/g, 's'); }

  // Read the active highlight degrees from URL params. Accepts both the
  // legacy multi-key form ?hl=1&hl=b3&hl=5 and the compact comma-separated
  // form ?hl=1,b3,5 — splits on commas across every hl key seen.
  function readHlParam(params) {
    return params.getAll('hl')
      .flatMap(function (v) { return v.split(','); })
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length; });
  }

  // Read the custom-tuning strings from URL params. Accepts both legacy
  // ?s1=A&s2=Cs&… and the compact dot-separated ?s=A.Cs.E.F.G.A.C.E
  // (positions 0..N-1 correspond to s1..sN; missing slots become null).
  function readCustomStrings(params) {
    const single = params.get('s');
    if (single != null) {
      const list = single.split('.');
      const out = {};
      for (let i = 0; i < list.length && i < 12; i++) {
        if (list[i]) out['s' + (i + 1)] = list[i];
      }
      return out;
    }
    const out = {};
    for (let i = 1; i <= 12; i++) {
      const v = params.get('s' + i);
      if (v != null) out['s' + i] = v;
    }
    return out;
  }

  // ---------- parse URL → x ----------
  function parseState() {
    const x = {};
    let def = '';

    const params = new URLSearchParams(window.location.search);
    const hasParams = Array.from(params.keys()).length > 0;

    if (hasParams) {
      // Build raw map of key → array (for hl which is multi-valued).
      // Skip the multi-value keys here; we hydrate them from helpers below.
      const raw = {};
      for (const [k, v] of params.entries()) {
        if (k === 'hl' || k === 's') continue;
        const val = bToFlat(sharpToHash(v));
        if (!raw[k]) raw[k] = [];
        raw[k].push(val);
      }
      // Hydrate hl (compact ?hl=1,b3,5 OR legacy ?hl=1&hl=b3&hl=5)
      const hlList = readHlParam(params).map(function (v) { return bToFlat(v); });
      if (hlList.length) raw.hl = hlList;
      // Hydrate s1..s12 (compact ?s=A.Cs.E.F.G.A.C.E OR legacy ?s1=…&s2=…)
      const cstr = readCustomStrings(params);
      for (const sk in cstr) raw[sk] = [bToFlat(sharpToHash(cstr[sk]))];

      // Validate x (tuning key)
      if (raw.x && raw.x[0]) {
        if (Object.prototype.hasOwnProperty.call(TUNINGS, raw.x[0])) {
          x.x = raw.x[0];
        } else {
          def = 'y';
        }
      }

      // Validate single-value note params (k, s1..s12)
      // Allow flats too — custom string-note dropdowns can produce e.g.
      // B♭ which is a valid note. Without ♭ here, any URL containing a
      // flat custom string failed validation and triggered the "use
      // defaults for everything" fallback below, silently dropping z=y
      // and disengaging custom tuning whenever the user touched any
      // form control (key, tuning, custom string).
      const noteOk = /^[A-G♯♭]+$/;
      for (const n of URL_NOTE_CHECK) {
        if (raw[n] && raw[n][0]) {
          if (noteOk.test(raw[n][0])) {
            x[n] = raw[n][0];
          } else {
            def = 'y';
          }
        }
      }

      // Validate y, z
      for (const o of URL_CHECK) {
        if (raw[o] && raw[o][0]) {
          if (/^[yn]$/.test(raw[o][0])) {
            x[o] = raw[o][0];
          } else {
            def = 'y';
          }
        }
      }

      // Validate hl (multi-value)
      if (raw.hl && raw.hl.length) {
        const joined = raw.hl.join(' ');
        // valid chars: 1-7 and ♭ (which arrived as "b" → already converted to ♭)
        if (/^[1-7♭ ]+$/.test(joined)) {
          x.hl = joined;
        } else {
          def = 'y';
        }
      } else {
        x.hl = 'nothing';
      }
    }

    // Apply defaults
    if (def === 'y' || !hasParams) {
      for (const k in DEF_X) x[k] = DEF_X[k];
    } else {
      for (const k in DEF_X) {
        if (x[k] === undefined || x[k] === '' || Array.isArray(x[k])) x[k] = DEF_X[k];
      }
    }

    // Merge in the chosen tuning
    const tun = TUNINGS[x.x];
    for (const k in tun) x[k] = tun[k];
    // Override the precomputed url_notes so emitted URLs use the new
    // 's' form for sharps (data.js still has %23-encoded values).
    x.url_notes = urlNote(x.notes);

    // Build x.s from s1..s12 (custom-tuning notes assembled in reverse order)
    let ess = '';
    for (let i = 12; i >= 1; i--) {
      if (KEYS.indexOf(x['s' + i]) !== -1) ess += x['s' + i] + ' ';
    }
    ess = ess.trim();
    x.s = ess;
    x.rev_s = reverseSpaceStr(ess);

    if (x.z === 'y') {
      x.d_name = 'Custom';
      x.d_notes = x.s;
    } else {
      x.d_name = x.name;
      x.d_notes = x.notes;
    }
    x.rev_yy = 'High to Low';
    x.yy = 'Low to High';

    // notesplode = reversed split of tuning notes; x.x1..x12 are fretboard string notes (top→bottom)
    const notesplode = x.notes.split(' ').reverse();
    for (let a = 1; a <= 12; a++) {
      x['x' + a] = notesplode[a - 1];
    }

    // url_s: single dot-separated 's' param holding s1..s12 in order, with
    // sharps written as 's' (urlNote handles the ♯→s transform). Trailing
    // empties are trimmed so we don't bloat the URL with unused slots.
    let _sParts = [];
    for (let a = 1; a <= 12; a++) {
      _sParts.push(x['s' + a] ? urlNote(x['s' + a]) : '');
    }
    while (_sParts.length && !_sParts[_sParts.length - 1]) _sParts.pop();
    let url_s = _sParts.length ? 's=' + _sParts.join('.') + '&' : '';

    // Print colors are always on now — body keeps the .print-colors class
    // permanently so highlight bg's print as colors. Toggle was removed.

    // Tunings table sort: ?sort=<col>:<a|d>
    const sortRaw = params.get('sort');
    x._sort = null;
    if (sortRaw && /^\d+:[ad]$/.test(sortRaw)) {
      const parts = sortRaw.split(':');
      x._sort = { col: parseInt(parts[0], 10), dir: parts[1] };
    }

    // Tunings filter: ?f=<text>. Length-capped + control chars stripped to keep
    // the URL sane and to ensure nothing weird ends up on the page (we still
    // only ever set this via .value / textContent, never innerHTML).
    const fRaw = params.get('f');
    x._filter = '';
    if (typeof fRaw === 'string') {
      x._filter = fRaw.replace(/[\x00-\x1F\x7F]/g, '').slice(0, 64);
    }

    // hl_arr → flags
    if (x.hl === undefined || x.hl === null) x.hl = '';
    const hlArr = String(x.hl).split(' ').filter(v => v !== '' && v !== 'nothing');
    // Compact single-key form for emitted URLs (?hl=1,b3,5).
    x.url_hl = hlArr.length ? 'hl=' + hlArr.map(flatToB).join(',') + '&' : '';
    // Legacy multi-key form, kept ONLY for matching against SCALES / CHORDS /
    // GRID values in data.js (which are still expressed as &hl=…&hl=…). Not
    // emitted into any URL. If we later regen data.js with the compact form,
    // this can collapse onto x.url_hl.
    let url_hl_match = '';
    for (const v of hlArr) url_hl_match += 'hl=' + flatToB(v) + '&';
    x._url_hl_match = url_hl_match;

    for (const v of DEGREES) {
      const key = 'hl_' + flatToB(v);
      x[key] = hlArr.indexOf(v) !== -1 ? 'y' : 'n';
    }

    // notedegrees: degree → note based on current key
    const a0 = KEYS.indexOf(x.k);
    const notedegrees = {};
    for (let b = 0; b <= 11; b++) {
      notedegrees[DEGREES[b]] = KEYS[a0 + b];
    }
    x._notedegrees = notedegrees;

    // sdgs1..12 — degree of each custom-tuning string in current key
    const sdgs = [];
    for (let i = 12; i >= 1; i--) {
      const d = findKey(notedegrees, x['s' + i]);
      x['sdgs' + i] = d;
      sdgs[i] = d;
    }
    // implode in 1..12 order? PHP does sdgs[1..12] via loop 12→1, then implode preserves keys 12..1
    // PHP: $x['sdgs'] = trim( implode( " ", $sdgs ) );  — keys 12,11,...,1
    let sdgsStr = '';
    for (let i = 12; i >= 1; i--) if (sdgs[i] !== undefined) sdgsStr += sdgs[i] + ' ';
    x.sdgs = sdgsStr.trim();
    x.rev_sdgs = reverseSpaceStr(x.sdgs);

    // hl_name lookup — match against the legacy multi-key form (data.js
    // SCALES / CHORDS / GRID values still use &hl=…&hl=…).
    x.hl_name = 'Highlighted: ';
    x.hl_n = '';
    const targetHl = '&' + x._url_hl_match;
    function checkSet(set, suffix) {
      for (const a in set) {
        if (targetHl === set[a] + '&') {
          x.hl_name += a.replace(/_/g, ' ') + suffix;
          x.hl_n += a.replace(/_/g, ' ');
          return true;
        }
      }
      return false;
    }
    // Check GRID before CHORDS so the chord-name casing matches what the
    // builder grid + quick-pick chips iterate (GRID has 'aug', 'dim', 'dom7',
    // etc. — lowercase — while the legacy CHORDS map has 'Aug', 'Dim',
    // 'Dom7'). With CHORDS first, x.hl_n didn't match the chip names.
    if (!checkSet(SCALES, ' Scale')) {
      if (!checkSet(GRID, ' Chord')) checkSet(CHORDS, ' Chord');
    }
    x.hl_name += ' (' + x.hl + ')';

    x.url_s = url_s;
    x.url_x = 'x=' + x.url_notes + '&';
    x.url_k = 'k=' + x.k + '&';
    x.url_y = 'y=' + x.y + '&';
    x.url_z = 'z=' + x.z + '&';

    x._self = '?';
    x._hilight_url = x._self + x.url_k + x.url_x + x.url_y + x.url_z + x.url_s;

    return x;
  }

  function findKey(obj, val) {
    for (const k in obj) if (obj[k] === val) return k;
    return false;
  }

  // ---------- renderers ----------
  function renderTitle(x) {
    const a = document.querySelector('#section_1 h1 a');
    if (a) a.href = x._self;
  }

  function renderOptions(x) {
    const root = document.getElementById('options_root');
    const rev = (x.y === 'y') ? 'rev_' : '';
    let h = '<div id="tunings_drop">';

    // y toggle (Low→High vs High→Low) — bg color indicates state
    const yState = x.y === 'y' ? 'on' : 'off';
    const yToggleParams = new URLSearchParams(window.location.search);
    if (x.y !== 'y') yToggleParams.set('y', 'y'); else yToggleParams.delete('y');
    const yToggleQs = yToggleParams.toString();
    const yToggleHref = yToggleQs ? '?' + yToggleQs : '?';
    const yLabel = x.y === 'y' ? 'H→L' : 'L→H';
    const yTitle = x.y === 'y'
      ? 'Tunings displayed High → Low. Click to flip to Low → High.'
      : 'Tunings displayed Low → High. Click to flip to High → Low.';

    // Row 1: y switch + tuning picker (sortable / filterable popover; the
    // hidden <select name="x"> keeps gatherAndNavigate working when other
    // form controls change without the user touching the picker).
    h += '<div class="opt_row opt_row_main">';
    h += '<a href="' + escHtml(yToggleHref) + '" class="y_switch y_' + yState + '" title="' + escHtml(yTitle) + '" aria-label="Toggle tuning direction">' + yLabel + '</a>';
    const curLabel = '(' + x.strs + '-string) ' + x.name + ' — ' + x[rev + 'notes'] + ' — (' + x[rev + 'dgs'] + ')';
    h += '<div class="tun_picker" id="tun_picker">';
    h +=   '<button type="button" class="tun_picker_btn inputs" id="tun_picker_btn" aria-haspopup="dialog" aria-expanded="false">';
    h +=     '<span class="tun_btn_main">' + escHtml(curLabel) + '</span>';
    h +=     '<span class="tun_btn_caret" aria-hidden="true">▾</span>';
    h +=   '</button>';
    h +=   '<select class="inputs tun_hidden_select" name="x" aria-hidden="true" tabindex="-1">';
    h +=     '<option value="' + escHtml(x.x) + '" selected>' + escHtml(curLabel) + '</option>';
    h +=   '</select>';
    h +=   '<div class="tun_pop" id="tun_pop" hidden role="dialog" aria-label="Choose a tuning"></div>';
    h += '</div>';
    h += '</div>';

    // (Key dropdown + Clear live in the section title bars now, not in the form.)

    // Row 3: highlight degree pickers (link-style toggle pills, same widget
    // used above the keyboard so the two sections look identical).
    h += highlightPillsLinkHtml(x, 'fb_hl_row');

    h += '</div>';
    root.innerHTML = h;
  }

  // ---------- tuning picker popover ----------
  // Sortable / filterable replacement for the native <select name="x">.
  // Sort + filter state persists in module-scope vars across re-renders so the
  // user keeps their column sort and search after picking a tuning.
  let _tunPickerSort = { col: 'name', dir: 'asc' };
  let _tunPickerFilter = '';
  let _tunPickerStrFilter = '';   // '' = all; '6' / '8' / '10' / '12' for quick string-count filter

  function _tunPickerRows(x) {
    const rev = (x.y === 'y') ? 'rev_' : '';
    const rows = [];
    for (const key in TUNINGS) {
      const t = TUNINGS[key];
      rows.push({
        key:   key,
        strs:  t.strs,
        name:  t.name,
        notes: t[rev + 'notes'],
        dgs:   t[rev + 'dgs'],
        info:  t.info || ''
      });
    }
    return rows;
  }

  function _tunPickerSorted(rows) {
    const { col, dir } = _tunPickerSort;
    const mul = dir === 'desc' ? -1 : 1;
    return rows.slice().sort(function (a, b) {
      let av = a[col], bv = b[col];
      if (col === 'strs') { av = +av; bv = +bv; }
      else { av = String(av).toLowerCase(); bv = String(bv).toLowerCase(); }
      if (av < bv) return -1 * mul;
      if (av > bv) return  1 * mul;
      // Stable secondary sort by name then notes
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return a.notes.localeCompare(b.notes);
    });
  }

  function _tunPickerFiltered(rows) {
    let out = rows;
    if (_tunPickerStrFilter) {
      const want = +_tunPickerStrFilter;
      out = out.filter(function (r) { return +r.strs === want; });
    }
    const q = _tunPickerFilter.trim().toLowerCase();
    if (q) {
      // tokenise so "8 a6" matches "8-string A6 ..."
      const toks = q.split(/\s+/);
      out = out.filter(function (r) {
        const hay = (r.strs + ' ' + r.name + ' ' + r.notes + ' ' + r.dgs + ' ' + r.info).toLowerCase();
        return toks.every(function (t) { return hay.indexOf(t) !== -1; });
      });
    }
    return out;
  }

  function renderTuningPicker(x) {
    const pop = document.getElementById('tun_pop');
    if (!pop) return;
    const rows = _tunPickerFiltered(_tunPickerSorted(_tunPickerRows(x)));
    const cols = [
      { k: 'strs',  label: 'Str' },
      { k: 'name',  label: 'Name' },
      { k: 'notes', label: 'Notes' },
      { k: 'dgs',   label: 'Degrees' },
      { k: 'info',  label: 'Info' }
    ];
    let h = '';
    h += '<div class="tun_pop_head">';
    h += '  <input type="search" class="tun_pop_filter" placeholder="filter — e.g. ‘8 A6’ or ‘E9 emmons’" value="' + escHtml(_tunPickerFilter) + '" autocomplete="off" spellcheck="false">';
    h += '  <span class="tun_pop_count">' + rows.length + ' / ' + Object.keys(TUNINGS).length + '</span>';
    h += '</div>';
    // Quick string-count radios — one click filter for the most common
    // selectors. The filter text input still works on top of this.
    const quick = ['', '6', '8', '10', '12'];
    h += '<div class="tun_pop_strs" role="radiogroup" aria-label="Filter by string count">';
    quick.forEach(function (v) {
      const active = (_tunPickerStrFilter === v) ? ' active' : '';
      const label = v === '' ? 'All' : v + '-string';
      h += '<button type="button" class="tun_pop_str_btn' + active + '" '
        +  'data-strs="' + v + '" role="radio" aria-checked="' + (_tunPickerStrFilter === v) + '">'
        +  escHtml(label) + '</button>';
    });
    h += '</div>';
    h += '<div class="tun_pop_body">';
    h += '<table class="tun_pop_table"><thead><tr>';
    cols.forEach(function (c) {
      const arrow = (_tunPickerSort.col === c.k)
        ? (_tunPickerSort.dir === 'asc' ? ' ▲' : ' ▼')
        : '';
      const colHCls = c.k === 'strs' ? ' c_strs_h' : '';
      h += '<th data-col="' + c.k + '" class="tun_pop_th' + (_tunPickerSort.col === c.k ? ' active' : '') + colHCls + '">'
        + escHtml(c.label) + '<span class="tun_pop_arrow">' + arrow + '</span></th>';
    });
    h += '</tr></thead><tbody>';
    rows.forEach(function (r) {
      const sel = (r.key === x.x) ? ' tun_pop_row_selected' : '';
      h += '<tr class="tun_pop_row' + sel + '" data-key="' + escAttr(r.key) + '" tabindex="0">';
      h += '<td class="c_strs">' + r.strs + '</td>';
      h += '<td class="c_name">' + escHtml(r.name) + '</td>';
      h += '<td class="c_notes">' + escHtml(r.notes) + '</td>';
      h += '<td class="c_dgs">' + escHtml(r.dgs) + '</td>';
      h += '<td class="c_info">' + escHtml(r.info) + '</td>';
      h += '</tr>';
    });
    if (!rows.length) {
      h += '<tr><td colspan="5" class="tun_pop_empty">No tunings match.</td></tr>';
    }
    h += '</tbody></table></div>';
    pop.innerHTML = h;
  }

  function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function bindTuningPicker(x) {
    const btn = document.getElementById('tun_picker_btn');
    const pop = document.getElementById('tun_pop');
    if (!btn || !pop) return;

    function open() {
      pop.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      renderTuningPicker(x);
      // focus the filter input for instant typing
      setTimeout(function () {
        const f = pop.querySelector('.tun_pop_filter');
        if (f) f.focus();
        const selRow = pop.querySelector('.tun_pop_row_selected');
        if (selRow) selRow.scrollIntoView({ block: 'center' });
      }, 0);
      document.addEventListener('mousedown', onDocDown, true);
      document.addEventListener('keydown', onKeydown, true);
    }
    function close() {
      pop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('keydown', onKeydown, true);
    }
    function onDocDown(e) {
      if (!pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) close();
    }
    function onKeydown(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); }
    }

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      pop.hidden ? open() : close();
    });

    // Delegated handlers for the popover contents (re-rendered on filter/sort
    // changes, so attaching once on `pop` keeps wiring trivial).
    pop.addEventListener('input', function (e) {
      if (e.target.classList && e.target.classList.contains('tun_pop_filter')) {
        _tunPickerFilter = e.target.value;
        // Preserve focus + caret across re-render
        const at = e.target.selectionStart;
        renderTuningPicker(x);
        const f = pop.querySelector('.tun_pop_filter');
        if (f) { f.focus(); try { f.setSelectionRange(at, at); } catch (_) {} }
      }
    });
    pop.addEventListener('click', function (e) {
      const strBtn = e.target.closest && e.target.closest('.tun_pop_str_btn');
      if (strBtn) {
        _tunPickerStrFilter = strBtn.getAttribute('data-strs') || '';
        renderTuningPicker(x);
        return;
      }
      const th = e.target.closest && e.target.closest('.tun_pop_th');
      if (th) {
        const col = th.getAttribute('data-col');
        if (_tunPickerSort.col === col) {
          _tunPickerSort.dir = _tunPickerSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          _tunPickerSort = { col: col, dir: col === 'strs' ? 'asc' : 'asc' };
        }
        renderTuningPicker(x);
        return;
      }
      const row = e.target.closest && e.target.closest('.tun_pop_row');
      if (row) {
        const key = row.getAttribute('data-key');
        if (key) {
          close();
          // Apply the new tuning by setting the hidden select + dispatching
          // change → bindAutoSubmit → gatherAndNavigate, which preserves every
          // other URL param.
          const sel = document.querySelector('.tun_hidden_select');
          if (sel) {
            // Make sure the option exists before setting value (single-option select)
            const opt = document.createElement('option');
            opt.value = key;
            opt.selected = true;
            sel.innerHTML = '';
            sel.appendChild(opt);
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      }
    });
    pop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        const row = document.activeElement && document.activeElement.closest && document.activeElement.closest('.tun_pop_row');
        if (row) { e.preventDefault(); row.click(); }
      }
    });
  }

  // Quick-pick chord/scale chips. Reused above the fretboard AND above the
  // keyboard so the user can drive selections from either section without
  // scrolling to a builder grid.
  function quickPicksHtml(x, idAttr) {
    let h = '';
    h += '<div' + (idAttr ? ' id="' + idAttr + '"' : ' class="quick_picks"') + '>';
    h += '  <div class="qp_row">';
    for (const a in GRID) {
      const label = a.replace(/b/g, '♭').replace(/#/g, '♯');
      const isSelected = (x.hl_n === a.replace(/_/g, ' '));
      const href = isSelected ? x._hilight_url : (x._hilight_url + hlMultiToCsv(GRID[a]));
      const cls = 'qp_link' + (isSelected ? ' cg_selected' : '');
      h += '<a class="' + cls + '" href="' + href + '">' + escHtml(label) + '</a>';
    }
    h += '  </div>';
    h += '  <div class="qp_row">';
    for (const name in SCALES) {
      const label = name.replace(/_/g, ' ');
      const isSelected = (x.hl_n === label);
      const href = isSelected ? x._hilight_url : (x._hilight_url + hlMultiToCsv(SCALES[name]));
      const cls = 'qp_link' + (isSelected ? ' cg_selected' : '');
      h += '<a class="' + cls + '" href="' + href + '">' + escHtml(label) + '</a>';
    }
    h += '  </div>';
    h += '</div>';
    return h;
  }

  // Per-degree colors used for the highlight-pill on-state, mirroring the
  // fretboard cell colors (#_1_ etc. in styles.css). Keep in sync with that map.
  const HL_PILL_COLORS = {
    '1':  '#ff0000', 'b2': '#674ea7', '2':  '#9900ff',
    'b3': '#f6b26b', '3':  '#ff6d01', '4':  '#00ffff',
    'b5': '#3d85c6', '5':  '#0000ff',
    'b6': '#6aa84f', '6':  '#0cc016',
    'b7': '#a64d79', '7':  '#ff00ff'
  };
  // Degrees whose background reads dark enough that white text wins.
  const HL_PILL_LIGHT_TEXT = { '1':1, 'b2':1, '2':1, '3':1, 'b5':1, '5':1, 'b6':1, 'b7':1, '7':1 };

  // Highlight degree pills as toggle LINKS (not checkboxes). Used both inside
  // the fretboard form AND above the keyboard section so the two stay in sync.
  // Each pill flips its own `&hl=<deg>` in the URL, so the link interceptor
  // re-renders in place. On-state pills are coloured to match the degree.
  // GRID / SCALES / CHORDS values in data.js are still in the legacy
  // multi-key form (&hl=1&hl=3&hl=5). Convert on the fly so chord/scale
  // chip URLs land in the same compact comma form as everything else.
  function hlMultiToCsv(frag) {
    const matches = (String(frag).match(/&hl=([^&]+)/g) || [])
      .map(function (s) { return s.slice(4); });
    if (!matches.length) return frag;
    const stripped = String(frag).replace(/&hl=[^&]+/g, '');
    return stripped + '&hl=' + matches.join(',');
  }

  // Build a URL with the given hl list as a single comma-separated `hl=`
  // param (preserves every other current param exactly).
  function buildHlHref(hlList) {
    const p = new URLSearchParams(window.location.search);
    p.delete('hl');
    let qs = p.toString();
    if (hlList.length) {
      qs += (qs ? '&' : '') + 'hl=' + hlList.join(',');
    }
    return qs ? '?' + qs : '?';
  }

  function highlightPillsLinkHtml(x, rowCls) {
    let h = '<div class="opt_row opt_row_highlights ' + (rowCls || '') + '">';
    h += '<span class="hl_title">Highlight:</span>';
    const cur = readHlParam(new URLSearchParams(window.location.search));
    DEGREES.forEach(function (a, i) {
      const ab = flatToB(a);
      const on = (x['hl_' + ab] === 'y');
      let next;
      if (on) {
        next = cur.filter(function (d) { return d !== ab; });
      } else {
        next = cur.filter(function (d) { return d !== ab; }).concat([ab]);
      }
      const href = buildHlHref(next);
      const cls = 'hl_pill' + (on ? ' hl_pill_on' : '');
      let style = '';
      if (on) {
        const bg = HL_PILL_COLORS[ab] || '#888';
        const fg = HL_PILL_LIGHT_TEXT[ab] ? '#fff' : '#000';
        style = ' style="background:' + bg + ';color:' + fg + ';border-color:' + bg + ';"';
      }
      h += '<a class="' + cls + '" href="' + escHtml(href) + '"' + style + '>'
        + escHtml(a) + escHtml(EXTENSIONS[i]) + '</a>';
    });
    const allOn = DEGREES.every(function (d) { return x['hl_' + flatToB(d)] === 'y'; });
    const allHref = allOn
      ? clearHlHref()
      : buildHlHref(DEGREES.map(flatToB));
    h += '<a class="hl_pill hl_all_pill" href="' + escHtml(allHref) + '">' + (allOn ? 'None' : 'All') + '</a>';
    h += '</div>';
    return h;
  }

  // Render the highlight pills + chord/scale chips above the keyboard so the
  // keyboard section is fully usable when the fretboard section is collapsed.
  function renderKeyboardPicks(x) {
    const root = document.getElementById('kb_picks_root');
    if (!root) return;
    root.innerHTML = highlightPillsLinkHtml(x, 'kb_hl_row') + quickPicksHtml(x, 'kb_quick_picks');
  }

  function renderFretboard(x) {
    const root = document.getElementById('fretboard_root');
    const rev = (x.y === 'y') ? 'rev_' : '';
    const tuningName = (x.z === 'y') ? 'Custom' : x.name;
    const tuningNotes = (x.z === 'y')
      ? String(x[rev + 's']).replace(/ /g, '')
      : String(x[rev + 'notes']).replace(/ /g, '');
    const tuningDgs = (x.z === 'y')
      ? String(x[rev + 'sdgs']).replace(/ /g, '')
      : String(x[rev + 'dgs']).replace(/ /g, '');

    // Tuning + Key info now lives in each section's title bar (rendered by
    // renderSummaryStatus). The fretboard header only carries the form.
    let h = '';
    h += '<div class="fb_header">';
    h += '  <div id="options_root"></div>';
    h += '</div>';

    // Quick-pick chord/scale links — copies of the chord_grid + scale_grid
    // top rows, parked above the fretboard so the user doesn't have to
    // scroll down to a builder section to apply a chord or scale.
    h += quickPicksHtml(x, 'quick_picks');

    h += '<table id="fretboard">';

    const cyoState = x.z === 'y' ? 'on' : 'off';
    const cyoNextZ = x.z === 'y' ? 'n' : 'y';
    // Build a toggle URL that flips just the z param (preserving the rest)
    const toggleParams = new URLSearchParams(window.location.search);
    if (cyoNextZ === 'y') toggleParams.set('z', 'y'); else toggleParams.delete('z');
    const toggleHref = '?' + toggleParams.toString();
    const fretnumsTop = '<tr id="fretnums"><td class="fb_sm cyo_switch cyo_' + cyoState + '" id="' + (x.z === 'y' ? 'f_cyo' : 'f_cyo_dark') + '">' +
      '<a href="' + escHtml(toggleHref) + '" title="Click to toggle custom tuning">Custom Tuning: ' + cyoState.toUpperCase() + '</a>' +
      '</td><td id="f0">X</td><td id="f1"></td><td id="f2"></td><td id="f3">3</td><td id="f4"></td><td id="f5">5</td><td id="f6"></td><td id="f7">7</td><td id="f8"></td><td id="f9">9</td><td id="f10"></td><td id="f11"></td><td id="f12">12</td></tr>';
    h += fretnumsTop;

    const str = {};
    for (let a = 1; a <= 12; a++) {
      str[a] = String(x.z === 'y' ? x['s' + a] : x['x' + a]).trim();
    }

    for (let a = 1; a <= x.strs; a++) {
      const strizzle = str[a];
      const c = KEYS.indexOf(strizzle.toUpperCase());
      let nutDeg = findKey(x._notedegrees, strizzle.toUpperCase());
      let nutBg = (x['hl_' + flatToB(nutDeg)] === 'y') ? flatToB(nutDeg) : 'no_highlight';
      const f_cyo = (x.z === 'n') ? 'f_cyo_dark' : 'f_cyo';

      h += '<tr>';
      h += '<td id="' + f_cyo + '"><select class="inputs" name="s' + a + '">';
      h += '<option value="' + escHtml(x['s' + a]) + '">' + escHtml(x['s' + a]) + '</option>';
      for (const note of ALLNOTES) {
        h += '<option value="' + escHtml(note) + '">' + escHtml(note) + '</option>';
      }
      h += '</select></td>';
      h += '<td class="nut" id="_' + nutBg + '_">' + escHtml(strizzle) + '(' + escHtml(nutDeg || '') + ')</td>';

      for (let b = 1; b <= 12; b++) {
        const cb = c + b;
        const noteAtFret = KEYS[cb];
        let degAtFret = findKey(x._notedegrees, noteAtFret);
        let fbId = (x['hl_' + flatToB(degAtFret)] === 'y') ? flatToB(degAtFret) : 'no_highlight';
        const cls = (b === 1) ? 'nut1' : 'fb_td';
        h += '<td class="' + cls + '" id="_' + fbId + '_">' + escHtml(noteAtFret) + '(' + escHtml(degAtFret || '') + ')</td>';
      }
      h += '</tr>';
    }

    const fretnumsBot = '<tr id="fretnums"><td id="f_cyo"></td><td id="f0">X</td><td id="f1"></td><td id="f2"></td><td id="f3">3</td><td id="f4"></td><td id="f5">5</td><td id="f6"></td><td id="f7">7</td><td id="f8"></td><td id="f9">9</td><td id="f10"></td><td id="f11"></td><td id="f12">12</td></tr>';
    h += fretnumsBot + '</table>';

    root.innerHTML = h;
  }

  // Mini key picker for the chord-grid / scale-grid / keyboard sections so the
  // user can change key without expanding the fretboard section.
  function keyPickerHtml(x) {
    let h = '<div class="section_key_picker"><label>Key: <select class="inputs" name="k">';
    h += '<option value="' + escHtml(x.k) + '">' + escHtml(x.k) + '</option>';
    for (const a of ALLNOTES) {
      h += '<option value="' + escHtml(a) + '">' + escHtml(a) + '</option>';
    }
    h += '</select></label></div>';
    return h;
  }

  // Each section's title bar gets its own Key dropdown + Clear link, populated
  // here on every render so they stay in sync with the URL state. The Tunings
  // list section (section_5) is intentionally excluded.
  function renderSummaryExtras(x) {
    const slots = document.querySelectorAll('.summary_extras');
    if (!slots.length) return;
    let opts = '<option value="' + escHtml(x.k) + '">' + escHtml(x.k) + '</option>';
    for (const a of ALLNOTES) {
      opts += '<option value="' + escHtml(a) + '">' + escHtml(a) + '</option>';
    }
    const html =
      '<span class="section_key_picker"><label>Key: <select class="inputs" name="k">' +
        opts +
      '</select></label></span>' +
      '<a href="' + escHtml(clearHlHref()) + '" class="section_clear">Clear</a>';
    slots.forEach(function (s) {
      const target = s.getAttribute('data-summary-for');
      // Sections that don't need the Key picker / Clear button:
      //   section_5 = nested tunings list (no chord-state context)
      //   section_8 = tab editor (its own controls bar handles state)
      if (target === 'section_5' || target === 'section_8') { s.innerHTML = ''; return; }
      s.innerHTML = html;
    });
  }

  // Tuning indicator lives next to the Fretboard section title — that's
  // the only place it's relevant. Key shows up in every section's header
  // (key picker), chord/scale shows up in the keyboard + fretboard sections
  // (highlighted chip), so we don't echo any of that here.
  function renderSummaryStatus(x) {
    const tuningName = (x.z === 'y') ? 'Custom' : x.name;
    const tunEl = document.getElementById('fretboard_summary_tuning');
    if (tunEl) {
      tunEl.innerHTML =
        '<span class="st_lab">Tuning</span>' +
        '<span class="st_val">' + escHtml(tuningName) + '</span>';
    }
    // Per-section .summary_status spans stay in the markup as flex spacers
    // (their `flex: 1` rule keeps the title left and buttons right) but no
    // longer carry visible text. Empty them so any prior content clears.
    document.querySelectorAll('.summary_status').forEach(function (s) {
      s.innerHTML = '';
    });
  }

  // Restrict the toggle to clicks on the .summary_title (which now hosts the
  // ▼/▶ arrow via ::before, so the arrow stays clickable). Anywhere else on
  // the summary bar — empty status spacer, button row, or padding around
  // them — is a no-op. Stops the section from collapsing when the user is
  // just trying to click a button or pick a key.
  function bindSummaryToggleScope() {
    document.querySelectorAll('details.collapsible > summary').forEach(function (summary) {
      if (summary._toggleScopeBound) return;
      summary._toggleScopeBound = true;
      summary.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.summary_title')) return;
        e.preventDefault();
      });
    });
  }

  // Stop summary clicks on the dropdown / Clear link from toggling the parent <details>.
  // For the <a> Clear link we ALSO need to drive navigation here, because
  // stopPropagation blocks bindLinkInterceptor from seeing the click.
  function bindSummaryExtras() {
    document.body.addEventListener('mousedown', function (e) {
      if (e.target.closest && e.target.closest('.summary_extras')) e.stopPropagation();
    }, true);
    document.body.addEventListener('click', function (e) {
      const extras = e.target.closest && e.target.closest('.summary_extras');
      if (!extras) return;
      e.stopPropagation();  // don't toggle the parent <details>
      const link = e.target.closest('a');
      if (link) {
        const href = link.getAttribute('href');
        if (href && href.charAt(0) === '?') {
          e.preventDefault();
          navigateTo(href);
        }
      }
    }, true);
  }

  function renderChordGrid(x) {
    const root = document.getElementById('chord_grid_root');
    const i1 = KEYS.indexOf(x.k);
    const noteLetters = {
      _1_:  KEYS[i1],     _b2_: KEYS[i1 + 1], _2_:  KEYS[i1 + 2], _b3_: KEYS[i1 + 3],
      _3_:  KEYS[i1 + 4], _4_:  KEYS[i1 + 5], _b5_: KEYS[i1 + 6], _5_:  KEYS[i1 + 7],
      _b6_: KEYS[i1 + 8], _6_:  KEYS[i1 + 9], _b7_: KEYS[i1 + 10], _7_: KEYS[i1 + 11]
    };

    let chordLinksRow = '<tr id="under_chord_grid"><td></td>';
    for (const a in GRID) {
      const label = a.replace(/b/g, '♭').replace(/#/g, '♯');
      const isSelected = (x.hl_n === a.replace(/_/g, ' '));
      const href = isSelected ? x._hilight_url : (x._hilight_url + hlMultiToCsv(GRID[a]));
      const tdCls = isSelected ? ' class="cg_selected"' : '';
      chordLinksRow += '<td' + tdCls + '><a href="' + href + '">' + escHtml(label) + '</a></td>';
    }
    chordLinksRow += '<td></td></tr>';

    let h = '<table id="chord_grid">';
    h += chordLinksRow;
    for (const row of window.SF_GRID_ROWS) {
      const note = noteLetters[row.degId];
      h += '<tr>';
      h += '<td class="cg_col_left" id="' + row.degId + '">' + escHtml(note) + escHtml(row.intervalLabel) + '</td>';
      for (const cell of row.cells) {
        if (cell === null) {
          h += '<td id="_x_"></td>';
        } else {
          // Fretboard-style: noteLetter(degree). The bookends show the same
          // pair, so each filled cell carries its full identity instead of
          // just the abstract degree number.
          h += '<td id="' + row.degId + '">' + escHtml(note) + '(' + escHtml(cell) + ')</td>';
        }
      }
      h += '<td class="cg_col_right" id="' + row.degId + '">' + escHtml(row.intervalLabel) + escHtml(note) + '</td>';
      h += '</tr>';
    }
    h += chordLinksRow + '</table>';
    root.innerHTML = h;
  }

  function renderScaleGrid(x) {
    const root = document.getElementById('scale_grid_root');
    if (!root) return;
    const i1 = KEYS.indexOf(x.k);
    const noteLetters = {
      _1_:  KEYS[i1],     _b2_: KEYS[i1 + 1], _2_:  KEYS[i1 + 2], _b3_: KEYS[i1 + 3],
      _3_:  KEYS[i1 + 4], _4_:  KEYS[i1 + 5], _b5_: KEYS[i1 + 6], _5_:  KEYS[i1 + 7],
      _b6_: KEYS[i1 + 8], _6_:  KEYS[i1 + 9], _b7_: KEYS[i1 + 10], _7_: KEYS[i1 + 11]
    };

    // Bottom 12 rows of the chord grid — the unison-octave half
    const ROWS = window.SF_GRID_ROWS.slice(12);

    // Parse SCALES["..."] = "&hl=1&hl=2&hl=b3..." into a Set of degree symbols
    const scaleDegrees = {};
    for (const name in SCALES) {
      const degs = SCALES[name].split('&hl=').slice(1)
        .map(function (s) { return s.replace(/&/g, ''); })
        .filter(function (s) { return s.length > 0; })
        .map(function (s) { return s.replace(/b/g, '♭'); });
      scaleDegrees[name] = degs;
    }

    let scaleLinksRow = '<tr id="under_scale_grid"><td></td>';
    for (const name in SCALES) {
      const label = name.replace(/_/g, ' ');
      const isSelected = (x.hl_n === label);
      const href = isSelected ? x._hilight_url : (x._hilight_url + hlMultiToCsv(SCALES[name]));
      const tdCls = isSelected ? ' class="cg_selected"' : '';
      scaleLinksRow += '<td' + tdCls + '><a href="' + href + '">' + escHtml(label) + '</a></td>';
    }
    scaleLinksRow += '<td></td></tr>';

    let h = '<table id="scale_grid">';
    h += scaleLinksRow;
    for (const row of ROWS) {
      const note = noteLetters[row.degId];
      const degSym = row.intervalLabel.replace(/[()]/g, '');
      h += '<tr>';
      h += '<td class="cg_col_left" id="' + row.degId + '">' + escHtml(note) + escHtml(row.intervalLabel) + '</td>';
      for (const scaleName in SCALES) {
        if (scaleDegrees[scaleName].indexOf(degSym) !== -1) {
          // Fretboard-style label: noteLetter(degree)
          h += '<td id="' + row.degId + '">' + escHtml(note) + '(' + escHtml(degSym) + ')</td>';
        } else {
          h += '<td id="_x_"></td>';
        }
      }
      h += '<td class="cg_col_right" id="' + row.degId + '">' + escHtml(row.intervalLabel) + escHtml(note) + '</td>';
      h += '</tr>';
    }
    h += scaleLinksRow + '</table>';
    root.innerHTML = h;
  }

  function renderTuningsTable(x) {
    const root = document.getElementById('tunings_root');
    const rev = (x.y === 'y') ? 'rev_' : '';
    const tunUrl = x._self + x.url_k + x.url_y + x.url_z + x.url_s + x.url_hl;

    let h = '';
    h += '<input type="text" id="filter" class="inputs" placeholder="Filter" maxlength="64" value="' + escHtml(x._filter || '') + '">';
    h += '<table class="sortable" id="tunings">';
    h += '<thead><tr>';
    h += '<th width="10%" class="name"><button>Strings<span aria-hidden="true"></span></button></th>';
    h += '<th width="12%" class="name"><button>Name<span aria-hidden="true"></span></button></th>';
    h += '<th width="20%"><button>Tuning<span aria-hidden="true"></span></button></th>';
    h += '<th width="16%"><button>Degrees<span aria-hidden="true"></span></button></th>';
    h += '<th width="16%"><button>Unique Degrees<span aria-hidden="true"></span></button></th>';
    h += '<th width="26%"><button>Notes<span aria-hidden="true"></span></button></th>';
    h += '</tr></thead><tbody>';
    for (const key in TUNINGS) {
      const v = TUNINGS[key];
      // Compute fresh in the new 's'-for-sharp format; data.js still ships
      // the legacy %23-encoded url_notes field.
      const addUrl = '&x=' + urlNote(v.notes);
      let udgs = String(v.udgs).replace('1 3 5', '(1 3 5)').replace('1 ♭3 5', '(1 ♭3 5)');
      const trCls = (key === x.x) ? ' class="tun_selected"' : '';
      h += '<tr' + trCls + '>';
      h += '<td id="pad" class="name">' + v.strs + '-String</td>';
      h += '<td id="pad" class="name"><a href="' + tunUrl + addUrl + '">' + escHtml(v.name) + '</a></td>';
      h += '<td id="pad"><a href="' + tunUrl + addUrl + '">' + escHtml(v[rev + 'notes']) + '</a></td>';
      h += '<td id="pad">' + escHtml(v[rev + 'dgs']) + '</td>';
      h += '<td id="pad">' + escHtml(udgs) + '</td>';
      h += '<td id="pad">' + escHtml(v.info) + '</td>';
      h += '</tr>';
    }
    h += '</tbody></table>';
    root.innerHTML = h;
  }

  // ---------- About / per-section help popups ----------
  const SECTION_HELP = {
    fretboard: [
      '',
      '  ███████ ██       █████  ███    ██ ████████ ███████ ██ ███    ██ ██████  ███████ ██████',
      '  ██      ██      ██   ██ ████   ██    ██    ██      ██ ████   ██ ██   ██ ██      ██   ██',
      '  ███████ ██      ███████ ██ ██  ██    ██    █████   ██ ██ ██  ██ ██   ██ █████   ██████',
      '       ██ ██      ██   ██ ██  ██ ██    ██    ██      ██ ██  ██ ██ ██   ██ ██      ██   ██',
      '  ███████ ███████ ██   ██ ██   ████    ██    ██      ██ ██   ████ ██████  ███████ ██   ██ .pro',
      '',
      '  <<<:::-----       SlantFinder.pro       -----:::>>>',
      '',
      '  Fretboard visualization tool for 6-, 8-, 10-, and 12-string steel guitars.',
      '',
      '  How to use:',
      '    • Click the tuning field to open the picker — sortable / filterable',
      '      table of every preset, with one-tap radios for 6 / 8 / 10 / 12 string.',
      '    • The Custom Tuning toggle at the top-left of the fretboard turns on',
      '      per-string note dropdowns so you can roll your own tuning.',
      '    • The L→H / H→L button next to the tuning field flips the string',
      '      order shown in the indicators and the tunings list.',
      '    • Click a degree pill (1, ♭2, 2, ..., 7) above the fretboard or above',
      '      the keyboard to highlight those degrees. Pills colour themselves to',
      '      match each degree. Click All to flip every degree on, None / Clear',
      '      to drop them.',
      '    • Click any chord or scale chip above the fretboard or keyboard to',
      '      highlight the degrees for that chord/scale.',
      '    • Print: each section has its own Print button that prints just',
      '      that section. Highlight colours are always preserved on paper.',
      '',
      '  URL state:',
      '    Every selection (tuning, key, custom strings, highlights, collapsed',
      '    sections, sort order, filter) lives in the URL, so any view is',
      '    bookmarkable and shareable. Sharps encode as lowercase "s"',
      '    (Fs = F♯) and flats as lowercase "b" (Bb = B♭).',
      '',
      '  Designed for screens 1024px+. The chord and scale builders, keyboard,',
      '  and learn quiz hide on smaller viewports because the fretboard is wide',
      '  and steel players are old.',
      '',
      '  Excluding: ads, pop-ups, sign-ups, tracking, cookies, copyrights,',
      '  subscriptions, images, bloat.',
      '',
      '  Hello? is this thing on? Oh well.',
      '',
      '  Suggestions, corrections, additions:',
      '    https://bb.steelguitarforum.com/viewtopic.php?t=396088',
      ''
    ].join('\n'),

    chord_grid: [
      '',
      '  Chord Builder Grid',
      '',
      '  Each column is a chord type; each row is one degree of the scale.',
      '  A filled cell means that degree is part of that chord, colored to match',
      '  the degree color used everywhere else on the site.',
      '',
      '  Bookend columns (left and right) show the actual note name for each',
      '  degree in the current key. Change the key (top-right of this section,',
      '  or in the form above the fretboard) and the bookends update.',
      '',
      '  Click any chord name at the top or bottom of the grid to highlight',
      '  that chord on the fretboard — the keyboard section also fades every',
      '  note that is not part of that chord, so the chord notes pop across',
      '  the whole 88-note span. The chord-name buttons are themselves',
      '  background-colored by the degree that defines that chord type:',
      '    Maj → 3 (orange)        Min → ♭3 (beige)',
      '    aug → ♭6 (green)        dim → ♭5 (blue)',
      '    sus2 → 2 (purple)       sus4 → 4 (cyan)',
      '    6/13 chords → 6 (green)',
      '    7-family → ♭7 (wine)    Maj7 / min-Maj7 → 7 (magenta)',
      '    9-family → 2 (purple)   ♭9 → ♭2 (violet)   ♯9 → ♭3 (beige)',
      '    11-family → 4 (cyan)    ♯11 → ♭5 (blue)',
      ''
    ].join('\n'),

    scale_grid: [
      '',
      '  Scale Builder Grid',
      '',
      '  One row per degree of the octave, one column per scale (16 in total):',
      '    • The seven modes of major (Ionian / Dorian / Phrygian / Lydian /',
      '      Mixolydian / Aeolian / Locrian)',
      '    • Melodic Minor and Harmonic Minor',
      '    • Phrygian Dominant and Hungarian Minor',
      '    • Major Pentatonic, Minor Pentatonic, Blues',
      '    • Whole Tone, Diminished',
      '',
      '  Filled cells mark which degrees belong to each scale, colored by the',
      '  degree. Bookend columns show the note name for each degree in the',
      '  current key.',
      '',
      '  Click any scale name at the top or bottom of the grid to highlight',
      '  that scale on the fretboard — the keyboard section also fades every',
      '  note outside the scale, so the scale notes pop across the whole',
      '  88-note span.',
      '',
      '  Note: scales that include ♯4, ♯5, or ♯6 (Lydian, Hungarian Minor,',
      '  Whole Tone) display the enharmonic equivalents ♭5, ♭6, ♭7 because',
      '  the 12-tone degree alphabet only has one slot per pitch class.',
      ''
    ].join('\n'),

    keyboard: [
      '',
      '  Keyboard',
      '',
      '  Piano keyboard from A0 to C8, with octave numbers, frequencies in Hz,',
      '  and steel string gauges that target each note. The 10-band EQ row',
      '  shows which frequency centers each band covers.',
      '',
      '  By default the keyboard reads as a real piano (white keys white,',
      '  black keys dark) with a small degree label below each note name.',
      '  When you highlight one or more degrees, only the matching notes pick',
      '  up their degree colour — every other note keeps the plain piano look',
      '  with a dim grey label so the chosen notes pop. The full degree-',
      '  coloured rainbow only appears when every degree is highlighted.',
      '',
      '  The highlight pills + chord/scale chip rows above the keys mirror',
      '  the ones above the fretboard, so you can drive selections from this',
      '  section even when the fretboard is collapsed.',
      ''
    ].join('\n'),

    tunings: [
      '',
      '  Tunings List',
      '',
      '  172 tunings for 6-, 8-, 10-, and 12-string steel guitars.',
      '',
      '    • Click any column header to sort. Click the same header again to',
      '      reverse direction.',
      '    • Type in the filter box to narrow the list — matches across name,',
      '      notes, degrees, info, and string count.',
      '    • Click a tuning row to load that tuning into the fretboard,',
      '      keeping the current key and highlights.',
      '    • Click CSV in the section header to download the visible (sorted +',
      '      filtered) tunings as a comma-separated file.',
      '',
      '  Sort and filter state live in the URL, so a sorted/filtered view is',
      '  bookmarkable.',
      ''
    ].join('\n'),

    tab: [
      '',
      '  Tab',
      '',
      '  In-page tab editor for 4–12 string instruments.',
      '',
      '    • Pick a string count and (optionally) a preset tuning — the',
      '      tuning dropdown is filtered to presets that match the count.',
      '    • String labels on the left edge are editable: type any note',
      '      directly, or press ↑ / ↓ to move focus to the next string above',
      '      or below; Enter drops into the first cell on the same row.',
      '    • Type a fret number (0–99) into a cell, or use a symbol:',
      '      h hammer, p pull, / slide up, \\\\ slide down, ~ vibrato, x mute.',
      '    • Cell navigation: Tab moves right, Enter moves down, arrow keys',
      '      go any direction.',
      '    • ⇅ flip strings reverses the row order if you prefer the highest',
      '      pitch on the bottom.',
      '',
      '  Print outputs whatever you have written. Print blank ignores the',
      '  current grid and prints a full landscape sheet of empty staves at',
      '  the chosen string count for handwriting — no bar-lines, no measure',
      '  numbers, just blank staves.',
      ''
    ].join('\n'),

    learn: [
      '',
      '  Learn',
      '',
      '  Endless random quiz with three rotating question types:',
      '',
      '    1. Show degrees, name the scale.',
      '         e.g.  "1 2 ♭3 4 5 6 ♭7"  →  Dorian',
      '',
      '    2. Show degrees, name the chord.',
      '         e.g.  "1 3 5 ♭7"  →  dom7',
      '',
      '    3. Show notes in a specific key, name the scale or chord.',
      '         e.g.  "In C, what scale is C D E F G A B?"  →  Major',
      '',
      '  Multiple choice with three plausible distractors from the same family',
      '  as the answer. Click an answer — the button turns green for correct,',
      '  red for wrong. There is no score, no answer reveal, no round limit.',
      '  Click Next to draw a fresh question.',
      ''
    ].join('\n')
  };

  function closeViewSourceModal() {
    const m = document.getElementById('view_source_modal');
    if (m) m.remove();
    document.removeEventListener('keydown', escClose);
  }
  function escClose(e) {
    if (e.key === 'Escape') closeViewSourceModal();
  }
  function showInfoModal(content, opts) {
    closeViewSourceModal();
    const overlay = document.createElement('div');
    overlay.id = 'view_source_modal';
    if (opts && opts.className) overlay.className = opts.className;
    overlay.innerHTML =
      '<div class="vs_backdrop"></div>' +
      '<div class="vs_panel" role="dialog" aria-label="About">' +
        '<button class="vs_close" type="button" aria-label="Close">×</button>' +
        '<pre class="vs_pre"></pre>' +
      '</div>';
    const pre = overlay.querySelector('.vs_pre');
    if (opts && opts.html) {
      pre.innerHTML = content;
    } else {
      pre.textContent = content;
    }
    overlay.querySelector('.vs_backdrop').addEventListener('click', closeViewSourceModal);
    overlay.querySelector('.vs_close').addEventListener('click', closeViewSourceModal);
    document.body.appendChild(overlay);

    // Optional anchor: position the panel near the cursor (used by the
    // Witherfork footer popup). Clamps inside the viewport so a click near
    // an edge doesn't push the panel off-screen.
    if (opts && opts.anchor) {
      const panel = overlay.querySelector('.vs_panel');
      const margin = 12;
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = opts.anchor.x - w / 2;
      let top  = opts.anchor.y - h - margin;       // prefer above the cursor
      if (top < margin) top = opts.anchor.y + margin;  // not enough room above → below
      left = Math.max(margin, Math.min(left, vw - w - margin));
      top  = Math.max(margin, Math.min(top,  vh - h - margin));
      panel.style.position = 'fixed';
      panel.style.left = left + 'px';
      panel.style.top  = top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.transform = 'none';
    }

    document.addEventListener('keydown', escClose);
  }

  function bindFooterWitherfork() {
    const link = document.getElementById('footer_witherfork');
    if (!link || link._wfBound) return;
    link._wfBound = true;
    link.addEventListener('click', function (e) {
      e.preventDefault();
      const html =
        '<a class="wf_link" href="https://seadisco.com" target="_blank" rel="noopener noreferrer">SeaDisco.com</a>';
      showInfoModal(html, {
        html: true,
        className: 'wf_compact',
        anchor: { x: e.clientX, y: e.clientY }
      });
    });
  }

  function printSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    let restoreClosed = false;
    if (section.tagName === 'DETAILS' && !section.open) {
      restoreClosed = true;
      section.open = true;
    }
    document.body.setAttribute('data-print', sectionId);
    function cleanup() {
      document.body.removeAttribute('data-print');
      if (restoreClosed) section.open = false;
      window.removeEventListener('afterprint', cleanup);
    }
    window.addEventListener('afterprint', cleanup);
    setTimeout(function () { window.print(); }, 50);
  }

  function bindPrintButtons() {
    document.querySelectorAll('.section_print').forEach(function (btn) {
      if (btn._printBtnBound) return;
      btn._printBtnBound = true;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        const sectionId = btn.getAttribute('data-print-section');
        if (sectionId) printSection(sectionId);
      });
    });
  }

  // Quote a value per RFC 4180 — wrap in double quotes if it contains a
  // comma, quote, or newline; double up any internal quotes.
  function csvQuote(v) {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Build a CSV from the *visible* rows of the on-page tunings table, so the
  // user's current sort + filter (and the section's own filter input) are
  // honoured. Falls back to dumping the full TUNINGS object if the table
  // hasn't rendered yet.
  function buildTuningsCsv() {
    const cols = ['Strings', 'Name', 'Notes', 'Notes (Reverse)', 'Degrees', 'Degrees (Reverse)', 'Info'];
    const lines = [cols.map(csvQuote).join(',')];
    const table = document.getElementById('tunings');
    if (table) {
      // Use the table rows that are currently rendered + visible (filter
      // hides rows via display:none).
      table.querySelectorAll('tbody tr').forEach(function (tr) {
        if (tr.offsetParent === null && tr.style.display === 'none') return;
        const cells = tr.querySelectorAll('td');
        if (!cells.length) return;
        const row = Array.prototype.map.call(cells, function (td) {
          return csvQuote(td.textContent.trim());
        });
        lines.push(row.join(','));
      });
    } else {
      Object.keys(TUNINGS).forEach(function (key) {
        const t = TUNINGS[key];
        lines.push([t.strs, t.name, t.notes, t.rev_notes, t.dgs, t.rev_dgs, t.info || '']
          .map(csvQuote).join(','));
      });
    }
    return lines.join('\r\n');
  }

  function downloadCsv(filename, content) {
    const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 200);
  }

  function bindExportButtons() {
    document.querySelectorAll('.section_export').forEach(function (btn) {
      if (btn._exportBound) return;
      btn._exportBound = true;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        if (btn.getAttribute('data-export') === 'tunings') {
          const stamp = new Date().toISOString().slice(0, 10);
          downloadCsv('slantfinder-tunings-' + stamp + '.csv', buildTuningsCsv());
        }
      });
    });
  }

  function bindHelpButtons() {
    document.querySelectorAll('.section_help').forEach(function (btn) {
      if (btn._helpBound) return;
      btn._helpBound = true;
      btn.addEventListener('click', function (e) {
        // Stop the click from bubbling up to <summary> (which would toggle the section)
        e.stopPropagation();
        e.preventDefault();
        const key = btn.getAttribute('data-help');
        showInfoModal(SECTION_HELP[key] || '');
      });
    });
  }

  // ---------- auto-submit on any control change ----------
  function gatherAndNavigate() {
    const opt = document.getElementById('options_root');
    const fb = document.getElementById('fretboard_root');
    const parts = [];

    function pushSelect(sel) {
      if (!sel || !sel.name) return;
      // Sharps emit as 's' (lowercase), no encoding needed. Flats emit as 'b'.
      // Decoder accepts both 's' and legacy '%23' so old links still work.
      const v = urlNote(sel.value);
      parts.push(sel.name + '=' + v);
    }
    pushSelect(opt.querySelector('select[name="x"]'));
    // Key dropdown lives in each section's title bar (.section_key_picker) since
    // the form no longer has its own. Read from any of them — bindAutoSubmit's
    // sync handler keeps every section's key picker at the same value.
    pushSelect(document.querySelector('.section_key_picker select[name="k"]'));

    // y (low/high direction) and z (custom-tuning toggle) are now link-
    // driven switches, not checkboxes — they live entirely in the URL.
    // Carry whatever the URL has so changing a string-note dropdown
    // doesn't accidentally drop "z=y" and disengage custom tuning.
    const _curParams = new URLSearchParams(window.location.search);
    ['y', 'z'].forEach(function (name) {
      const v = _curParams.get(name);
      if (v === 'y') parts.push(name + '=y');
    });

    // Highlight pills are link-driven; carry whatever's currently in the URL
    // so other form controls don't drop the active highlights. Emit as a
    // single comma-separated `hl=` value (parseState accepts the legacy
    // multi-key form too).
    const hlList = readHlParam(new URLSearchParams(window.location.search));
    if (hlList.length) parts.push('hl=' + hlList.join(','));

    // Custom-tuning strings combined into one dot-separated `s=` param.
    if (fb) {
      const sels = fb.querySelectorAll('select[name^="s"]');
      const sVals = [];
      sels.forEach(function (sel) {
        const m = sel.name && sel.name.match(/^s(\d+)$/);
        if (!m) return;
        sVals[parseInt(m[1], 10) - 1] = urlNote(sel.value);
      });
      while (sVals.length && !sVals[sVals.length - 1]) sVals.pop();
      if (sVals.length) parts.push('s=' + sVals.map(function (v) { return v || ''; }).join('.'));
    }

    navigateTo('?' + parts.join('&'));
  }

  function navigateTo(search) {
    if (search === window.location.search) return;
    // '?' with no params → strip the query entirely so the URL bar isn't littered
    const target = (search === '?' || search === '') ? window.location.pathname : search;
    // Preserve scroll across the re-render — pushState shouldn't move the page,
    // but some layout shifts during innerHTML swaps can cause a jump.
    const sx = window.scrollX || window.pageXOffset || 0;
    const sy = window.scrollY || window.pageYOffset || 0;
    history.pushState({}, '', target);
    applyState();
    window.scrollTo(sx, sy);
  }

  function bindAutoSubmit() {
    const handler = function (e) {
      // Sync every section's key picker to whichever one the user just changed,
      // so gatherAndNavigate picks up the new value no matter which it reads.
      if (e && e.target && e.target.matches && e.target.matches('select[name="k"]')) {
        document.querySelectorAll('.section_key_picker select[name="k"]').forEach(function (sel) {
          if (sel !== e.target) sel.value = e.target.value;
        });
      }
      gatherAndNavigate();
    };
    document.querySelectorAll(
      '#options_root select, #options_root input[type="checkbox"], #fretboard_root select, .section_key_picker select[name="k"]'
    ).forEach(function (el) {
      el.addEventListener('change', handler);
    });
  }

  // Intercept clicks on any same-page link so we update via pushState
  // instead of triggering a full page navigation. Catches both '?foo=bar'
  // hrefs AND bare-pathname hrefs (which fire when, say, deselecting the last
  // highlight pill empties the query string and the helper returns the path).
  function bindLinkInterceptor() {
    document.body.addEventListener('click', function (e) {
      const a = e.target.closest && e.target.closest('a');
      if (!a) return;
      // Honor modifier-clicks (open in new tab/window) and middle-click
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
      const raw = a.getAttribute('href');
      if (!raw) return;
      let url;
      try { url = new URL(a.href, window.location.href); } catch (_) { return; }
      // External or different-page links: let the browser handle them.
      if (url.origin !== window.location.origin) return;
      if (url.pathname !== window.location.pathname) return;
      // Same-page nav: route through pushState so we don't reload / scroll.
      e.preventDefault();
      navigateTo(url.search || '?');
    });
  }

  // ---------- print colors (always on) ----------
  function applyPrintColors() {
    document.body.classList.add('print-colors');
  }

  // ---------- tunings sort + filter (URL-backed) ----------
  function applyTuningsSort(x) {
    if (!x._sort) return;
    const table = document.getElementById('tunings');
    if (!table || !table._sortableInstance) return;
    const ths = table.querySelectorAll('thead th');
    const col = x._sort.col;
    if (col < 0 || col >= ths.length) return;
    const ariaSort = x._sort.dir === 'd' ? 'descending' : 'ascending';
    ths.forEach(function (t) { t.removeAttribute('aria-sort'); });
    ths[col].setAttribute('aria-sort', ariaSort);
    table._sortableInstance.sortColumn(col, ariaSort, ths[col].classList.contains('num'));
  }

  function bindTuningsSortObserver() {
    const table = document.getElementById('tunings');
    if (!table) return;
    table.querySelectorAll('thead th button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        // SortableTable's handler runs first (bound earlier); we read aria-sort after
        const ths = table.querySelectorAll('thead th');
        let col = -1, dir = null;
        for (let i = 0; i < ths.length; i++) {
          const a = ths[i].getAttribute('aria-sort');
          if (a) { col = i; dir = a === 'descending' ? 'd' : 'a'; break; }
        }
        const params = new URLSearchParams(window.location.search);
        if (col >= 0 && dir) params.set('sort', col + ':' + dir);
        else params.delete('sort');
        const qs = params.toString();
        history.replaceState({}, '', qs ? '?' + qs : window.location.pathname);
      });
    });
  }

  function applyTuningsFilter(value) {
    const table = document.getElementById('tunings');
    if (!table) return;
    const f = String(value || '').toUpperCase();
    table.querySelectorAll('tbody tr').forEach(function (tr) {
      const td = tr.querySelector('td');
      if (!td) return;
      const text = (td.textContent || '').toUpperCase();
      tr.style.display = (!f || text.indexOf(f) > -1) ? '' : 'none';
    });
  }

  let _filterDebounce = null;
  function bindTuningsFilter() {
    const input = document.getElementById('filter');
    if (!input) return;
    // Apply current filter on render
    applyTuningsFilter(input.value);
    input.addEventListener('input', function () {
      // Cap length defensively (matches the maxlength attr; user can paste over)
      const value = String(input.value || '').slice(0, 64);
      if (input.value !== value) input.value = value;
      applyTuningsFilter(value);
      if (_filterDebounce) clearTimeout(_filterDebounce);
      _filterDebounce = setTimeout(function () {
        const params = new URLSearchParams(window.location.search);
        if (value) params.set('f', value); else params.delete('f');
        const qs = params.toString();
        history.replaceState({}, '', qs ? '?' + qs : window.location.pathname);
      }, 300);
    });
  }

  // ---------- collapsible-section state persistence ----------
  // URL is the source of truth: ?c=2,3 means sections 2 and 3 are closed.
  // localStorage is kept as a fallback when the URL has no 'c' param, so a
  // user who collapses a section then revisits without a query string still
  // gets their preferred view.

  function applyCollapseFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const cParam = params.get('c');
    const fromUrl = cParam !== null;
    const closedSet = fromUrl ? new Set(cParam.split(',').filter(function (s) { return s.length; })) : null;

    document.querySelectorAll('details.collapsible').forEach(function (d) {
      const num = d.id.replace('section_', '');
      let isClosed;
      if (fromUrl) {
        isClosed = closedSet.has(num);
      } else {
        let saved = null;
        try { saved = window.localStorage.getItem('sf_collapse_' + d.id); } catch (e) {}
        if (saved === null) {
          // First visit (no URL state, no localStorage memory): every main
          // section opens, but the nested Tunings List starts collapsed so
          // the page isn't dominated by the 172-row table on load.
          isClosed = (d.id === 'section_5');
        } else {
          isClosed = saved === 'closed';
        }
      }
      if (isClosed) d.removeAttribute('open'); else d.setAttribute('open', '');
    });
  }

  function updateClosedInUrl() {
    const params = new URLSearchParams(window.location.search);
    const closed = [];
    document.querySelectorAll('details.collapsible').forEach(function (d) {
      if (!d.open) closed.push(d.id.replace('section_', ''));
    });
    if (closed.length) params.set('c', closed.join(','));
    else params.delete('c');
    const qs = params.toString();
    const target = qs ? '?' + qs : window.location.pathname;
    if (target === window.location.pathname + window.location.search) return;
    if (target === window.location.search) return;
    // replaceState — don't pollute history with every collapse toggle
    history.replaceState({}, '', target);
  }

  function bindCollapsibles() {
    document.querySelectorAll('details.collapsible').forEach(function (d) {
      if (d._collapseBound) return;
      d._collapseBound = true;
      d.addEventListener('toggle', function () {
        try { window.localStorage.setItem('sf_collapse_' + d.id, d.open ? 'open' : 'closed'); } catch (e) {}
        updateClosedInUrl();
      });
    });

    // Force the fretboard open during print so collapsed-state doesn't suppress it
    const fb = document.getElementById('section_2');
    if (fb && !fb._printBound) {
      fb._printBound = true;
      let restoreClosed = false;
      window.addEventListener('beforeprint', function () {
        restoreClosed = !fb.open;
        if (restoreClosed) fb.open = true;
      });
      window.addEventListener('afterprint', function () {
        if (restoreClosed) fb.open = false;
      });
    }
  }

  // ---------- keyboard color override (per current key) ----------
  // Map each note to the keyboard cell classes that visually represent it.
  // White-note positions get a background color; black-note positions get a text color
  // (the cell itself stays dark, only the "A♯" / "C♯" / etc. label gets tinted).
  // `cls`  = every cell that should pick up the bg/color tint for this note
  //          (white-note columns also tint a small spacer cell on the black-key
  //          row above so the column reads as one tinted strip).
  // `lbl`  = the subset of those cells that actually display the note letter
  //          (e.g. "A", "C♯"). Only these get the `::after` degree label so we
  //          don't print the degree twice on white keys (once on the spacer
  //          above and once on the white-key cell below).
  const KEYBOARD_NOTE_CLASSES = {
    'A':  { mode: 'bg',    cls: ['s32', 's47'], lbl: ['s47'] },
    'B':  { mode: 'bg',    cls: ['s34', 's48'], lbl: ['s48'] },
    'C':  { mode: 'bg',    cls: ['s35', 's49'], lbl: ['s49'] },
    'D':  { mode: 'bg',    cls: ['s37', 's50'], lbl: ['s50'] },
    'E':  { mode: 'bg',    cls: ['s39', 's51'], lbl: ['s51'] },
    'F':  { mode: 'bg',    cls: ['s40', 's52'], lbl: ['s52'] },
    'G':  { mode: 'bg',    cls: ['s42', 's53'], lbl: ['s53'] },
    'A♯': { mode: 'color', cls: ['s33', 's44'], lbl: ['s33', 's44'] },
    'C♯': { mode: 'color', cls: ['s36', 's45'], lbl: ['s36', 's45'] },
    'D♯': { mode: 'color', cls: ['s38'],        lbl: ['s38'] },
    'F♯': { mode: 'color', cls: ['s41'],        lbl: ['s41'] },
    'G♯': { mode: 'color', cls: ['s43'],        lbl: ['s43'] }
  };
  const KEYBOARD_DEGREE_COLORS = {
    '1':  '#ff0000', '♭2': '#674ea7', '2':  '#9900ff',
    '♭3': '#f6b26b', '3':  '#ff6d01', '4':  '#00ffff',
    '♭5': '#3d85c6', '5':  '#0000ff',
    '♭6': '#6aa84f', '6':  '#0cc016',
    '♭7': '#a64d79', '7':  '#ff00ff'
  };

  function applyKeyboardColors(x) {
    let style = document.getElementById('keyboard_dynamic_style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'keyboard_dynamic_style';
      document.head.appendChild(style);
    }
    // If any highlights are set, dim notes outside the set so the chosen ones pop.
    // White keys dimmed → plain white bg with text close to white (label fades).
    // Black keys dimmed → label color close to the dark cell bg (also fades).
    const anyHighlighted = DEGREES.some(function (d) {
      return x['hl_' + d.replace('♭', 'b')] === 'y';
    });
    // Real piano: white keys are white, black keys are dark. Dimmed = label fades into bg.
    // Match the fretboard's light-grey "tabletop" so both reference surfaces feel the same.
    const DIM_WHITE_BG    = '#cccccc';
    const DIM_WHITE_TEXT  = '#888888';   // readable medium grey on the light bg
    const DIM_BLACK_TEXT  = '#3a3a3a';   // visible-but-quiet on the dark cell bg

    // Plain-piano colours used when no highlights are set: clean white keys
    // with black text + dark black keys with white text. The degree label
    // below each note stays so users still see the relationship to the
    // current key, just rendered in a neutral muted tone.
    const PLAIN_WHITE_BG   = '#f4f4f4';
    const PLAIN_WHITE_TEXT = '#111';
    const PLAIN_BLACK_BG   = '#1a1a1a';
    const PLAIN_BLACK_TEXT = '#f4f4f4';
    const PLAIN_DEG_ON_WHITE = '#666';
    const PLAIN_DEG_ON_BLACK = '#bbb';

    const i1 = KEYS.indexOf(x.k);
    let css = '';
    for (const note in KEYBOARD_NOTE_CLASSES) {
      const noteIdx = KEYS.indexOf(note);
      const semi = ((noteIdx - i1) + 12) % 12;
      const deg = DEGREES[semi];
      const inHighlightSet = anyHighlighted && (x['hl_' + deg.replace('♭', 'b')] === 'y');
      const def = KEYBOARD_NOTE_CLASSES[note];

      def.cls.forEach(function (c) {
        const sel = '.ritz .waffle .' + c;
        if (def.mode === 'bg') {
          // White-key column.
          if (inHighlightSet) {
            // Highlighted note: degree-coloured bg + dark label.
            css += sel + ' { background-color: ' + KEYBOARD_DEGREE_COLORS[deg] + ' !important; '
                  +       'color: #000 !important; }\n';
          } else if (anyHighlighted) {
            // Some other note is highlighted: keep the plain white bg but
            // dim the label to a middle grey so the highlighted notes pop.
            css += sel + ' { background-color: ' + PLAIN_WHITE_BG + ' !important; '
                  +       'color: ' + DIM_WHITE_TEXT + ' !important; }\n';
          } else {
            // No highlights anywhere: plain piano look.
            css += sel + ' { background-color: ' + PLAIN_WHITE_BG + ' !important; '
                  +       'color: ' + PLAIN_WHITE_TEXT + ' !important; }\n';
          }
        } else {
          // Black-key cell.
          if (inHighlightSet) {
            css += sel + ' { background-color: ' + PLAIN_BLACK_BG + ' !important; '
                  +       'color: ' + KEYBOARD_DEGREE_COLORS[deg] + ' !important; }\n';
          } else if (anyHighlighted) {
            // Dim non-highlighted black keys' labels to the same middle grey.
            css += sel + ' { background-color: ' + PLAIN_BLACK_BG + ' !important; '
                  +       'color: ' + DIM_BLACK_TEXT + ' !important; }\n';
          } else {
            css += sel + ' { background-color: ' + PLAIN_BLACK_BG + ' !important; '
                  +       'color: ' + PLAIN_BLACK_TEXT + ' !important; }\n';
          }
        }
      });

      // Add the degree (e.g. "1", "♭3") on a second line below the note label.
      // Only on cells that actually carry the note letter (avoids duplicate
      // labels on the spacer cells above each white key).
      (def.lbl || def.cls).forEach(function (c) {
        const sel = '.ritz .waffle .' + c;
        let degColor;
        if (def.mode === 'bg') {
          degColor = inHighlightSet     ? '#000'
                   : anyHighlighted     ? DIM_WHITE_TEXT
                                        : PLAIN_DEG_ON_WHITE;
        } else {
          degColor = inHighlightSet     ? KEYBOARD_DEGREE_COLORS[deg]
                   : anyHighlighted     ? DIM_BLACK_TEXT
                                        : PLAIN_DEG_ON_BLACK;
        }
        css += sel + '::after { content: "' + escapeCssString(deg) + '"; display: block; '
                  +  'font-size: 0.78em; line-height: 1; opacity: 0.85; '
                  +  'color: ' + degColor + '; }\n';
      });
    }
    style.textContent = css;
  }

  // ---------- learn / quiz ----------
  let _quizCurrent = null;

  function _qDegList(hl) {
    return hl.split('&hl=').slice(1).filter(function (s) { return s.length; }).map(function (s) { return s.replace(/b/g, '♭'); });
  }
  function _qPrettyChord(s) { return s.replace(/b/g, '♭').replace(/#/g, '♯'); }
  function _qPrettyScale(s) { return s.replace(/_/g, ' '); }
  function _qPickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function _qPickN(arr, n) {
    const copy = arr.slice();
    const out = [];
    while (out.length < n && copy.length) {
      out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    }
    return out;
  }
  function _qShuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function generateQuizQuestion() {
    const r = Math.random();
    if (r < 0.34) return _qScaleByDegrees();
    if (r < 0.67) return _qChordByDegrees();
    return _qInKey();
  }

  function _qScaleByDegrees() {
    const names = Object.keys(SCALES);
    const target = _qPickRandom(names);
    const distractors = _qPickN(names.filter(function (n) { return n !== target; }), 3);
    const choices = _qShuffle([target].concat(distractors)).map(_qPrettyScale);
    return {
      prompt: 'Which scale has these degrees?',
      showcase: _qDegList(SCALES[target]).join('  '),
      choices: choices,
      answer: _qPrettyScale(target)
    };
  }

  function _qChordByDegrees() {
    const names = Object.keys(GRID);
    const target = _qPickRandom(names);
    const distractors = _qPickN(names.filter(function (n) { return n !== target; }), 3);
    const choices = _qShuffle([target].concat(distractors)).map(_qPrettyChord);
    return {
      prompt: 'Which chord has these degrees?',
      showcase: _qDegList(GRID[target]).join('  '),
      choices: choices,
      answer: _qPrettyChord(target)
    };
  }

  function _qInKey() {
    const key = _qPickRandom(ALLNOTES);
    const isScale = Math.random() < 0.5;
    const pool = isScale ? SCALES : GRID;
    const names = Object.keys(pool);
    const target = _qPickRandom(names);
    const distractors = _qPickN(names.filter(function (n) { return n !== target; }), 3);
    const fmt = isScale ? _qPrettyScale : _qPrettyChord;
    const choices = _qShuffle([target].concat(distractors)).map(fmt);

    const i1 = KEYS.indexOf(key);
    const degs = _qDegList(pool[target]);
    const notes = degs.map(function (d) {
      return KEYS[i1 + DEGREES.indexOf(d)];
    }).join('  ');

    return {
      prompt: 'In the key of ' + key + ', which ' + (isScale ? 'scale' : 'chord') + ' has these notes?',
      showcase: notes,
      choices: choices,
      answer: fmt(target)
    };
  }

  function renderQuiz() {
    const root = document.getElementById('quiz_root');
    if (!root) return;
    const q = generateQuizQuestion();
    _quizCurrent = q;
    let h = '<div class="quiz_card">';
    h += '<div class="quiz_prompt">' + escHtml(q.prompt) + '</div>';
    h += '<div class="quiz_showcase">' + escHtml(q.showcase) + '</div>';
    h += '<div class="quiz_choices">';
    q.choices.forEach(function (c) {
      h += '<button type="button" class="quiz_choice">' + escHtml(c) + '</button>';
    });
    h += '</div>';
    h += '<div class="quiz_feedback"></div>';
    h += '</div>';
    root.innerHTML = h;
    root.querySelectorAll('.quiz_choice').forEach(function (btn) {
      btn.addEventListener('click', _quizHandleChoice);
    });
  }

  function _quizHandleChoice(e) {
    const btn = e.currentTarget;
    const choice = btn.textContent;
    const correct = choice === _quizCurrent.answer;
    const feedback = document.querySelector('#quiz_root .quiz_feedback');
    feedback.innerHTML = '';

    const status = document.createElement('span');
    status.className = correct ? 'quiz_correct' : 'quiz_wrong';
    status.textContent = correct ? '✓ Correct' : '✗ Wrong';
    feedback.appendChild(status);

    document.querySelectorAll('#quiz_root .quiz_choice').forEach(function (b) { b.disabled = true; });
    btn.classList.add(correct ? 'quiz_correct' : 'quiz_wrong');

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'quiz_next';
    next.textContent = 'Next →';
    next.addEventListener('click', renderQuiz);
    feedback.appendChild(next);
  }

  // ---------- per-state render ----------
  function applyState() {
    const x = parseState();
    window.SF_X = x;
    renderTitle(x);
    renderFretboard(x);     // creates #options_root in the middle column
    renderOptions(x);       // fills it
    renderChordGrid(x);
    renderScaleGrid(x);
    renderTuningsTable(x);
    applyKeyboardColors(x);
    renderKeyboardPicks(x);
    bindTuningPicker(x);
    applyCollapseFromUrl();

    renderSummaryExtras(x);  // populate summary dropdowns BEFORE binding
    renderSummaryStatus(x);  // compact key/tuning text in each title bar
    bindAutoSubmit();        // so the change-listener catches them
    applyPrintColors();

    // Sortable tables get rebuilt every render — bind a fresh instance each time
    document.querySelectorAll('table.sortable').forEach(function (t) {
      if (typeof SortableTable !== 'undefined') {
        try { t._sortableInstance = new SortableTable(t); t._sortableInit = true; } catch (e) {}
      }
    });
    applyTuningsSort(x);
    bindTuningsSortObserver();
    bindTuningsFilter();
  }

  // ---------- init ----------
  function init() {
    applyState();
    bindCollapsibles();
    bindLinkInterceptor();
    bindHelpButtons();
    bindPrintButtons();
    bindExportButtons();
    bindSummaryExtras();
    bindSummaryToggleScope();
    bindFooterWitherfork();
    renderQuiz();
    window.addEventListener('popstate', applyState);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
