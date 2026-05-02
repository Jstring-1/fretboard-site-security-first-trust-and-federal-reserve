/* ============================================================
   Sheet Music viewer — js/sheetmusic.js

   Searchable chord-progression catalogue for the live site.
   Talks to /api/songs/search and /api/songs/{id} (Postgres-backed)
   and renders a search sidebar + chord-chart panel inside
   #sheetmusic_root. Largely a port of _books/_demo.html's chord-
   panel logic, minus the PDF viewer.

   Includes the in-place key-cycle (◀ / ▶ / M-m / ↺) so users can
   override the song's detected key on the fly when Claude Vision
   guessed wrong, exactly like the demo.
   ============================================================ */
(function () {
  'use strict';

  var root, $search, $only, $conf, $stats, $results, $viewer;
  var searchTimer = null;

  // ---------- Note-theory helpers (parallel to _demo.html) ----------------
  var NOTE_PC = {
    'C':0, 'C#':1,'C♯':1,'Db':1,'D♭':1,
    'D':2, 'D#':3,'D♯':3,'Eb':3,'E♭':3,
    'E':4, 'Fb':4,'F♭':4,
    'F':5, 'E#':5,'E♯':5,
    'F#':6,'F♯':6,'Gb':6,'G♭':6,
    'G':7, 'G#':8,'G♯':8,'Ab':8,'A♭':8,
    'A':9, 'A#':10,'A♯':10,'Bb':10,'B♭':10,
    'B':11,'Cb':11,'C♭':11
  };
  var PC_TO_DEGREE = ['1','♭2','2','♭3','3','4','♭5','5','♭6','6','♭7','7'];
  var PC_TO_KEY = ['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'];

  function parseChordRoot(chord) {
    if (!chord || chord === '|' || chord === '%') return -1;
    var head = String(chord).split('/')[0];
    var m = head.match(/^([A-G][#♯b♭]?)/);
    if (!m) return -1;
    return (NOTE_PC[m[1]] != null) ? NOTE_PC[m[1]] : -1;
  }
  function parseKey(s) {
    if (!s) return null;
    var m = String(s).match(/^([A-G][#♯b♭]?)/);
    if (!m) return null;
    var pc = NOTE_PC[m[1]];
    if (pc == null) return null;
    var isMin = /min|minor/i.test(s) || /\b[A-G][#♯b♭]?m\b/.test(s);
    return { pc: pc, mode: isMin ? 'minor' : 'major',
             label: PC_TO_KEY[pc] + ' ' + (isMin ? 'minor' : 'major') };
  }
  function makeKey(pc, mode) {
    return { pc: pc, mode: mode, label: PC_TO_KEY[pc] + ' ' + mode };
  }
  function recomputeDegrees(chords, origDegrees, newKey) {
    if (!chords || !newKey) return origDegrees || [];
    var out = [];
    for (var i = 0; i < chords.length; i++) {
      var c = chords[i];
      if (c === '|') { out.push('|'); continue; }
      var orig = (origDegrees && origDegrees[i]) || '';
      var sfx = splitDegree(orig).suffix;
      var pc = parseChordRoot(c);
      if (pc < 0) { out.push(orig); continue; }
      var iv = ((pc - newKey.pc) % 12 + 12) % 12;
      out.push(PC_TO_DEGREE[iv] + sfx);
    }
    return out;
  }
  function splitDegree(deg) {
    if (!deg || deg === '%') return { root: deg || '', suffix: '' };
    var m = String(deg).match(/^([♭♯]?[1-7])(.*)$/);
    if (!m) return { root: deg, suffix: '' };
    return { root: m[1], suffix: m[2] };
  }
  function degHtml(deg) {
    var sd = splitDegree(deg);
    var h = '<span class="sm_deg_unit"><span class="sm_deg_root">' + esc(sd.root) + '</span>';
    if (sd.suffix) h += '<span class="sm_deg_suffix">' + esc(sd.suffix) + '</span>';
    return h + '</span>';
  }

  // ---------- Chart layout (port of demo's splitMeasures + chartHtml) -----
  function splitMeasures(chords, degrees) {
    var raw = [];
    var cBuf = [], dBuf = [];
    for (var i = 0; i < (chords || []).length; i++) {
      if (chords[i] === '|') {
        raw.push({ c: cBuf, d: dBuf });
        cBuf = []; dBuf = [];
      } else {
        cBuf.push(chords[i]);
        dBuf.push((degrees && degrees[i]) || '');
      }
    }
    if (cBuf.length || dBuf.length) raw.push({ c: cBuf, d: dBuf });
    var filled = raw.filter(function (m) { return m.c.length; });
    var total = filled.reduce(function (n, m) { return n + m.c.length; }, 0);
    var avg = filled.length ? total / filled.length : 0;
    var ms = raw;
    if (avg > 2) {
      ms = [];
      for (var k = 0; k < raw.length; k++) {
        var m = raw[k];
        if (!m.c.length) { ms.push(m); continue; }
        for (var j = 0; j < m.c.length; j++) {
          ms.push({ c: [m.c[j]], d: [m.d[j] || ''] });
        }
      }
    }
    for (var n = 0; n < ms.length; n++) {
      if (!ms[n].c.length) { ms[n].c = ['%']; ms[n].d = ['%']; }
    }
    return ms;
  }
  function chartHtml(chords, degrees) {
    var measures = splitMeasures(chords, degrees);
    if (!measures.length) return '';
    function bar(m) {
      var cs = m.c.map(function (c) { return '<span class="sm_chord">' + esc(c) + '</span>'; }).join(' ');
      var ds = m.d.map(degHtml).join(' ');
      return '<div class="sm_bar">'
           +   '<div class="sm_chord_row">' + cs + '</div>'
           +   '<div class="sm_deg_row">' + ds + '</div>'
           + '</div>';
    }
    var h = '<div class="sm_chart">';
    for (var i = 0; i < measures.length; i += 8) {
      var first = measures.slice(i, i + 4);
      var second = measures.slice(i + 4, i + 8);
      h += '<div class="sm_chart_line">';
      h += '<div class="sm_four">' + first.map(bar).join('') + '</div>';
      if (second.length) h += '<div class="sm_four">' + second.map(bar).join('') + '</div>';
      h += '</div>';
    }
    return h + '</div>';
  }

  // ---------- Search ------------------------------------------------------
  function init() {
    root = document.getElementById('sheetmusic_root');
    if (!root) return;
    root.innerHTML = ''
      + '<div class="sm_header">'
      +   '<input class="sm_search" type="search" placeholder="Search song titles…" autocomplete="off">'
      +   '<label class="sm_only_label">'
      +     '<input type="checkbox" class="sm_only" checked> ♪ chord data only'
      +   '</label>'
      +   '<select class="sm_conf" title="Filter by extraction confidence — many medium / low rows are mis-read by the Vision pass">'
      +     '<option value="high" selected>High confidence</option>'
      +     '<option value="med">Medium+</option>'
      +     '<option value="all">All (incl. low)</option>'
      +   '</select>'
      +   '<span class="sm_stats"></span>'
      + '</div>'
      + '<div class="sm_split">'
      +   '<div class="sm_results"><div class="sm_empty">loading…</div></div>'
      +   '<div class="sm_viewer"><div class="sm_placeholder">Search and click a result to view the chord progression.</div></div>'
      + '</div>';
    $search  = root.querySelector('.sm_search');
    $only    = root.querySelector('.sm_only');
    $conf    = root.querySelector('.sm_conf');
    $stats   = root.querySelector('.sm_stats');
    $results = root.querySelector('.sm_results');
    $viewer  = root.querySelector('.sm_viewer');

    $search.addEventListener('input', queueSearch);
    $only.addEventListener('change', search);
    $conf.addEventListener('change', search);
    $results.addEventListener('click', onResultClick);

    search();
  }
  function queueSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(search, 200);
  }
  async function search() {
    var q = ($search.value || '').trim();
    var only = $only.checked ? '1' : '0';
    var conf = $conf.value || 'high';
    var url = '/api/songs/search?q=' + encodeURIComponent(q)
            + '&only_chords=' + only
            + '&confidence=' + encodeURIComponent(conf)
            + '&limit=300';
    try {
      var r = await fetch(url);
      if (!r.ok) {
        $results.innerHTML = '<div class="sm_empty">search error: ' + r.status + '</div>';
        return;
      }
      var d = await r.json();
      renderResults(d.results || []);
    } catch (e) {
      $results.innerHTML = '<div class="sm_empty">network error</div>';
    }
  }
  function renderResults(results) {
    if (!results.length) {
      $results.innerHTML = '<div class="sm_empty">no matches</div>';
      $stats.textContent = '';
      return;
    }
    var h = '';
    for (var i = 0; i < results.length; i++) {
      var s = results[i];
      var badge = s.has_chords ? ' <span class="sm_badge">♪</span>' : '';
      h += '<div class="sm_row" data-id="' + s.id + '">'
        +    '<div class="sm_row_main">'
        +      '<div class="sm_row_title">' + esc(s.title) + badge + '</div>'
        +      '<div class="sm_row_book">' + esc(s.book) + '</div>'
        +    '</div>'
        +    (s.key ? '<div class="sm_row_key">' + esc(s.key) + '</div>' : '')
        +  '</div>';
    }
    $results.innerHTML = h;
    $stats.textContent = results.length + ' result' + (results.length === 1 ? '' : 's');
  }

  // ---------- Viewer ------------------------------------------------------
  async function onResultClick(e) {
    var row = e.target.closest('.sm_row');
    if (!row) return;
    Array.prototype.forEach.call($results.querySelectorAll('.sm_row.active'),
      function (el) { el.classList.remove('active'); });
    row.classList.add('active');
    var id = row.getAttribute('data-id');
    $viewer.innerHTML = '<div class="sm_placeholder">loading…</div>';
    try {
      var r = await fetch('/api/songs/' + encodeURIComponent(id));
      if (!r.ok) {
        $viewer.innerHTML = '<div class="sm_placeholder">load error: ' + r.status + '</div>';
        return;
      }
      var s = await r.json();
      renderSong(s);
    } catch (err) {
      $viewer.innerHTML = '<div class="sm_placeholder">network error</div>';
    }
  }
  function renderSong(s) {
    var origKey = parseKey(s.key) || makeKey(0, 'major');
    var overrideKey = null;

    function activeKey() { return overrideKey || origKey; }
    function rebuild() {
      var k = activeKey();
      var ds = overrideKey ? recomputeDegrees(s.chords, s.degrees, k) : (s.degrees || []);
      var chartWrap = $viewer.querySelector('.sm_chartwrap');
      if (chartWrap) chartWrap.innerHTML = chartHtml(s.chords, ds);
      var lab = $viewer.querySelector('.sm_keylabel');
      if (lab) lab.textContent = k.label;
      var reset = $viewer.querySelector('.sm_keyreset');
      if (reset) reset.style.display = overrideKey ? 'inline-block' : 'none';
    }
    function step(d) {
      var c = activeKey();
      overrideKey = makeKey(((c.pc + d) % 12 + 12) % 12, c.mode);
      rebuild();
    }
    function toggleMode() {
      var c = activeKey();
      overrideKey = makeKey(c.pc, c.mode === 'minor' ? 'major' : 'minor');
      rebuild();
    }
    function resetKey() { overrideKey = null; rebuild(); }

    var head = '<div class="sm_head">'
      + '<div class="sm_title">' + esc(s.title || '?') + '</div>'
      + '<div class="sm_meta">'
      +   '<span class="sm_meta_label">' + esc(s.book || '') + '</span>'
      +   ' · key '
      +   '<button class="sm_keystep" data-d="-1" title="Down a semitone">◀</button>'
      +   ' <b class="sm_keylabel">' + esc(activeKey().label) + '</b> '
      +   '<button class="sm_keystep" data-d="1" title="Up a semitone">▶</button>'
      +   ' <button class="sm_keymode" title="Toggle major / minor">M / m</button>'
      +   ' <button class="sm_keyreset" title="Reset to detected key" style="display:none">↺</button>'
      +   (s.time_signature ? ' · ' + esc(s.time_signature) : '')
      +   ' · confidence <b>' + esc(s.confidence || '?') + '</b>'
      + '</div>'
      + '</div>';
    var notes = s.notes ? '<div class="sm_notes">' + esc(s.notes) + '</div>' : '';
    $viewer.innerHTML = head
      + '<div class="sm_chartwrap">' + chartHtml(s.chords, s.degrees) + '</div>'
      + notes;

    Array.prototype.forEach.call($viewer.querySelectorAll('.sm_keystep'),
      function (b) {
        b.addEventListener('click', function () { step(+b.getAttribute('data-d')); });
      });
    var modeBtn = $viewer.querySelector('.sm_keymode');
    if (modeBtn) modeBtn.addEventListener('click', toggleMode);
    var resetBtn = $viewer.querySelector('.sm_keyreset');
    if (resetBtn) resetBtn.addEventListener('click', resetKey);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
