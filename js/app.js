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
    return qs ? '?' + qs : window.location.pathname;
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function urlNote(s) {
    // PHP: replace ♭→b, ♯→#, strip space, urlencode
    return encodeURIComponent(String(s).replace(/♭/g, 'b').replace(/♯/g, '#').replace(/ /g, ''));
  }
  function urlNoteRaw(s) {
    // urlencoded but with ♯→# only (keeps b3 / ♭3 distinction handled at value level)
    return encodeURIComponent(String(s).replace(/♯/g, '#'));
  }
  function reverseSpaceStr(s) {
    return String(s).split(' ').reverse().join(' ');
  }
  function bToFlat(s) { return String(s).replace(/b/g, '♭'); }
  function flatToB(s) { return String(s).replace(/♭/g, 'b'); }
  function sharpToHash(s) { return String(s).replace(/#/g, '♯'); }
  function hashToSharp(s) { return String(s).replace(/♯/g, '#'); }

  // ---------- parse URL → x ----------
  function parseState() {
    const x = {};
    let def = '';

    const params = new URLSearchParams(window.location.search);
    const hasParams = Array.from(params.keys()).length > 0;

    if (hasParams) {
      // Build raw map of key → array (for hl which is multi-valued)
      const raw = {};
      for (const [k, v] of params.entries()) {
        // PHP: $value = str_replace("b","♭",$value); str_replace("#","♯",$value)
        const val = bToFlat(sharpToHash(v));
        if (!raw[k]) raw[k] = [];
        raw[k].push(val);
      }

      // Validate x (tuning key)
      if (raw.x && raw.x[0]) {
        if (Object.prototype.hasOwnProperty.call(TUNINGS, raw.x[0])) {
          x.x = raw.x[0];
        } else {
          def = 'y';
        }
      }

      // Validate single-value note params (k, s1..s12)
      const noteOk = /^[A-G♯]+$/;
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

    // url_s: rebuilt s12=...&s11=...&...
    let url_s = '';
    for (let a = 12; a >= 1; a--) {
      url_s += 's' + a + '=' + encodeURIComponent(hashToSharp(x['s' + a])) + '&';
    }

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
    let url_hl = '';
    for (const v of hlArr) url_hl += 'hl=' + flatToB(v) + '&';
    x.url_hl = url_hl;

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

    // hl_name lookup — match url_hl against scales/chords/grid
    x.hl_name = 'Highlighted: ';
    x.hl_n = '';
    const targetHl = '&' + x.url_hl;
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

    // Row 1: y switch + tuning selector
    h += '<div class="opt_row opt_row_main">';
    h += '<a href="' + escHtml(yToggleHref) + '" class="y_switch y_' + yState + '" title="' + escHtml(yTitle) + '" aria-label="Toggle tuning direction">' + yLabel + '</a>';
    h += '<select class="inputs" name="x">';
    h += '<option value="' + escHtml(x.x) + '">(' + x.strs + '-string) ' + escHtml(x.name) + ' — ' + escHtml(x[rev + 'notes']) + ' — (' + escHtml(x[rev + 'dgs']) + ')</option>';
    for (const a in TUNINGS) {
      const b = TUNINGS[a];
      h += '<option value="' + escHtml(a) + '">(' + b.strs + '-string) ' + escHtml(b.name) + ' — ' + escHtml(b[rev + 'notes']) + ' — (' + escHtml(b[rev + 'dgs']) + ')</option>';
    }
    h += '</select>';
    h += '</div>';

    // (Key dropdown + Clear live in the section title bars now, not in the form.)

    // Row 3: highlight degree pickers
    h += '<div class="opt_row opt_row_highlights">';
    h += '<span class="hl_title">Highlight:</span>';
    DEGREES.forEach(function (a, i) {
      const ab = flatToB(a);
      const checked = (x['hl_' + ab] === 'y') ? 'checked="checked"' : '';
      h += '<label class="hl_pill"><input type="checkbox" class="chxbx" id="_' + ab + '_" name="hl" value="' + escHtml(a) + '" ' + checked + '/>' + escHtml(a) + escHtml(EXTENSIONS[i]) + '</label>';
    });
    h += '</div>';

    h += '</div>';
    root.innerHTML = h;
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
    h += '<div id="quick_picks">';
    h += '  <div class="qp_row">';
    for (const a in GRID) {
      const label = a.replace(/b/g, '♭').replace(/#/g, '♯');
      const isSelected = (x.hl_n === a.replace(/_/g, ' '));
      const href = isSelected ? x._hilight_url : (x._hilight_url + GRID[a]);
      const cls = 'qp_link' + (isSelected ? ' cg_selected' : '');
      h += '<a class="' + cls + '" href="' + href + '">' + escHtml(label) + '</a>';
    }
    h += '  </div>';
    h += '  <div class="qp_row">';
    for (const name in SCALES) {
      const label = name.replace(/_/g, ' ');
      const isSelected = (x.hl_n === label);
      const href = isSelected ? x._hilight_url : (x._hilight_url + SCALES[name]);
      const cls = 'qp_link' + (isSelected ? ' cg_selected' : '');
      h += '<a class="' + cls + '" href="' + href + '">' + escHtml(label) + '</a>';
    }
    h += '  </div>';
    h += '</div>';

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
      if (target === 'section_5') { s.innerHTML = ''; return; }  // tunings list: no key/clear
      s.innerHTML = html;
    });
  }

  // Compact "Key … · Highlighted … | Tuning …" line shown in every section
  // title bar except the Learn quiz.
  function renderSummaryStatus(x) {
    const rev = (x.y === 'y') ? 'rev_' : '';
    const tuningName = (x.z === 'y') ? 'Custom' : x.name;
    const tuningNotes = (x.z === 'y')
      ? String(x[rev + 's']).replace(/ /g, '')
      : String(x[rev + 'notes']).replace(/ /g, '');
    const tuningDgs = (x.z === 'y')
      ? String(x[rev + 'sdgs']).replace(/ /g, '')
      : String(x[rev + 'dgs']).replace(/ /g, '');
    const keyPart = 'Key: ' + escHtml(x.k) + ' :: ' + escHtml(x.hl_name);
    const tunPart = 'Tuning: ' + escHtml(tuningName) + ' :: ' + escHtml(tuningNotes) + ' (' + escHtml(tuningDgs) + ')';
    // Two short stacked lines: key/highlight on top, tuning underneath.
    const html =
      '<span class="status_key">' + keyPart + '</span>' +
      '<span class="status_tun">' + tunPart + '</span>';
    document.querySelectorAll('.summary_status').forEach(function (s) {
      s.innerHTML = html;
    });
  }

  // Restrict the toggle to clicks on the title (and the disclosure arrow
   // pseudo-element on summary itself). Clicks on the status text, buttons, or
   // any control inside the summary should NOT collapse/expand the section.
  function bindSummaryToggleScope() {
    document.querySelectorAll('details.collapsible > summary').forEach(function (summary) {
      if (summary._toggleScopeBound) return;
      summary._toggleScopeBound = true;
      summary.addEventListener('click', function (e) {
        // Click on summary itself (the disclosure arrow / padding) — allow toggle
        if (e.target === summary) return;
        // Click inside the title — allow toggle
        if (e.target.closest && e.target.closest('.summary_title')) return;
        // Anything else (status, buttons, key dropdown, clear, print, ?) — block
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
      const href = isSelected ? x._hilight_url : (x._hilight_url + GRID[a]);
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
          h += '<td id="' + row.degId + '">' + escHtml(cell) + '</td>';
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
      const href = isSelected ? x._hilight_url : (x._hilight_url + SCALES[name]);
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
          h += '<td id="' + row.degId + '">' + escHtml(degSym) + '</td>';
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
      const addUrl = '&x=' + v.url_notes;
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
      '    • Pick a tuning from the dropdown — the fretboard fills in note names and',
      '      degrees relative to the chosen Key.',
      '    • Tick "Show custom tuning" to enable per-string note dropdowns and roll',
      '      your own tuning.',
      '    • Tick "Display High to Low" to flip the string order in the indicators',
      '      and the tunings list.',
      '    • Tick any of the degree pills (1, ♭2, 2, ..., 7) to highlight those',
      '      degrees on the fretboard. The Clear link drops every parameter back',
      '      to defaults.',
      '    • Print: the Print button formats the fretboard for paper. Tick "Color"',
      '      next to it to include highlighted-degree colors in the printout',
      '      (otherwise paper output is black-and-white).',
      '',
      '  URL state:',
      '    Every selection (tuning, key, custom strings, highlights, collapsed',
      '    sections, sort order, filter, print-color preference) lives in the URL,',
      '    so any view is bookmarkable and shareable.',
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
      '  and steel string gauges that target each note. The MXR 10-band EQ row',
      '  shows which frequency centers each band covers.',
      '',
      '  Black-key text and white-key backgrounds are colored by their degree',
      '  relative to the current key. Change the key (top-right of this section)',
      '  and every note color shifts to match.',
      '',
      '  When degrees are highlighted on the fretboard, notes outside the',
      '  highlight set dim to grey here so the chosen notes stand out across',
      '  the whole 88-note span.',
      ''
    ].join('\n'),

    tunings: [
      '',
      '  Tunings List',
      '',
      '  170+ tunings for 6-, 8-, 10-, and 12-string steel guitars.',
      '',
      '    • Click any column header to sort. Click the same header again to',
      '      reverse direction.',
      '    • Type in the filter box to narrow the list (matches the Strings',
      '      column).',
      '    • Click a tuning name to load that tuning into the fretboard,',
      '      keeping the current key and highlights.',
      '',
      '  Sort and filter state are kept in the URL, so a sorted/filtered view',
      '  is bookmarkable.',
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
      // Encode ♯ as # so URL matches the format parseState expects (single decode + sharpToHash)
      const v = String(sel.value).replace(/♯/g, '#');
      parts.push(sel.name + '=' + encodeURIComponent(v));
    }
    pushSelect(opt.querySelector('select[name="x"]'));
    // Key dropdown lives in each section's title bar (.section_key_picker) since
    // the form no longer has its own. Read from any of them — bindAutoSubmit's
    // sync handler keeps every section's key picker at the same value.
    pushSelect(document.querySelector('.section_key_picker select[name="k"]'));

    ['y', 'z'].forEach(function (name) {
      const cb = opt.querySelector('input[type="checkbox"][name="' + name + '"]');
      if (cb && cb.checked) parts.push(name + '=' + cb.value);
    });

    opt.querySelectorAll('input[type="checkbox"][name="hl"]:checked').forEach(function (cb) {
      // Encode ♭ as b for URL hl values (matches PHP/quick-link convention)
      parts.push('hl=' + cb.value.replace(/♭/g, 'b'));
    });

    if (fb) {
      fb.querySelectorAll('select[name^="s"]').forEach(pushSelect);
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

  // Intercept clicks on any '?...' query-string link so we update via pushState
  // instead of triggering a full page navigation.
  function bindLinkInterceptor() {
    document.body.addEventListener('click', function (e) {
      const a = e.target.closest && e.target.closest('a');
      if (!a) return;
      // Honor modifier-clicks (open in new tab/window) and middle-click
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
      const href = a.getAttribute('href');
      if (!href || href.charAt(0) !== '?') return;
      e.preventDefault();
      navigateTo(href);
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
        isClosed = saved === 'closed';
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
  const KEYBOARD_NOTE_CLASSES = {
    'A':  { mode: 'bg',    cls: ['s32', 's47'] },
    'B':  { mode: 'bg',    cls: ['s34', 's48'] },
    'C':  { mode: 'bg',    cls: ['s35', 's49'] },
    'D':  { mode: 'bg',    cls: ['s37', 's50'] },
    'E':  { mode: 'bg',    cls: ['s39', 's51'] },
    'F':  { mode: 'bg',    cls: ['s40', 's52'] },
    'G':  { mode: 'bg',    cls: ['s42', 's53'] },
    'A♯': { mode: 'color', cls: ['s33', 's44'] },
    'C♯': { mode: 'color', cls: ['s36', 's45'] },
    'D♯': { mode: 'color', cls: ['s38'] },
    'F♯': { mode: 'color', cls: ['s41'] },
    'G♯': { mode: 'color', cls: ['s43'] }
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
    const DIM_WHITE_TEXT  = '#bdbdbd';
    const DIM_BLACK_TEXT  = '#0a0a0a';

    const i1 = KEYS.indexOf(x.k);
    let css = '';
    for (const note in KEYBOARD_NOTE_CLASSES) {
      const noteIdx = KEYS.indexOf(note);
      const semi = ((noteIdx - i1) + 12) % 12;
      const deg = DEGREES[semi];
      const inHighlightSet = !anyHighlighted || (x['hl_' + deg.replace('♭', 'b')] === 'y');
      const def = KEYBOARD_NOTE_CLASSES[note];
      def.cls.forEach(function (c) {
        const sel = '.ritz .waffle .' + c;
        if (def.mode === 'bg') {
          // White-key cell: tint bg by degree (or grey if dimmed)
          const bg = inHighlightSet ? KEYBOARD_DEGREE_COLORS[deg] : DIM_WHITE_BG;
          css += sel + ' { background-color: ' + bg + ' !important; }\n';
          if (!inHighlightSet) {
            css += sel + ' { color: ' + DIM_WHITE_TEXT + ' !important; }\n';
          } else if (anyHighlighted) {
            // Highlighted: degree-coloured bg + dark label, no border ring.
            css += sel + ' { color: #000 !important; }\n';
          }
        } else {
          // Black-key cell: tint label by degree (or near-bg if dimmed). No ring.
          const fg = inHighlightSet ? KEYBOARD_DEGREE_COLORS[deg] : DIM_BLACK_TEXT;
          css += sel + ' { color: ' + fg + ' !important; }\n';
        }
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
