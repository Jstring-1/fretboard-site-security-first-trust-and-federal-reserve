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
    if (!checkSet(SCALES, ' Scale')) {
      if (!checkSet(CHORDS, ' Chord')) checkSet(GRID, ' Chord');
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

    // Row 1: tuning selector
    h += '<div class="opt_row opt_row_main">';
    h += '<select class="inputs" name="x">';
    h += '<option value="' + escHtml(x.x) + '">(' + x.strs + '-string) ' + escHtml(x.name) + ' — ' + escHtml(x[rev + 'notes']) + ' — (' + escHtml(x[rev + 'dgs']) + ')</option>';
    for (const a in TUNINGS) {
      const b = TUNINGS[a];
      h += '<option value="' + escHtml(a) + '">(' + b.strs + '-string) ' + escHtml(b.name) + ' — ' + escHtml(b[rev + 'notes']) + ' — (' + escHtml(b[rev + 'dgs']) + ')</option>';
    }
    h += '</select>';
    h += '</div>';

    // Row 2: toggles + key
    h += '<div class="opt_row opt_row_toggles">';
    h += '<label><input type="checkbox" class="chxbx" name="y" value="y"' + (x.y === 'y' ? ' checked="checked"' : '') + '/> Display ' + escHtml(x[rev + 'yy']) + '</label>';
    h += '<label><input id="cyo" type="checkbox" class="chxbx" name="z" value="y"' + (x.z === 'y' ? ' checked="checked"' : '') + '/> Show custom tuning</label>';
    h += '<label>Key: <select class="inputs" name="k">';
    h += '<option value="' + escHtml(x.k) + '">' + escHtml(x.k) + '</option>';
    for (const a of ALLNOTES) {
      h += '<option value="' + escHtml(a) + '">' + escHtml(a) + '</option>';
    }
    h += '</select></label>';
    h += '</div>';

    // Row 3: highlight degree pickers
    h += '<div class="opt_row opt_row_highlights">';
    h += '<span class="hl_title">Highlight:</span>';
    DEGREES.forEach(function (a, i) {
      const ab = flatToB(a);
      const checked = (x['hl_' + ab] === 'y') ? 'checked="checked"' : '';
      h += '<label class="hl_pill"><input type="checkbox" class="chxbx" id="_' + ab + '_" name="hl" value="' + escHtml(a) + '" ' + checked + '/>' + escHtml(a) + escHtml(EXTENSIONS[i]) + '</label>';
    });
    h += '<a href="?" id="clear_hl_btn">Clear</a>';
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

    let printColors = false;
    try { printColors = window.localStorage.getItem('sf_print_colors') === 'y'; } catch (e) {}

    let h = '';
    h += '<div class="fb_header">';
    h += '  <div class="fb_left">';
    h += '    <div id="view_src"><button style="background:none;border:none;" type="button" onclick="viewSource()">View Source Message</button></div>';
    h += '    <h3 id="info_l">Tuning: ' + escHtml(tuningName) + ' :: ' + escHtml(tuningNotes) + ' &nbsp; (' + escHtml(tuningDgs) + ')</h3>';
    h += '  </div>';
    h += '  <div class="fb_right">';
    h += '    <div id="print_btn">';
    h += '      <label class="print_color_toggle" title="Include highlight colors when printing"><input type="checkbox" id="print_colors_cb"' + (printColors ? ' checked' : '') + '/> Color</label>';
    h += '      <button style="background:none;border:none;" onclick="window.print()">Formatted for Printing</button>';
    h += '    </div>';
    h += '    <h3 id="info_r">Key: ' + escHtml(x.k) + ' :: ' + escHtml(x.hl_name) + '</h3>';
    h += '  </div>';
    h += '</div>';

    h += '<table id="fretboard">';

    const fretnumsTop = '<tr id="fretnums"><td id="f_cyo" class="fb_sm">Custom Tuning</td><td id="f0">X</td><td id="f1"></td><td id="f2"></td><td id="f3">3</td><td id="f4"></td><td id="f5">5</td><td id="f6"></td><td id="f7">7</td><td id="f8"></td><td id="f9">9</td><td id="f10"></td><td id="f11"></td><td id="f12">12</td></tr>';
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

  function renderKeyboardKeyPicker(x) {
    const root = document.getElementById('keyboard_key_root');
    if (!root) return;
    root.innerHTML = keyPickerHtml(x);
  }

  function renderChordGrid(x) {
    const root = document.getElementById('chord_grid_root');
    const i1 = KEYS.indexOf(x.k);
    const noteLetters = {
      _1_:  KEYS[i1],     _b2_: KEYS[i1 + 1], _2_:  KEYS[i1 + 2], _b3_: KEYS[i1 + 3],
      _3_:  KEYS[i1 + 4], _4_:  KEYS[i1 + 5], _b5_: KEYS[i1 + 6], _5_:  KEYS[i1 + 7],
      _b6_: KEYS[i1 + 8], _6_:  KEYS[i1 + 9], _b7_: KEYS[i1 + 10], _7_: KEYS[i1 + 11]
    };

    // Background color for each chord-link cell = the degree that gives the chord its character
    const CHORD_CHAR_DEG = {
      Maj:'_3_',         Min:'_b3_',        aug:'_b6_',        dim:'_b5_',
      sus2:'_2_',        sus4:'_4_',
      Maj6:'_6_',        min6:'_6_',
      dom7:'_b7_',       min7:'_b7_',       aug7:'_b7_',       '7b5':'_b5_',
      dim7:'_6_',        'half-dim':'_b5_',
      Maj7:'_7_',        'min-Maj7':'_7_',
      add9:'_2_',        min9:'_2_',        '6add9':'_2_',
      '9th':'_2_',       '7b9':'_b2_',      Maj9:'_2_',        '7#9':'_b3_',
      '11th':'_4_',      min11:'_4_',       '7#11':'_b5_',
      '13th':'_6_',      min13:'_6_'
    };

    let chordLinksRow = '<tr id="under_chord_grid"><td></td>';
    for (const a in GRID) {
      const label = a.replace(/b/g, '♭').replace(/#/g, '♯');
      const idAttr = CHORD_CHAR_DEG[a] ? ' id="' + CHORD_CHAR_DEG[a] + '"' : '';
      chordLinksRow += '<td' + idAttr + '><a href="' + x._hilight_url + GRID[a] + '">' + escHtml(label) + '</a></td>';
    }
    chordLinksRow += '<td></td></tr>';

    let h = keyPickerHtml(x);
    h += '<table id="chord_grid">';
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
      scaleLinksRow += '<td><a href="' + x._hilight_url + SCALES[name] + '">' + escHtml(label) + '</a></td>';
    }
    scaleLinksRow += '<td></td></tr>';

    let h = keyPickerHtml(x);
    h += '<table id="scale_grid">';
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
    h += '<input type="text" id="filter" class="inputs" onkeyup="filter()" placeholder="Filter">';
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
      h += '<tr>';
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

  // ---------- view source modal ----------
  function closeViewSourceModal() {
    const m = document.getElementById('view_source_modal');
    if (m) m.remove();
    document.removeEventListener('keydown', escClose);
  }
  function escClose(e) {
    if (e.key === 'Escape') closeViewSourceModal();
  }
  window.viewSource = function () {
    closeViewSourceModal();
    const source = '<html>' + document.getElementsByTagName('html')[0].innerHTML + '</html>';
    const escaped = source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const overlay = document.createElement('div');
    overlay.id = 'view_source_modal';
    overlay.innerHTML =
      '<div class="vs_backdrop"></div>' +
      '<div class="vs_panel" role="dialog" aria-label="Page source">' +
        '<button class="vs_close" type="button" aria-label="Close">×</button>' +
        '<pre class="vs_pre"></pre>' +
      '</div>';
    overlay.querySelector('.vs_pre').textContent = source; // textContent avoids re-parsing
    overlay.querySelector('.vs_backdrop').addEventListener('click', closeViewSourceModal);
    overlay.querySelector('.vs_close').addEventListener('click', closeViewSourceModal);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', escClose);
  };

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
    pushSelect(opt.querySelector('select[name="k"]'));

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
    history.pushState({}, '', target);
    applyState();
  }

  function bindAutoSubmit() {
    const handler = function (e) {
      // Any key picker outside options_root: sync the master before gathering, so the
      // form's dropdown carries the new value when gatherAndNavigate reads it.
      if (e && e.target && e.target.matches && e.target.matches('select[name="k"]')) {
        const master = document.querySelector('#options_root select[name="k"]');
        if (master && master !== e.target) master.value = e.target.value;
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

  // ---------- print-colors toggle ----------
  function bindPrintColorToggle() {
    const cb = document.getElementById('print_colors_cb');
    if (!cb) return;
    document.body.classList.toggle('print-colors', cb.checked);
    cb.addEventListener('change', function () {
      document.body.classList.toggle('print-colors', cb.checked);
      try { window.localStorage.setItem('sf_print_colors', cb.checked ? 'y' : 'n'); } catch (e) {}
    });
  }

  // ---------- collapsible-section state persistence ----------
  function bindCollapsibles() {
    const sections = document.querySelectorAll('details.collapsible');
    sections.forEach(function (d) {
      const key = 'sf_collapse_' + d.id;
      let saved = null;
      try { saved = window.localStorage.getItem(key); } catch (e) {}
      if (saved === 'closed') d.removeAttribute('open');
      else if (saved === 'open') d.setAttribute('open', '');
      d.addEventListener('toggle', function () {
        try { window.localStorage.setItem(key, d.open ? 'open' : 'closed'); } catch (e) {}
      });
    });

    // Force the fretboard open during print so collapsed-state doesn't suppress it
    const fb = document.getElementById('section_2');
    if (fb) {
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
    // If any highlights are set, dim the notes that aren't in the highlight set.
    // If nothing is highlighted, show all 12 notes in their key-relative colors.
    const anyHighlighted = DEGREES.some(function (d) {
      return x['hl_' + d.replace('♭', 'b')] === 'y';
    });
    const DIM_BG    = '#C9D2D6';   // white-key bg when not in highlight set
    const DIM_TEXT  = '#777';      // black-key text when not in highlight set

    const i1 = KEYS.indexOf(x.k);
    let css = '';
    for (const note in KEYBOARD_NOTE_CLASSES) {
      const noteIdx = KEYS.indexOf(note);
      const semi = ((noteIdx - i1) + 12) % 12;
      const deg = DEGREES[semi];
      const inHighlightSet = !anyHighlighted || (x['hl_' + deg.replace('♭', 'b')] === 'y');
      const def = KEYBOARD_NOTE_CLASSES[note];
      const prop = def.mode === 'bg' ? 'background-color' : 'color';
      const color = inHighlightSet
        ? KEYBOARD_DEGREE_COLORS[deg]
        : (def.mode === 'bg' ? DIM_BG : DIM_TEXT);
      def.cls.forEach(function (c) {
        css += '.ritz .waffle .' + c + ' { ' + prop + ': ' + color + ' !important; }\n';
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
    renderOptions(x);
    renderFretboard(x);
    renderChordGrid(x);
    renderScaleGrid(x);
    renderTuningsTable(x);
    renderKeyboardKeyPicker(x);
    applyKeyboardColors(x);

    bindAutoSubmit();
    bindPrintColorToggle();

    // Sortable tables get rebuilt every render — bind a fresh instance each time
    document.querySelectorAll('table.sortable').forEach(function (t) {
      if (typeof SortableTable !== 'undefined') {
        try { new SortableTable(t); t._sortableInit = true; } catch (e) {}
      }
    });
  }

  // ---------- init ----------
  function init() {
    const t0 = performance.now();
    applyState();
    bindCollapsibles();
    bindLinkInterceptor();
    renderQuiz();
    window.addEventListener('popstate', applyState);

    // Loaded-in blurb (set once on initial load)
    const blurb = document.getElementById('blurb');
    if (blurb) blurb.textContent = 'Loaded in ' + ((performance.now() - t0) / 1000).toFixed(8) + 's';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
