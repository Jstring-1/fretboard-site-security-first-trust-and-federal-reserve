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

  // ---------- audio (Web Audio API synth, off by default) -------------
  // Persistence in localStorage so the user's preference survives reload
  // without polluting the URL. Opt-in: nothing plays unless the ♪ toggle
  // in the Fretboard summary is on.
  let _audioCtx = null;
  function audioOn() {
    return localStorage.getItem('sf_audio') === 'on';
  }
  function setAudioOn(on) {
    if (on) localStorage.setItem('sf_audio', 'on');
    else    localStorage.removeItem('sf_audio');
  }
  function ensureAudioCtx() {
    if (_audioCtx) return _audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    _audioCtx = new Ctx();
    return _audioCtx;
  }
  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  // Play a single note as a triangle-wave synth blip with a short
  // attack/release envelope. Polyphonic by design — each call spins up
  // its own oscillator + gain node so rapid clicks layer cleanly.
  function playMidi(m, durSec) {
    if (!audioOn()) return;
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
    const t0 = ctx.currentTime;
    const dur = (typeof durSec === 'number' && durSec > 0) ? durSec : 0.9;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(m);
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.22, t0 + 0.01);   // 10ms attack
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // Pitch-class lookup keyed by display note name (sharp form as KEYS uses).
  const NOTE_PC = {
    'C':0, 'C♯':1, 'D':2, 'D♯':3, 'E':4, 'F':5,
    'F♯':6, 'G':7, 'G♯':8, 'A':9, 'A♯':10, 'B':11,
    // Flat aliases for tunings stored that way (rare in this app's data).
    'D♭':1, 'E♭':3, 'G♭':6, 'A♭':8, 'B♭':10, 'C♭':11
  };
  function notePc(n) {
    const k = String(n || '').replace('#', '♯').replace('b', '♭');
    return NOTE_PC[k] != null ? NOTE_PC[k] : 0;
  }

  // Given an array of string note letters in LOW-TO-HIGH pitch order,
  // produce a parallel array of MIDI numbers using the heuristic:
  //  - lowest string lands closest to a per-string-count target
  //  - each subsequent string steps up by the smallest non-negative
  //    semitone delta from the previous (same letter ⇒ +12)
  // Handles standard guitar (40,45,50,55,59,64), bass (28..43), uke
  // (treated as ascending — re-entrant high-G uke will sound an octave
  // low, fixable later via per-string ± buttons).
  const _STR_COUNT_TARGET = { 4: 28, 5: 23, 6: 40, 7: 35, 8: 36, 9: 33, 10: 33, 11: 31, 12: 38 };
  function fretboardStringMidis(lowToHighNotes) {
    const N = lowToHighNotes.length;
    const target = _STR_COUNT_TARGET[N] || 40;
    const midis = [];
    let prev = -1;
    for (let i = 0; i < N; i++) {
      const p = notePc(lowToHighNotes[i]);
      let m;
      if (i === 0) {
        // Closest MIDI in [12,108] with (m % 12 === p) to the target
        let best = 60, diff = Infinity;
        for (let k = 12; k <= 108; k++) {
          if (k % 12 !== p) continue;
          const d = Math.abs(k - target);
          if (d < diff) { best = k; diff = d; }
        }
        m = best;
      } else {
        let step = ((p - (prev % 12)) + 12) % 12;
        if (step === 0) step = 12;
        m = prev + step;
      }
      midis.push(m);
      prev = m;
    }
    return midis;
  }

  // ---------- helpers ----------
  // URL with every current param except hl — used by every Clear button so
  // clearing only drops the highlight, not the key/tuning/collapsed sections.
  function clearHlHref() {
    const params = new URLSearchParams(window.location.search);
    params.delete('hl');
    params.delete('pk');
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

  // Canonical order for URL params — every URL the app generates should
  // emit known params in this order so shared / bookmarked URLs read
  // consistently. Unknown / legacy params (e.g. s1..s12) are appended
  // alphabetically at the end.
  const URL_PARAM_ORDER = ['k', 'x', 's', 'hl', 'pk', 'y', 'z', 'c', 'f', 'fc', 'fcp', 'td', 'sort'];
  function canonicalQS(params) {
    const known = new Set(URL_PARAM_ORDER);
    const out = new URLSearchParams();
    URL_PARAM_ORDER.forEach(function (k) {
      if (params.has(k)) {
        params.getAll(k).forEach(function (v) { out.append(k, v); });
      }
    });
    const unknown = [];
    params.forEach(function (_v, k) {
      if (!known.has(k) && unknown.indexOf(k) === -1) unknown.push(k);
    });
    unknown.sort();
    unknown.forEach(function (k) {
      params.getAll(k).forEach(function (v) { out.append(k, v); });
    });
    return out.toString();
  }

  // Read the active highlight degrees from URL params. Accepts both the
  // legacy multi-key form ?hl=1&hl=b3&hl=5 and the compact comma-separated
  // form ?hl=1,b3,5 — splits on commas across every hl key seen.
  function readHlParam(params) {
    return params.getAll('hl')
      .flatMap(function (v) { return v.split(','); })
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length; });
  }

  // Click-to-pick set for the chord identifier — comma-separated note letters
  // with 's'/'b' (e.g. ?pk=A,Cs,E). Independent of hl since the picks drive
  // a separate UI (yellow ring + identify strip), not degree highlighting.
  function readPkParam(params) {
    return params.getAll('pk')
      .flatMap(function (v) { return v.split(','); })
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length; });
  }

  // Read the custom-tuning strings from URL params. Accepts:
  //   - new compact form ?s=ACsEFGACE (note tokens, no separator) — same
  //     format as ?x=, so tunings encode the same way everywhere
  //   - legacy dot-separated  ?s=A.Cs.E.F.G.A.C.E
  //   - legacy individual     ?s1=A&s2=Cs&…
  // Positions 0..N-1 correspond to s1..sN; missing slots become null.
  function readCustomStrings(params) {
    const single = params.get('s');
    if (single != null) {
      let list;
      if (single.indexOf('.') !== -1) {
        list = single.split('.');
      } else {
        // Parse a contiguous run of [A-G][sb]? tokens. If a string has any
        // gaps the user must use the legacy dot-separated form.
        list = single.match(/[A-G][sb♯♭]?/g) || [];
      }
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
  function parseState(searchOverride) {
    // searchOverride: optional `?k=A&hl=…` string. Used by the per-
    // section rerender path when "Apply: all" is off — we parse the
    // link's URL into a state object without actually navigating, then
    // hand that state to a single section's renderer.
    const x = {};
    let def = '';

    const params = new URLSearchParams(
      (searchOverride != null) ? searchOverride : window.location.search
    );
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
      // Hydrate s1..s12 (compact ?s=A.Cs.E.F.G.A.C.E OR legacy ?s1=…&s2=…).
      // Each parsed value is validated against the same A-G + ♯/♭ alphabet
      // the single-value note params use; anything weird from a hand-edited
      // URL gets dropped so it can't slip into the dropdowns or display.
      const cstr = readCustomStrings(params);
      const _noteRe = /^[A-G♯♭]+$/;
      for (const sk in cstr) {
        const _v = bToFlat(sharpToHash(cstr[sk]));
        if (_noteRe.test(_v)) raw[sk] = [_v];
      }
      // Track how many s-strings the URL actually carried (post-validation,
      // so invalid notes from a hand-edited URL don't bump the count).
      // Used to override the fretboard string count when custom is engaged.
      let _csCountUrl = 0;
      for (let i = 1; i <= 12; i++) {
        if (raw['s' + i] && raw['s' + i][0]) _csCountUrl = i;
        else break;
      }
      x._customStrsFromUrl = _csCountUrl;

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

      // Validate pk (chord-identifier picks). Notes are canonicalized to
      // the sharp form ALLNOTES uses so ?pk=Bb and ?pk=As both land as A♯.
      const FLAT_TO_SHARP = {
        'A♭': 'G♯', 'B♭': 'A♯', 'C♭': 'B',
        'D♭': 'C♯', 'E♭': 'D♯', 'F♭': 'E',
        'G♭': 'F♯'
      };
      const pkRaw = readPkParam(params).map(function (v) {
        const f = bToFlat(sharpToHash(v));
        return FLAT_TO_SHARP[f] || f;
      });
      const validPk = pkRaw.filter(function (n) {
        return ALLNOTES.indexOf(n) !== -1;
      });
      x.pk = validPk.join(' ');
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

    // Build x.s from s1..s12 (custom-tuning notes assembled in reverse order).
    // Cap at the URL-derived count when present; otherwise cap at the main
    // tuning's string count so a bare-URL load with a 6-string main doesn't
    // surface the legacy 12-string DEF_X entries in the header.
    const _sCount = (x._customStrsFromUrl > 0) ? x._customStrsFromUrl : (+x.strs || 12);
    let ess = '';
    for (let i = _sCount; i >= 1; i--) {
      if (KEYS.indexOf(x['s' + i]) !== -1) ess += x['s' + i] + ' ';
    }
    ess = ess.trim();
    x.s = ess;
    x.rev_s = reverseSpaceStr(ess);

    if (x.z === 'y') {
      x.d_name = 'Custom';
      x.d_notes = x.s;
      // When custom tuning is engaged, the fretboard's string count comes
      // from how many strings were actually in the URL — NOT from x.sN
      // (which DEF_X defaults backfill for the unused slots). That way
      // switching from a 12-string custom to a 6-string custom drops
      // the visible fretboard down to 6 rows even though x.s7..x.s12
      // still hold default fallback values.
      if (x._customStrsFromUrl > 0) x.strs = x._customStrsFromUrl;
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
    // sharps written as 's' (urlNote handles the ♯→s transform). Cap the
    // build at _customStrsFromUrl so chord/scale chip URLs (which embed
    // url_s) don't pull in DEF_X defaults for s7..s12 and silently turn
    // a 6-string custom into a 12-string custom on click. If no s was in
    // the URL at all, emit nothing — the chip URL has no business
    // inventing a custom tuning that the user never set up.
    let url_s = '';
    if (x._customStrsFromUrl > 0) {
      const _sLimit = x._customStrsFromUrl;
      let _sParts = [];
      for (let a = 1; a <= _sLimit; a++) {
        _sParts.push(x['s' + a] ? urlNote(x['s' + a]) : '');
      }
      while (_sParts.length && !_sParts[_sParts.length - 1]) _sParts.pop();
      if (_sParts.length) {
        const _hasGap = _sParts.some(function (v) { return !v; });
        url_s = 's=' + _sParts.join(_hasGap ? '.' : '') + '&';
      }
    }

    // Print colors are always on now — body keeps the .print-colors class
    // permanently so highlight bg's print as colors. Toggle was removed.

    // Tunings table sort: ?sort=<col>:<a|d>
    const sortRaw = params.get('sort');
    if (sortRaw && /^\d+:[ad]$/.test(sortRaw)) {
      const parts = sortRaw.split(':');
      x._sort = { col: parseInt(parts[0], 10), dir: parts[1] };
    } else {
      // Default: sort by Strings ascending (column 0) so 6-strings land
      // at the top whenever the URL doesn't specify a sort.
      x._sort = { col: 0, dir: 'a' };
    }

    // Tunings filter: ?f=<text>. Length-capped + control chars stripped to keep
    // the URL sane and to ensure nothing weird ends up on the page (we still
    // only ever set this via .value / textContent, never innerHTML).
    const fRaw = params.get('f');
    x._filter = '';
    if (typeof fRaw === 'string') {
      x._filter = fRaw.replace(/[\x00-\x1F\x7F]/g, '').slice(0, 64);
    }
    // String-count quick filters — independent for the Tunings List section
    // (?fc=) and the fretboard tuning popover (?fcp=). Persisted separately
    // in the URL so a user who only plays 6-string can pin both filters.
    function _validStrs(v) {
      return (v === '4' || v === '5' || v === '6' || v === '8' || v === '10' || v === '12') ? v : '';
    }
    x._filterStrs    = _validStrs(params.get('fc'));
    x._pickerStrs    = _validStrs(params.get('fcp'));

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

    // Click-to-pick chord-identifier set. Renderers paint these cells with
    // a yellow ring and the identify strip scans this set.
    if (x.pk === undefined || x.pk === null) x.pk = '';
    const pkArr = String(x.pk).split(' ').filter(function (v) { return v.length; });
    x._pk_set = new Set(pkArr);
    x.url_pk = pkArr.length
      ? 'pk=' + pkArr.map(function (n) { return urlNote(n); }).join(',') + '&'
      : '';

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
    // Cap the degree readout at the URL-derived custom-string count, same
    // as x.s above, so a 6-string custom tuning's degrees aren't padded
    // out with DEF_X defaults' degrees.
    let sdgsStr = '';
    for (let i = _sCount; i >= 1; i--) if (sdgs[i] !== undefined) sdgsStr += sdgs[i] + ' ';
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
    x._hilight_url = x._self + x.url_k + x.url_x + x.url_y + x.url_z + x.url_s + x.url_pk;

    // ---- Unlinked mode + per-section overrides ---------------------------
    // ?u=1 flips the page into "each section drives its own state" mode.
    // While unlinked, params named like s<num>_<key> (e.g. s4_k=D,
    // s4_hl=1,b3,5) override the same key for that section only. Stripped
    // automatically when the user re-Links via the toggle button.
    x._unlinked = (params.get('u') === '1');
    x._sectionOverrides = {};
    if (x._unlinked) {
      for (const [k, v] of params.entries()) {
        const m = k.match(/^s(\d+)_(.+)$/);
        if (!m) continue;
        const sec = 'section_' + m[1];
        const field = m[2];
        x._sectionOverrides[sec] = x._sectionOverrides[sec] || {};
        x._sectionOverrides[sec][field] = v;
      }
    }

    return x;
  }

  // Build a "virtual" query string for a section by stripping any
  // s<n>_* prefixed keys from the URL and overlaying that section's
  // overrides on top of the global params. Pass the result back into
  // parseState() to get a fully-derived per-section state with all
  // the mask helpers (_hl_set, _pk_set, etc.) recomputed properly.
  function virtualSearchForSection(sectionId, baseSearch) {
    const m = String(sectionId || '').match(/^section_(\d+)$/);
    if (!m) return baseSearch;
    const sNum = m[1];
    const inP = new URLSearchParams(baseSearch);
    const sectionOverrides = {};   // field → comma-joined raw value
    inP.forEach((v, k) => {
      const mm = k.match(/^s(\d+)_(.+)$/);
      if (mm && mm[1] === sNum) sectionOverrides[mm[2]] = v;
    });
    const out = new URLSearchParams();
    inP.forEach((v, k) => {
      if (/^s\d+_/.test(k)) return;       // drop ALL section overrides from base
      if (k === 'u')        return;       // virtual URL parses as "linked"
      // hl / pk / s are multi/special — preserve their relative order
      out.append(k, v);
    });
    // Apply this section's overrides on top
    for (const [field, raw] of Object.entries(sectionOverrides)) {
      // Multi-value fields go comma-separated when prefixed; expand
      // back to repeated keys so the parser path matches the canonical
      // global form.
      if (field === 'hl' || field === 'pk') {
        // strip any existing
        const exist = out.getAll(field);
        if (exist.length) {
          // delete all instances
          out.delete(field);
        }
        raw.split(',').forEach(p => p && out.append(field, p));
      } else {
        out.set(field, raw);
      }
    }
    return out.toString();
  }

  // Resolve the right state for a particular section: when unlinked,
  // re-parse the URL with that section's overrides folded in; when
  // linked, just return the global x.
  function stateForSection(sectionId, x) {
    if (!x || !x._unlinked) return x;
    if (!x._sectionOverrides[sectionId]) return x;
    const virt = virtualSearchForSection(sectionId, window.location.search);
    return parseState(virt);
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
    let h = '<div id="tunings_drop">';

    // Row 1: tuning picker. The string-direction (y) toggle now lives in
    // the fretboard's bottom row (replacing the open-string "X" marker)
    // and only flips the row order on the fretboard — the picker label
    // stays in the canonical low → high order regardless.
    h += '<div class="opt_row opt_row_main">';
    const curLabel = '(' + x.strs + '-string) ' + x.name + ' — ' + x.notes + ' — (' + x.dgs + ')';
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

    // Row 3: highlight degree pickers (link-style toggle pills) — placed
    // ABOVE the note-letter row so the user reads the abstract degree
    // first and the concrete pitch directly under it. Note row reorders
    // when the key changes (root note sits under degree 1).
    h += highlightPillsLinkHtml(x, 'fb_hl_row');

    // Row 4: note-letter pickers, ordered by degree-from-root (so the
    // root note column-aligns with degree 1, ♭2 with the next note
    // chromatically up, etc.).
    h += notePillsLinkHtml(x, 'fb_hn_row');

    // Row 5: shared All / None for both pill rows.
    h += allNoneRowHtml('fb_allnone_row');

    h += '</div>';
    root.innerHTML = h;
  }

  // ---------- tuning picker popover ----------
  // Sortable / filterable replacement for the native <select name="x">.
  // Sort + filter state persists in module-scope vars across re-renders so the
  // user keeps their column sort and search after picking a tuning.
  let _tunPickerSort = { col: 'strs', dir: 'asc' };
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
    const quick = ['', '4', '5', '6', '8', '10', '12'];
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
    // Seed the popover's quick-filter from URL state on each render so
    // the persisted ?fcp=… choice stays selected across reloads.
    _tunPickerStrFilter = x._pickerStrs || '';

    function open() {
      pop.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      renderTuningPicker(x);
      // focus the filter input for instant typing
      setTimeout(function () {
        const f = pop.querySelector('.tun_pop_filter');
        if (f) f.focus({ preventScroll: true });
        const selRow = pop.querySelector('.tun_pop_row_selected');
        // Manual scroll-within-popup so the selected row centers in the
        // popup's own scrollable body — `scrollIntoView` would also
        // scroll the page itself, causing a visible jump on open.
        const popBody = pop.querySelector('.tun_pop_body');
        if (selRow && popBody) {
          const rowTop    = selRow.offsetTop;
          const rowHeight = selRow.offsetHeight;
          popBody.scrollTop = rowTop - (popBody.clientHeight - rowHeight) / 2;
        }
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
        const want = strBtn.getAttribute('data-strs') || '';
        _tunPickerStrFilter = want;
        // Persist popover string-count choice to ?fcp= so a user who only
        // plays 6-string can pin "6-string" once and keep it across reloads.
        const params = new URLSearchParams(window.location.search);
        if (want) params.set('fcp', want); else params.delete('fcp');
        const qs = canonicalQS(params);
        history.replaceState({}, '', qs ? '?' + qs : window.location.pathname);
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
      const chipDegs = fragToDegrees(GRID[a]);
      const isSelected = degSetsEqual(chipDegs, x.hl);
      const href = isSelected ? x._hilight_url : (x._hilight_url + hlMultiToCsv(GRID[a]));
      const cls = 'qp_link' + (isSelected ? ' cg_selected' : '');
      const tip = degsAndNotesTip(label, chipDegs, x.k, 'chord');
      h += '<a class="' + cls + '" href="' + href + '" title="' + escAttr(tip) + '">' + escHtml(label) + '</a>';
    }
    h += '  </div>';
    h += '  <div class="qp_row">';
    for (const name in SCALES) {
      const label = name.replace(/_/g, ' ');
      const chipDegs = fragToDegrees(SCALES[name]);
      const isSelected = degSetsEqual(chipDegs, x.hl);
      const href = isSelected ? x._hilight_url : (x._hilight_url + hlMultiToCsv(SCALES[name]));
      const cls = 'qp_link' + (isSelected ? ' cg_selected' : '');
      const tip = degsAndNotesTip(label, chipDegs, x.k, 'scale');
      h += '<a class="' + cls + '" href="' + href + '" title="' + escAttr(tip) + '">' + escHtml(label) + '</a>';
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
  // ---------- key-signature reference data ----------
  // Two parallel orders of the major keys: sharp side (C through C♯) and
  // flat side (F through C♭). Each row carries:
  //   key      — display name, including unicode accidentals
  //   setKey   — value to set k= to (SlantFinder uses ♯-spellings only)
  //   count    — sharps or flats in the signature
  //   notes    — the actual accidental notes in canonical signature order
  const KEY_SIGS_SHARP = [
    { key: 'C',  setKey: 'C',  count: 0, notes: '—' },
    { key: 'G',  setKey: 'G',  count: 1, notes: 'F♯' },
    { key: 'D',  setKey: 'D',  count: 2, notes: 'F♯ C♯' },
    { key: 'A',  setKey: 'A',  count: 3, notes: 'F♯ C♯ G♯' },
    { key: 'E',  setKey: 'E',  count: 4, notes: 'F♯ C♯ G♯ D♯' },
    { key: 'B',  setKey: 'B',  count: 5, notes: 'F♯ C♯ G♯ D♯ A♯' },
    { key: 'F♯', setKey: 'F♯', count: 6, notes: 'F♯ C♯ G♯ D♯ A♯ E♯' },
    { key: 'C♯', setKey: 'C♯', count: 7, notes: 'F♯ C♯ G♯ D♯ A♯ E♯ B♯' }
  ];
  const KEY_SIGS_FLAT = [
    { key: 'F',  setKey: 'F',  count: 1, notes: 'B♭' },
    { key: 'B♭', setKey: 'A♯', count: 2, notes: 'B♭ E♭' },
    { key: 'E♭', setKey: 'D♯', count: 3, notes: 'B♭ E♭ A♭' },
    { key: 'A♭', setKey: 'G♯', count: 4, notes: 'B♭ E♭ A♭ D♭' },
    { key: 'D♭', setKey: 'C♯', count: 5, notes: 'B♭ E♭ A♭ D♭ G♭' },
    { key: 'G♭', setKey: 'F♯', count: 6, notes: 'B♭ E♭ A♭ D♭ G♭ C♭' },
    { key: 'C♭', setKey: 'B',  count: 7, notes: 'B♭ E♭ A♭ D♭ G♭ C♭ F♭' }
  ];

  // Pull a "1 ♭3 5" style degree readout out of a GRID / SCALES URL
  // fragment ("&hl=1&hl=b3&hl=5"). Empty string if the fragment is empty.
  function fragToDegrees(frag) {
    return String(frag || '').split('&hl=').slice(1)
      .map(function (s) { return s.replace(/&.*$/, '').replace(/b/g, '♭'); })
      .filter(function (s) { return s.length; })
      .join(' ');
  }

  // True when two degree sets contain the same items (order-independent).
  // Used to auto-highlight every chord/scale chip whose degrees match the
  // active hl, not just the one whose name x.hl_n happened to land on.
  function degSetsEqual(a, b) {
    const A = new Set(String(a || '').split(/\s+/).filter(Boolean));
    const B = new Set(String(b || '').split(/\s+/).filter(Boolean));
    if (A.size !== B.size) return false;
    for (const v of A) if (!B.has(v)) return false;
    return true;
  }

  // Compose a hover tooltip showing a chord/scale's degrees + the resulting
  // notes for the current site key. e.g.
  //   "Maj7\nDegrees: 1 3 5 7\nNotes: A C♯ E G♯"
  // degsStr arrives space-separated ("1 ♭3 5"); key is x.k.
  function degsAndNotesTip(label, degsStr, key, kind) {
    const degs = String(degsStr || '').split(' ').filter(function (d) { return d.length; });
    const head = (kind === 'chord' ? 'CHORD: ' : kind === 'scale' ? 'SCALE: ' : '') + label;
    if (!degs.length) return head;
    const notes = (function () {
      const i1 = KEYS.indexOf(key);
      if (i1 < 0) return [];
      return degs.map(function (d) {
        const off = DEGREES.indexOf(d);
        return off < 0 ? '' : KEYS[i1 + off];
      }).filter(Boolean);
    })();
    let tip = head + '\nDegrees: ' + degs.join(' ');
    if (notes.length) tip += '\nNotes: ' + notes.join(' ');
    return tip;
  }

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

  // Mirror of buildHlHref for the chord-identifier pick set.
  // Build a URL that updates the chord-identifier pick set. In linked
  // mode the picks are global (`pk=…`); in unlinked mode each section
  // owns its own picks via `s<n>_pk=…`, so callers pass a sectionId so
  // the fretboard and keyboard identifiers don't share state.
  function buildPkHref(pkList, sectionId) {
    const unlinked = document.body.getAttribute('data-apply-all') === 'off';
    const p = new URLSearchParams(window.location.search);
    if (unlinked && sectionId) {
      const m = String(sectionId).match(/^section_(\d+)$/);
      if (m) {
        const key = 's' + m[1] + '_pk';
        p.delete(key);
        if (pkList.length) {
          p.set(key, pkList.map(function (n) { return urlNote(n); }).join(','));
        }
        p.set('u', '1');
        const qs = p.toString();
        return qs ? '?' + qs : '?';
      }
    }
    p.delete('pk');
    let qs = p.toString();
    if (pkList.length) {
      qs += (qs ? '&' : '') + 'pk=' + pkList.map(function (n) { return urlNote(n); }).join(',');
    }
    return qs ? '?' + qs : '?';
  }
  // Read the section's effective pk array. Falls back to the global
  // pk= when there's no section override (or in linked mode).
  function readPkArrForSection(sectionId) {
    const params = new URLSearchParams(window.location.search);
    const unlinked = params.get('u') === '1';
    const m = String(sectionId || '').match(/^section_(\d+)$/);
    if (unlinked && m && params.has('s' + m[1] + '_pk')) {
      return String(params.get('s' + m[1] + '_pk') || '').split(',').filter(Boolean);
    }
    return readPkParam(params);
  }

  function highlightPillsLinkHtml(x, rowCls) {
    let h = '<div class="opt_row opt_row_highlights ' + (rowCls || '') + '">';
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
        // !important on every property — the base .hl_pill rule and the
        // global a:link rule both use !important, which would otherwise
        // win over the inline declaration.
        style = ' style="background:' + bg + ' !important;color:' + fg
              + ' !important;border-color:' + bg + ' !important;"';
      }
      h += '<a class="' + cls + '" href="' + escHtml(href) + '"' + style + '>'
        + escHtml(a) + escHtml(EXTENSIONS[i]) + '</a>';
    });
    h += '</div>';
    return h;
  }

  // Single All / None button pair — sits below the degree pill row so we
  // don't repeat the same controls at the end of both pill rows.
  function allNoneRowHtml(rowCls) {
    const allHref = buildHlHref(DEGREES.map(flatToB));
    const noneHref = clearHlHref();
    return '<div class="opt_row opt_row_allnone ' + (rowCls || '') + '">'
         + '<a class="hl_pill hl_all_pill" href="' + escHtml(allHref) + '">All</a>'
         + '<a class="hl_pill hl_none_pill" href="' + escHtml(noneHref) + '">None</a>'
         + '</div>';
  }

  // Note-letter highlight pills — drive the SAME hl= URL param as the degree
  // pills. Each note pill toggles the degree it represents in the current
  // key (e.g. in key of E, the "E" pill toggles degree 1). The two pill
  // rows are two views of the same control: the labels reshuffle when the
  // key changes but the underlying selection state stays put.
  function notePillsLinkHtml(x, rowCls) {
    let h = '<div class="opt_row opt_row_notes ' + (rowCls || '') + '">';
    const i1 = KEYS.indexOf(x.k);
    const cur = readHlParam(new URLSearchParams(window.location.search));
    // Iterate by DEGREE position (0..11) so the column-order under the
    // degree row matches degree-by-degree: position 0 = root, position
    // 1 = ♭2, etc. When the key changes, the notes rotate to keep the
    // root sitting directly under degree 1.
    for (let off = 0; off < ALLNOTES.length; off++) {
      const noteIdx = i1 >= 0 ? (i1 + off) % ALLNOTES.length : off;
      const note = ALLNOTES[noteIdx];
      const deg = i1 >= 0 ? DEGREES[off] : '';
      const ab = deg ? flatToB(deg) : '';
      const on = ab && (x['hl_' + ab] === 'y');
      let next;
      if (on) {
        next = cur.filter(function (d) { return d !== ab; });
      } else if (ab) {
        next = cur.filter(function (d) { return d !== ab; }).concat([ab]);
      } else {
        next = cur;
      }
      const href = buildHlHref(next);
      const cls = 'note_pill' + (on ? ' note_pill_on' : '');
      // Inline styling on the on-state mirrors the degree's pill color so
      // the two rows agree visually when the same item is engaged.
      let style = '';
      if (on) {
        const bg = HL_PILL_COLORS[ab] || '#888';
        const fg = HL_PILL_LIGHT_TEXT[ab] ? '#fff' : '#000';
        style = ' style="background:' + bg + ' !important;color:' + fg
              + ' !important;border-color:' + bg + ' !important;"';
      }
      h += '<a class="' + cls + '" href="' + escHtml(href) + '"' + style + '>' + escHtml(note) + '</a>';
    }
    h += '</div>';
    return h;
  }

  // Render the highlight pills + chord/scale chips above the keyboard so the
  // keyboard section is fully usable when the fretboard section is collapsed.
  function renderKeyboardPicks(x) {
    const root = document.getElementById('kb_picks_root');
    if (!root) return;
    // Degree row first, note row second — keeps the abstract / concrete
    // ordering consistent with the fretboard section.
    root.innerHTML = highlightPillsLinkHtml(x, 'kb_hl_row')
                   + notePillsLinkHtml(x, 'kb_hn_row')
                   + allNoneRowHtml('kb_allnone_row')
                   + quickPicksHtml(x, 'kb_quick_picks');
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
    // String-direction (y) toggle that lives in place of the open-string "X"
    // marker — one in each fretnums row so flipping the order is reachable
    // from either end of the fretboard without scrolling back to the form.
    const yToggleParams = new URLSearchParams(window.location.search);
    if (x.y !== 'y') yToggleParams.set('y', 'y'); else yToggleParams.delete('y');
    const yToggleHref = '?' + yToggleParams.toString();
    const yState = x.y === 'y' ? 'on' : 'off';
    const yLabel = x.y === 'y' ? 'H→L' : 'L→H';
    const yTitle = x.y === 'y'
      ? 'Strings shown High → Low. Click to flip to Low → High.'
      : 'Strings shown Low → High. Click to flip to High → Low.';
    const f0Cell = '<td id="f0" class="f0_y_switch"><a href="' + escHtml(yToggleHref)
                 + '" class="y_switch y_switch_sm y_' + yState + '" title="' + escAttr(yTitle)
                 + '" aria-label="Toggle string direction">' + yLabel + '</a></td>';
    const fretnumsTop = '<tr id="fretnums"><td class="fb_sm cyo_switch cyo_' + cyoState + '" id="' + (x.z === 'y' ? 'f_cyo' : 'f_cyo_dark') + '">' +
      '<a href="' + escHtml(toggleHref) + '" title="Click to toggle custom tuning">Custom Tuning: ' + cyoState.toUpperCase() + '</a>' +
      '</td><td id="f0">X</td>'
      + '<td id="f1"><span class="fret_minor">1</span></td>'
      + '<td id="f2"><span class="fret_minor">2</span></td>'
      + '<td id="f3">3</td>'
      + '<td id="f4"><span class="fret_minor">4</span></td>'
      + '<td id="f5">5</td>'
      + '<td id="f6"><span class="fret_minor">6</span></td>'
      + '<td id="f7">7</td>'
      + '<td id="f8"><span class="fret_minor">8</span></td>'
      + '<td id="f9">9</td>'
      + '<td id="f10"><span class="fret_minor">10</span></td>'
      + '<td id="f11"><span class="fret_minor">11</span></td>'
      + '<td id="f12">12</td></tr>';
    h += fretnumsTop;

    const str = {};
    for (let a = 1; a <= 12; a++) {
      str[a] = String(x.z === 'y' ? x['s' + a] : x['x' + a]).trim();
    }

    // Compute open-string MIDI for every string (1..N) using the heuristic
    // in fretboardStringMidis. Convention here: s1 is the TOP row (highest
    // pitch) so the lowest pitch is sN — feed the helper in low-to-high
    // order and remap the result back by string number.
    const _midiByStr = (function () {
      const lowToHigh = [];
      for (let a = x.strs; a >= 1; a--) lowToHigh.push(str[a].toUpperCase());
      const midis = fretboardStringMidis(lowToHigh);
      const out = {};
      for (let i = 0; i < midis.length; i++) {
        // i=0 corresponds to a=N (lowest pitch), i=N-1 to a=1 (highest).
        out[x.strs - i] = midis[i];
      }
      return out;
    })();

    // String-direction toggle (y) flips the row order on the fretboard. y=y
    // walks the strings high-index-first; y=n walks 1..N. The tuning data
    // itself is untouched so the section header text stays canonical.
    for (let i = 0; i < x.strs; i++) {
      const a = (x.y === 'y') ? (x.strs - i) : (i + 1);
      const strizzle = str[a];
      const c = KEYS.indexOf(strizzle.toUpperCase());
      let nutDeg = findKey(x._notedegrees, strizzle.toUpperCase());
      let nutBg = (x['hl_' + flatToB(nutDeg)] === 'y') ? flatToB(nutDeg) : 'no_highlight';
      const f_cyo = (x.z === 'n') ? 'f_cyo_dark' : 'f_cyo';
      const nutNote = strizzle.toUpperCase();
      const nutPkCls = (x._pk_set && x._pk_set.has(nutNote)) ? ' note_pk' : '';

      h += '<tr>';
      h += '<td id="' + f_cyo + '"><select class="inputs" name="s' + a + '">';
      h += '<option value="' + escHtml(x['s' + a]) + '">' + escHtml(x['s' + a]) + '</option>';
      for (const note of ALLNOTES) {
        h += '<option value="' + escHtml(note) + '">' + escHtml(note) + '</option>';
      }
      h += '</select></td>';
      const _openMidi = _midiByStr[a];
      h += '<td class="nut' + nutPkCls + '" data-note="' + escHtml(nutNote) + '" data-midi="' + _openMidi + '" id="_' + nutBg + '_">' + escHtml(strizzle) + '(' + escHtml(nutDeg || '') + ')</td>';

      for (let b = 1; b <= 12; b++) {
        const cb = c + b;
        const noteAtFret = KEYS[cb];
        let degAtFret = findKey(x._notedegrees, noteAtFret);
        let fbId = (x['hl_' + flatToB(degAtFret)] === 'y') ? flatToB(degAtFret) : 'no_highlight';
        const cls = (b === 1) ? 'nut1' : 'fb_td';
        const cellPkCls = (x._pk_set && x._pk_set.has(noteAtFret)) ? ' note_pk' : '';
        h += '<td class="' + cls + cellPkCls + '" data-note="' + escHtml(noteAtFret) + '" data-midi="' + (_openMidi + b) + '" id="_' + fbId + '_">' + escHtml(noteAtFret) + '(' + escHtml(degAtFret || '') + ')</td>';
      }
      h += '</tr>';
    }

    // "Load preset into custom" dropdown — sits in the bottom-left empty
    // cell. Picking a preset populates s1..sN with that tuning's notes
    // (mapped high → low to match the s1=top-string convention) and
    // navigates. Doesn't touch x or fcp filters; always shows every
    // tuning in the database. Visible whether custom tuning is on or
    // off — users may want to set up a custom tuning before engaging.
    const _customLoaderRows = Object.keys(TUNINGS).map(function (k) {
      const t = TUNINGS[k];
      return { key: k, strs: +t.strs, name: t.name, notes: t.notes };
    });
    _customLoaderRows.sort(function (a, b) {
      if (a.strs !== b.strs) return a.strs - b.strs;
      if (a.name === b.name) return a.notes.localeCompare(b.notes);
      return a.name.localeCompare(b.name);
    });
    let customLoaderHtml = '<select class="custom_tun_loader" aria-label="Load a preset tuning into custom strings">';
    customLoaderHtml += '<option value="">Load preset…</option>';
    for (const t of _customLoaderRows) {
      const lbl = '(' + t.strs + ') ' + t.name + ' — ' + t.notes;
      customLoaderHtml += '<option value="' + escAttr(t.key) + '">' + escHtml(lbl) + '</option>';
    }
    customLoaderHtml += '</select>';

    const fretnumsBot = '<tr id="fretnums">'
      + '<td id="f_cyo">' + customLoaderHtml + '</td>' + f0Cell
      + '<td id="f1"><span class="fret_minor">1</span></td>'
      + '<td id="f2"><span class="fret_minor">2</span></td>'
      + '<td id="f3">3</td>'
      + '<td id="f4"><span class="fret_minor">4</span></td>'
      + '<td id="f5">5</td>'
      + '<td id="f6"><span class="fret_minor">6</span></td>'
      + '<td id="f7">7</td>'
      + '<td id="f8"><span class="fret_minor">8</span></td>'
      + '<td id="f9">9</td>'
      + '<td id="f10"><span class="fret_minor">10</span></td>'
      + '<td id="f11"><span class="fret_minor">11</span></td>'
      + '<td id="f12">12</td></tr>';
    h += fretnumsBot + '</table>';

    root.innerHTML = h;
  }

  // Mini key picker for the chord-grid / scale-grid / keyboard sections so the
  // user can change key without expanding the fretboard section. Renders a
  // hidden <select name="k"> (so gatherAndNavigate keeps working unchanged)
  // plus 12 visible buttons. A click on a button updates the hidden select
  // and dispatches a change event — the existing pipeline runs from there.
  function keyPickerHtml(x) {
    return keyButtonsHtml(x.k);
  }
  function keyButtonsHtml(currentKey) {
    let h = '<span class="section_key_picker section_key_row">';
    h += '<span class="key_label">KEY:</span>';
    // Hidden select for legacy gatherAndNavigate compatibility.
    h += '<select class="inputs key_hidden_select" name="k">';
    for (const a of ALLNOTES) {
      const sel = (a === currentKey) ? ' selected' : '';
      h += '<option value="' + escHtml(a) + '"' + sel + '>' + escHtml(a) + '</option>';
    }
    h += '</select>';
    for (const a of ALLNOTES) {
      const cls = (a === currentKey) ? ' active' : '';
      h += '<button type="button" class="key_btn' + cls + '" '
         + 'data-key="' + escHtml(a) + '">' + escHtml(a) + '</button>';
    }
    h += '</span>';
    return h;
  }

  // Each section's title bar gets its own Clear link, plus a row of 12
  // chromatic key buttons injected as a sibling element directly below
  // the summary so they're centred under the section title (not in the
  // right-side header strip).
  function renderSummaryExtras(x) {
    const slots = document.querySelectorAll('.summary_extras');
    if (!slots.length) return;
    function summaryHtml() {
      // Just the Clear link — the key buttons live below the summary now.
      return '<a href="' + escHtml(clearHlHref()) + '" class="section_clear">Clear</a>';
    }
    // Key-button row lives INSIDE the section's <summary>, as a sibling
    // span after the existing summary content. CSS forces it onto a
    // 100%-width second line so the buttons sit just below the title
    // — visually part of the header strip, not in the section body.
    function ensureKeyRow(section, currentKey) {
      const summary = section.querySelector(':scope > summary');
      if (!summary) return;
      // Clean up any stale row left behind from the previous structure
      // (when buttons lived as a sibling of summary).
      const stale = section.querySelector(':scope > .section_key_row_outer');
      if (stale) stale.remove();
      let row = summary.querySelector(':scope > .summary_keys');
      if (!row) {
        row = document.createElement('span');
        row.className = 'summary_keys';
        summary.appendChild(row);
      }
      row.innerHTML = keyButtonsHtml(currentKey);
    }
    function removeKeyRow(section) {
      const stale = section.querySelector(':scope > .section_key_row_outer');
      if (stale) stale.remove();
      const summary = section.querySelector(':scope > summary');
      const row = summary && summary.querySelector(':scope > .summary_keys');
      if (row) row.remove();
    }
    slots.forEach(function (s) {
      const target = s.getAttribute('data-summary-for');
      const sectionEl = target ? document.getElementById(target) : null;
      if (target === 'section_5' || target === 'section_9') {
        s.innerHTML = '';
        if (sectionEl) removeKeyRow(sectionEl);
        return;
      }
      if (target === 'section_8') {
        s.innerHTML = '';
        if (sectionEl) removeKeyRow(sectionEl);
        return;
      }
      // Compute this section's effective key. Linked → global x.k;
      // unlinked → routed through stateForSection so any s<n>_k=
      // override wins.
      let sectionKey = x.k;
      if (target && /^section_\d+$/.test(target)) {
        const sx = stateForSection(target, x);
        if (sx && sx.k) sectionKey = sx.k;
      }
      let prefix = (target === 'section_3' || target === 'section_6') ? compactToggleHtml() : '';
      s.innerHTML = prefix + summaryHtml();
      if (sectionEl) ensureKeyRow(sectionEl, sectionKey);
    });
  }

  // Tuning indicator lives next to the Fretboard section title — that's
  // the only place it's relevant. Shows tuning name + notes + degrees; a
  // "(custom)" pill indicates when z=y so users can see the custom path
  // is engaged at a glance.
  // When custom tuning is engaged, look up the loaded preset by matching
  // x.s (the assembled custom notes, low-to-high) against TUNINGS[].notes.
  // Returns the preset's name if found, '' otherwise (manual edit).
  function findCustomTuningName(x) {
    const want = String(x.s || '').trim();
    if (!want) return '';
    for (const k in TUNINGS) {
      if (TUNINGS[k].notes === want) return TUNINGS[k].name;
    }
    return '';
  }

  function renderSummaryStatus(x) {
    const isCustom = (x.z === 'y');
    // For custom tuning, show the name of the loaded preset if the notes
    // match one in TUNINGS. Falls back to "Custom" for hand-edited tunings.
    const tuningName = isCustom
      ? (findCustomTuningName(x) || 'Custom')
      : x.name;
    // Tuning text in the section title bar always reads in canonical
    // (low → high) order — the y switch only flips fretboard rows, not
    // this textual representation.
    const notesStr = isCustom ? x.s    : x.notes;
    const dgsStr   = isCustom ? x.sdgs : x.dgs;
    const tunEl = document.getElementById('fretboard_summary_tuning');
    if (tunEl) {
      let html = '';
      html += '<span class="st_lab">Tuning</span>';
      html += '<span class="st_val">' + escHtml(tuningName) + '</span>';
      if (notesStr) {
        html += '<span class="st_sep" aria-hidden="true">·</span>';
        html += '<span class="st_notes">' + escHtml(String(notesStr).trim()) + '</span>';
      }
      if (dgsStr) {
        html += '<span class="st_sep" aria-hidden="true">·</span>';
        html += '<span class="st_dgs">(' + escHtml(String(dgsStr).trim()) + ')</span>';
      }
      if (isCustom) {
        html += '<span class="st_custom_pill" aria-label="custom tuning engaged">custom</span>';
      }
      tunEl.innerHTML = html;
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

  // Compact grid mode — when on, the chord/scale grids skip empty (#_x_)
  // cells so each row reads as just the populated notes side by side.
  // Local-only preference; doesn't go into the URL since it's a display
  // toggle, not a sharable state.
  let _compactGrids = false;
  try { _compactGrids = localStorage.getItem('sf_compact_grids') === '1'; } catch (e) {}
  function setCompactGrids(v) {
    _compactGrids = !!v;
    try { localStorage.setItem('sf_compact_grids', _compactGrids ? '1' : '0'); } catch (e) {}
    if (window.SF_X) {
      renderChordGrid(window.SF_X);
      renderScaleGrid(window.SF_X);
      renderSummaryExtras(window.SF_X);   // refresh the icon's on/off state
      bindAutoSubmit();                   // re-bind change handlers on the
                                          // freshly rendered key pickers
    }
  }
  // (Hover-staff popover removed — pitch class without per-string octave
  // info wasn't useful for transcription. Always-visible Key Signatures
  // staves stay; see keySigStaffSvg above.)

  // Icon button for the section header — same shape as section_print/help.
  // Two SVGs: "stacked rows" when on (click spreads), "spread grid" when off
  // (click compacts). Lives inside summary_extras so the existing
  // bindSummaryExtras handler keeps clicks from toggling the parent <details>.
  function compactToggleHtml() {
    const on = _compactGrids;
    const title = on ? 'Compact mode on — click to show empty cells'
                     : 'Compact mode off — click to hide empty cells';
    // |<-->|  – two outer bars with a horizontal double-headed arrow.
    // Same icon for both states; the on-state is signalled by the button's
    // accent-coloured background, not a different icon.
    const icon = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
              + '<rect x="1" y="3" width="2" height="10"/>'
              + '<rect x="13" y="3" width="2" height="10"/>'
              + '<rect x="4.5" y="7.4" width="7" height="1.2"/>'
              + '<polygon points="6,5 4,8 6,11"/>'
              + '<polygon points="10,5 12,8 10,11"/>'
              + '</svg>';
    return '<button type="button" class="section_compact' + (on ? ' section_compact_on' : '')
         + '" title="' + escAttr(title) + '" aria-label="' + escAttr(title)
         + '" aria-pressed="' + (on ? 'true' : 'false') + '">'
         + icon
         + '</button>';
  }
  function bindCompactToggles() {
    if (document.body._compactToggleBound) return;
    document.body._compactToggleBound = true;
    document.body.addEventListener('click', function (e) {
      const btn = e.target.closest && e.target.closest('.section_compact');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      setCompactGrids(!_compactGrids);
    }, true);   // capture so it runs before bindSummaryExtras' stopPropagation
  }

  function renderChordGrid(x) {
    const root = document.getElementById('chord_grid_root');
    const i1 = KEYS.indexOf(x.k);
    const noteLetters = {
      _1_:  KEYS[i1],     _b2_: KEYS[i1 + 1], _2_:  KEYS[i1 + 2], _b3_: KEYS[i1 + 3],
      _3_:  KEYS[i1 + 4], _4_:  KEYS[i1 + 5], _b5_: KEYS[i1 + 6], _5_:  KEYS[i1 + 7],
      _b6_: KEYS[i1 + 8], _6_:  KEYS[i1 + 9], _b7_: KEYS[i1 + 10], _7_: KEYS[i1 + 11]
    };

    // 12-column layout. Every extension folds back into its basic-octave
    // column (9 → 2, ♭13 → ♭6, ♯11 → ♭5, etc.) since they share a pitch
    // class. The label inside each cell still shows the chord's
    // theoretical degree — so an extension that has no basic equivalent
    // active in this chord still reads "9" or "♭13", just sitting in the
    // "2" or "♭6" column where it belongs harmonically.
    const DEG_COLS = ['_1_','_b2_','_2_','_b3_','_3_','_4_','_b5_','_5_','_b6_','_6_','_b7_','_7_'];

    function buildDegHeader(idAttr, opts) {
      const cornersOnly = opts && opts.cornersOnly;
      let s = '<tr' + (idAttr ? ' id="' + idAttr + '"' : '') + '>'
            + '<td class="cg_corner_label">Chords</td>';
      if (!cornersOnly) {
        DEG_COLS.forEach(function (degId, i) {
          const note = noteLetters[degId];
          s += '<td class="cg_deg_header" id="' + degId + '">'
             + escHtml(note) + '(' + escHtml(DEGREES[i]) + ')</td>';
        });
      }
      s += '<td class="cg_corner_label">Chords</td></tr>';
      return s;
    }

    const compact = _compactGrids;
    let h = '<table id="chord_grid"' + (compact ? ' class="cg_compact"' : '') + '>';
    h += buildDegHeader('above_chord_grid', { cornersOnly: compact });
    let chordIdx = 0;
    for (const a in GRID) {
      const label = a.replace(/b/g, '♭').replace(/#/g, '♯');
      const chipDegs = fragToDegrees(GRID[a]);
      const isSelected = degSetsEqual(chipDegs, x.hl);
      const href = isSelected ? x._hilight_url : (x._hilight_url + hlMultiToCsv(GRID[a]));
      const labelTdCls = 'cg_chord_label' + (isSelected ? ' cg_selected' : '');
      const tip = degsAndNotesTip(label, chipDegs, x.k, 'chord');
      const labelCell = '<td class="' + labelTdCls + '">'
                      + '<a href="' + href + '" title="' + escAttr(tip) + '">' + escHtml(label) + '</a>'
                      + '</td>';
      h += '<tr' + (isSelected ? ' class="cg_row_selected"' : '') + '>' + labelCell;

      // Bucket the chord's filled slots by basic degree column. SF_GRID_ROWS
      // lists extensions first (rows 0–11) and basic-octave last (rows 12–
      // 23); take the first non-null write per column so extension labels
      // win if both end up populated for the same pitch class.
      const cellsByDeg = {};
      for (const slot of window.SF_GRID_ROWS) {
        const v = slot.cells[chordIdx];
        if (v !== null && cellsByDeg[slot.degId] === undefined) {
          cellsByDeg[slot.degId] = v;
        }
      }

      for (const degId of DEG_COLS) {
        if (cellsByDeg[degId] !== undefined) {
          const note = noteLetters[degId];
          h += '<td id="' + degId + '">' + escHtml(note) + '(' + escHtml(cellsByDeg[degId]) + ')</td>';
        } else if (!compact) {
          h += '<td id="_x_"></td>';
        }
      }
      h += labelCell + '</tr>';
      chordIdx++;
    }
    h += buildDegHeader('under_chord_grid', { cornersOnly: compact });
    h += '</table>';
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

    // Single-octave column order: 1, ♭2, 2, …, 7. The chord grid stacks an
    // octave on top of this; the scale grid sticks to the basic seven.
    const COLS = window.SF_GRID_ROWS.slice(12).reverse();

    // Parse SCALES["..."] = "&hl=1&hl=2&hl=b3..." into a Set of degree symbols
    const scaleDegrees = {};
    for (const name in SCALES) {
      const degs = SCALES[name].split('&hl=').slice(1)
        .map(function (s) { return s.replace(/&/g, ''); })
        .filter(function (s) { return s.length > 0; })
        .map(function (s) { return s.replace(/b/g, '♭'); });
      scaleDegrees[name] = degs;
    }

    function buildDegHeader(idAttr, opts) {
      const cornersOnly = opts && opts.cornersOnly;
      let s = '<tr' + (idAttr ? ' id="' + idAttr + '"' : '') + '>'
            + '<td class="cg_corner_label">Scales</td>';
      if (!cornersOnly) {
        for (const col of COLS) {
          const note = noteLetters[col.degId];
          s += '<td class="cg_deg_header" id="' + col.degId + '">'
             + escHtml(note) + escHtml(col.intervalLabel) + '</td>';
        }
      }
      s += '<td class="cg_corner_label">Scales</td></tr>';
      return s;
    }

    const compact = _compactGrids;
    let h = '<table id="scale_grid"' + (compact ? ' class="cg_compact"' : '') + '>';
    h += buildDegHeader('above_scale_grid', { cornersOnly: compact });
    for (const name in SCALES) {
      const label = name.replace(/_/g, ' ');
      const chipDegs = fragToDegrees(SCALES[name]);
      const isSelected = degSetsEqual(chipDegs, x.hl);
      const href = isSelected ? x._hilight_url : (x._hilight_url + hlMultiToCsv(SCALES[name]));
      const labelTdCls = 'cg_chord_label' + (isSelected ? ' cg_selected' : '');
      const tip = degsAndNotesTip(label, chipDegs, x.k, 'scale');
      const labelCell = '<td class="' + labelTdCls + '">'
                      + '<a href="' + href + '" title="' + escAttr(tip) + '">' + escHtml(label) + '</a>'
                      + '</td>';
      h += '<tr' + (isSelected ? ' class="cg_row_selected"' : '') + '>' + labelCell;
      for (const col of COLS) {
        const degSym = col.intervalLabel.replace(/[()]/g, '');
        if (scaleDegrees[name].indexOf(degSym) !== -1) {
          const note = noteLetters[col.degId];
          h += '<td id="' + col.degId + '">' + escHtml(note) + '(' + escHtml(degSym) + ')</td>';
        } else if (!compact) {
          h += '<td id="_x_"></td>';
        }
      }
      h += labelCell + '</tr>';
    }
    h += buildDegHeader('under_scale_grid', { cornersOnly: compact });
    h += '</table>';
    root.innerHTML = h;
  }

  // Build a URL that switches the key to `k` while preserving every other
  // current param. Used by the Key Signatures table rows.
  function buildKeySetHref(k) {
    const p = new URLSearchParams(window.location.search);
    p.set('k', urlNote(k));
    const qs = canonicalQS(p);
    return qs ? '?' + qs : '?';
  }

  // Jazz hand-signal indicator: a CSS sprite of img/fingers-up.png (or
  // fingers-down.png for flats), each holding 5 hand panels side by side.
  // Counts 1–5 render a single panel; 6 renders 5+1 and 7 renders 5+2 to
  // mirror the real-world two-hand signal for those keys.
  function fingerSvg(count, direction) {
    if (count <= 0) return '';
    const dirCls = direction === 'down' ? 'ks_hand_down' : 'ks_hand_up';
    const hands = count <= 5 ? [count] : [5, count - 5];
    // The source sprite shows one hand orientation. When two hands are
    // rendered (6 / 7 keys), mirror the second hand horizontally so the
    // thumbs face each other — matches what the gesture looks like IRL.
    const html = hands
      .map(function (n, i) {
        const mirror = (i > 0) ? ' ks_hand_mirror' : '';
        return '<span class="ks_hand ' + dirCls + ' ks_hand_' + n + mirror + '"></span>';
      })
      .join('');
    return '<span class="ks_fingers">' + html + '</span>';
  }

  // Render a treble-clef staff with `count` sharps or flats laid out in
  // canonical order. Uses inline SVG for the staff lines + Unicode glyphs
  // (𝄞, ♯, ♭) for the clef and accidentals — the latter two render in
  // every modern OS without a custom font dependency.
  function keySigStaffSvg(count, direction) {
    const isFlat = direction === 'down';
    // Treble-clef staff y-positions (line spacing 6px). Lines 1–5 from
    // bottom to top. Spaces are halfway between adjacent lines.
    const LINE_5 = 8;   // F5 (top line)        SPACE_4 = 11   E5 (top space)
    const LINE_4 = 14;  // D5                   SPACE_3 = 17   C5
    const LINE_3 = 20;  // B4 (middle line)     SPACE_2 = 23   A4
    const LINE_2 = 26;  // G4                   SPACE_1 = 29   F4
    const LINE_1 = 32;  // E4 (bottom line)
    const ABOVE_5 = 5;  // G5 (above the staff)
    // Canonical sharp positions: F♯ C♯ G♯ D♯ A♯ E♯ B♯
    const SHARP_Y = [LINE_5, 17, ABOVE_5, LINE_4, 23, 11, LINE_3];
    // Canonical flat positions: B♭ E♭ A♭ D♭ G♭ C♭ F♭
    const FLAT_Y  = [LINE_3, 11, 23, LINE_4, LINE_2, 17, 29];
    const yList   = isFlat ? FLAT_Y : SHARP_Y;
    const symbol  = isFlat ? '♭' : '♯';

    const cleffW = 12;
    const accW   = 6;
    const padR   = 4;
    const totalW = cleffW + count * accW + padR;
    const totalH = 38;

    let s = '<svg class="ks_staff" viewBox="0 0 ' + totalW + ' ' + totalH
          + '" width="' + totalW + '" height="' + totalH + '" aria-hidden="true">';
    // 5 staff lines
    for (let i = 0; i < 5; i++) {
      const y = LINE_5 + i * 6;
      s += '<line x1="0" y1="' + y + '" x2="' + totalW + '" y2="' + y
        +  '" stroke="currentColor" stroke-width="0.7"/>';
    }
    // Treble clef glyph — relies on system music-symbol fonts. Worst case
    // it shows as a missing-glyph box but the staff + accidentals still
    // convey the key signature.
    s += '<text x="-1" y="' + (LINE_1 + 2)
      +  '" font-family="\'Noto Music\',\'Bravura\',\'Segoe UI Symbol\',\'Apple Symbols\',serif"'
      +  ' font-size="26" fill="currentColor">𝄞</text>';
    // Accidentals
    for (let i = 0; i < count; i++) {
      const yMid = yList[i];
      const x = cleffW + i * accW;
      // ♯ has its visual center near baseline-3, ♭ near baseline-2; nudge
      // the y so the glyph straddles the target staff position.
      const yText = isFlat ? yMid + 2 : yMid + 3.5;
      s += '<text x="' + x + '" y="' + yText
        +  '" font-size="10.5" fill="currentColor" font-family="serif">'
        +  symbol + '</text>';
    }
    s += '</svg>';
    return s;
  }

  function renderKeySignatures(x) {
    const root = document.getElementById('key_signatures_root');
    if (!root) return;
    // Build a single combined table: sharps top→bottom = C# (7♯) … C (0),
    // then flats top→bottom = F (1♭) … C♭ (7♭). C major sits in the
    // middle as the shared 0-accidental row.
    // Three of the FLAT-side rows share a setKey with their SHARP-side
    // enharmonic twin (B/C♭, F♯/G♭, C♯/D♭). We only want ONE row to
    // light up for the current key — sharps render first, so the sharp
    // row wins and the flat-side dupe stays unhighlighted.
    const _curKnorm = urlNote(x.k);
    const _seenActive = Object.create(null);
    function rowHtml(r, isFlat) {
      const setKnorm = urlNote(r.setKey);
      const matches  = (setKnorm === _curKnorm);
      const isCurrent = matches && !_seenActive[setKnorm];
      if (isCurrent) _seenActive[setKnorm] = true;
      const cls = 'ks_row' + (isCurrent ? ' ks_row_current' : '');
      const sig = r.count === 0
        ? '0'
        : r.count + (isFlat ? '♭' : '♯');
      const direction = isFlat ? 'down' : 'up';
      const staff = keySigStaffSvg(r.count, direction);
      const fingers = r.count > 0 ? fingerSvg(r.count, direction) : '';
      const href = escHtml(buildKeySetHref(r.setKey));
      let row = '<tr class="' + cls + '">';
      row += '<td class="ks_notes"><a href="' + href + '">' + escHtml(r.notes) + '</a></td>';
      row += '<td class="ks_key"><a href="' + href + '">'
        +    escHtml(r.key) + ' <span class="ks_major">major</span></a></td>';
      row += '<td class="ks_sig_count">' + escHtml(sig) + '</td>';
      row += '<td class="ks_sig_staff">' + staff + '</td>';
      row += '<td class="ks_sig_hand">'  + fingers + '</td>';
      row += '</tr>';
      return row;
    }
    let h = '<div class="ks_layout">';
    h +=   '<div class="ks_panel">';
    h +=     '<table class="ks_table"><tbody>';
    // Sharps reversed: most-sharps first, C major last (the 0-row).
    for (const r of KEY_SIGS_SHARP.slice().reverse()) h += rowHtml(r, false);
    // Flats in natural order: 1 flat first (F major) … 7 flats last (C♭).
    for (const r of KEY_SIGS_FLAT) h += rowHtml(r, true);
    h +=   '</tbody></table></div>';
    // Right half: an interactive circle of fifths. Each outer wedge is a
    // major key, each inner wedge is its relative minor — clicking either
    // applies that key (same href as the table on the left).
    h +=   '<div class="ks_side">' + circleOfFifthsSvg(x) + '</div>';
    h += '</div>';
    root.innerHTML = h;
  }

  // -------- Circle of Fifths (SVG) ---------------------------------------
  // 12 wedges, 30° each, top = C major / A minor, going clockwise through
  // the sharps (G, D, A, …) to the bottom (F♯/G♭) and then up through the
  // flats. Three positions show enharmonic spellings (B/C♭, F♯/G♭, C♯/D♭).
  // Chromatic semitone offsets keyed by the URL-encoded note name. Used
  // to compute degree labels relative to the currently selected key.
  const COF_SEMI = {
    'C': 0,  'Cs': 1, 'Db': 1, 'D': 2, 'Ds': 3, 'Eb': 3, 'E': 4, 'Fb': 4,
    'F': 5,  'Es': 5, 'Fs': 6, 'Gb': 6, 'G': 7, 'Gs': 8, 'Ab': 8, 'A': 9,
    'As': 10,'Bb': 10,'B': 11, 'Cb': 11,
  };
  // Roman-numeral scale degrees (major-scale frame) for the 12 chromatic
  // intervals from a chosen tonic.
  const COF_DEGREES = ['I','♭II','II','♭III','III','IV','♭V','V','♭VI','VI','♭VII','VII'];
  function circleOfFifthsSvg(x) {
    // [majorLabel, majorSetKey, minorLabel, minorSetKey, enharmonicMajor?, enharmonicMajorSetKey?]
    const POS = [
      ['C',  'C',  'Am',  'A'],                         //  0  top
      ['G',  'G',  'Em',  'E'],                         //  1
      ['D',  'D',  'Bm',  'B'],                         //  2
      ['A',  'A',  'F♯m', 'Fs'],                        //  3
      ['E',  'E',  'C♯m', 'Cs'],                        //  4
      ['B',  'B',  'G♯m', 'Gs', 'C♭', 'Cb'],            //  5
      ['F♯', 'Fs', 'D♯m', 'Ds', 'G♭', 'Gb'],            //  6  bottom
      ['C♯', 'Cs', 'A♯m', 'As', 'D♭', 'Db'],            //  7
      // The app's canonical KEYS list is sharp-only, so flat keys round-trip
      // through their sharp enharmonic on URL state (the key-sig table on
      // the left does the same — its B♭/E♭/A♭ rows have setKey A♯/D♯/G♯).
      // Use those same setKeys here so clicking the circle highlights the
      // matching row in the table.
      ['A♭', 'Gs', 'Fm',  'F'],                         //  8
      ['E♭', 'Ds', 'Cm',  'C'],                         //  9
      ['B♭', 'As', 'Gm',  'G'],                         // 10
      ['F',  'F',  'Dm',  'D'],                         // 11
    ];
    const SIZE  = 360;
    const CX    = SIZE / 2;
    const CY    = SIZE / 2;
    const R_OUT = 175;   // outer ring outer radius
    const R_MID = 120;   // outer ring inner radius / inner ring outer
    const R_IN  = 65;    // inner ring inner radius (centre hole edge)
    const R_HOLE= 35;    // empty centre circle visible radius
    const STROKE = '#5a5a5a';
    const FILL_MAJ = 'rgba(255,255,255,0.06)';
    const FILL_MIN = 'rgba(255,255,255,0.02)';

    function pt(r, deg) {
      const rad = (deg - 90) * Math.PI / 180;
      return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
    }
    // Annular wedge path between rOuter / rInner from degStart → degEnd (clockwise).
    function wedgePath(rOuter, rInner, degStart, degEnd) {
      const [x1, y1] = pt(rOuter, degStart);
      const [x2, y2] = pt(rOuter, degEnd);
      const [x3, y3] = pt(rInner, degEnd);
      const [x4, y4] = pt(rInner, degStart);
      const large = (degEnd - degStart) > 180 ? 1 : 0;
      return 'M ' + x1.toFixed(2) + ' ' + y1.toFixed(2)
        +  ' A ' + rOuter + ' ' + rOuter + ' 0 ' + large + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2)
        +  ' L ' + x3.toFixed(2) + ' ' + y3.toFixed(2)
        +  ' A ' + rInner + ' ' + rInner + ' 0 ' + large + ' 0 ' + x4.toFixed(2) + ' ' + y4.toFixed(2)
        +  ' Z';
    }

    let s = '<svg class="cof_svg" viewBox="0 0 ' + SIZE + ' ' + SIZE + '" xmlns="http://www.w3.org/2000/svg" aria-label="Circle of fifths">';

    // Highlighted current key — match against major OR minor setKey.
    const curK = urlNote(x.k);
    // Tonic semitone for degree labels. Falls back to 0 (C) if the
    // selected key isn't recognised (shouldn't happen in practice).
    const tonicSemi = COF_SEMI[curK] != null ? COF_SEMI[curK] : 0;

    for (let i = 0; i < 12; i++) {
      const slot     = POS[i];
      const majLabel = slot[0], majKey = slot[1];
      const minLabel = slot[2], minKey = slot[3];
      const enLabel  = slot[4], enKey  = slot[5];
      const a0 = i * 30 - 15;
      const a1 = i * 30 + 15;
      const labAng = i * 30;   // wedge centre

      // Major + relative minor share the same key signature so they sit
      // in the same wedge position. Highlight by major name only — if
      // we ALSO matched the minor name, picking "A" would light up both
      // position 3 (A major) AND position 0 (C major, whose relative
      // minor is Am), which is misleading. Major-only keeps it 1:1.
      const wedgeActive = (urlNote(majKey) === curK)
        || (enKey && urlNote(enKey) === curK);
      const majActive = wedgeActive;
      const minActive = wedgeActive;

      // Outer (major) wedge — wrapped in <a> so it's clickable.
      s += '<a class="cof_wedge cof_maj' + (majActive ? ' cof_active' : '') + '" href="'
        +  escHtml(buildKeySetHref(majKey)) + '">';
      s += '<path d="' + wedgePath(R_OUT, R_MID, a0, a1) + '" fill="' + (majActive ? 'rgba(95,232,224,0.22)' : FILL_MAJ)
        +  '" stroke="' + STROKE + '" stroke-width="1"/>';
      // Major label
      const [lx, ly] = pt((R_OUT + R_MID) / 2, labAng);
      s += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" class="cof_lab cof_lab_maj"'
        +  ' text-anchor="middle" dominant-baseline="central">' + escHtml(majLabel) + '</text>';
      // Enharmonic small label (e.g. C♭ next to B), tucked outward.
      if (enLabel) {
        const [ex, ey] = pt((R_OUT + R_MID) / 2 + 12, labAng + 7);
        s += '<text x="' + ex.toFixed(1) + '" y="' + ey.toFixed(1) + '" class="cof_lab cof_lab_enh"'
          +  ' text-anchor="middle" dominant-baseline="central">' + escHtml(enLabel) + '</text>';
      }
      s += '</a>';

      // Inner (minor) wedge — link to the wedge's MAJOR setKey so that
      // clicking the relative minor still highlights the same wedge
      // position. (Picking the minor's root would jump highlighting to
      // a different wedge whose major key shares that root.)
      s += '<a class="cof_wedge cof_min' + (minActive ? ' cof_active' : '') + '" href="'
        +  escHtml(buildKeySetHref(majKey)) + '">';
      s += '<path d="' + wedgePath(R_MID, R_IN, a0, a1) + '" fill="' + (minActive ? 'rgba(95,232,224,0.22)' : FILL_MIN)
        +  '" stroke="' + STROKE + '" stroke-width="1"/>';
      const [mx, my] = pt((R_MID + R_IN) / 2, labAng);
      s += '<text x="' + mx.toFixed(1) + '" y="' + my.toFixed(1) + '" class="cof_lab cof_lab_min"'
        +  ' text-anchor="middle" dominant-baseline="central">' + escHtml(minLabel) + '</text>';
      s += '</a>';
    }

    // Empty centre hole — draw a filled circle so the donut reads cleanly.
    s += '<circle cx="' + CX + '" cy="' + CY + '" r="' + R_HOLE + '" fill="var(--bg-elevated)" stroke="' + STROKE + '" stroke-width="1"/>';

    s += '</svg>';
    return s;
  }

  function renderTuningsTable(x) {
    const root = document.getElementById('tunings_root');
    const rev = (x.y === 'y') ? 'rev_' : '';
    const tunUrl = x._self + x.url_k + x.url_y + x.url_z + x.url_s + x.url_hl;

    let h = '';
    // Filter bar: text input + quick-string-count buttons. Both fold into
    // the URL via ?f=… and ?fc=… so a filtered view is bookmarkable.
    h += '<div class="tunings_filter_bar">';
    h += '  <input type="search" id="filter" class="tunings_filter_input" placeholder="Filter — name, notes, info…" maxlength="64" value="' + escHtml(x._filter || '') + '" autocomplete="off" spellcheck="false">';
    h += '  <div class="tunings_strs" role="radiogroup" aria-label="Filter by string count">';
    ['', '4', '5', '6', '8', '10', '12'].forEach(function (v) {
      const active = (x._filterStrs === v) ? ' active' : '';
      const label = v === '' ? 'All' : v + '-string';
      h += '<button type="button" class="tunings_str_btn' + active + '" '
        +  'data-strs="' + v + '" role="radio" aria-checked="' + (x._filterStrs === v) + '">'
        +  escHtml(label) + '</button>';
    });
    h += '  </div>';
    h += '</div>';
    h += '<table class="sortable" id="tunings">';
    h += '<thead><tr>';
    h += '<th width="10%" class="num name"><button>Strings<span aria-hidden="true"></span></button></th>';
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

    key_signatures: [
      '',
      '  Key Signatures',
      '',
      '  Two reference tables side-by-side: sharp keys on the left',
      '  (C through C♯ major), flat keys on the right (F through C♭).',
      '  Each row shows the key, how many sharps or flats are in its',
      '  signature, and which notes those accidentals are.',
      '',
      '  The current site key is highlighted in cyan in whichever',
      '  table it lives in. Click any row to jump to that key.',
      '',
      '  Hand-signal flow during a gig: fingers up = sharps,',
      '  fingers down = flats. 3 fingers up → A major. 2 fingers',
      '  down → B♭ major.',
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
    // sync handler keeps every section's key picker at the same value. Falls
    // back to window.SF_X.k (parsed state) if no picker is in the DOM yet,
    // so the URL always carries k= once any change fires.
    //
    // In UNLINKED mode each picker shows its own section's effective key,
    // so reading from "the first picker" can clobber the global k. Use
    // window.SF_X.k (the parsed global) instead — it survives unchanged
    // until the user explicitly toggles back to Linked.
    const _unlinkedNow = document.body.getAttribute('data-apply-all') === 'off';
    const _kPick = document.querySelector('.section_key_picker select[name="k"]');
    if (_unlinkedNow && window.SF_X && window.SF_X.k) {
      parts.push('k=' + urlNote(window.SF_X.k));
    } else if (_kPick) {
      pushSelect(_kPick);
    } else if (window.SF_X && window.SF_X.k) {
      parts.push('k=' + urlNote(window.SF_X.k));
    }

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

    // Click-to-pick chord identifier set (pk) — carry as-is.
    const pkList = readPkParam(new URLSearchParams(window.location.search));
    if (pkList.length) parts.push('pk=' + pkList.join(','));

    // Custom-tuning strings combined into one no-separator `s=` param.
    // Three cases:
    //   z=y               → read selects, rebuild s=
    //   z=n + URL has s   → preserve URL s untouched (avoids overwriting
    //                       a 6-string custom with 12 form-select slots
    //                       when the main tuning has more strings)
    //   z=n + no URL s    → read selects so the URL captures the active
    //                       custom (e.g. on first state change after a
    //                       fresh page load with DEF_X defaults)
    const _zIsY = (_curParams.get('z') === 'y');
    const _curS = _curParams.get('s');
    function _readSFromForm() {
      const sels = fb.querySelectorAll('select[name^="s"]');
      const sVals = [];
      sels.forEach(function (sel) {
        const m = sel.name && sel.name.match(/^s(\d+)$/);
        if (!m) return;
        sVals[parseInt(m[1], 10) - 1] = urlNote(sel.value);
      });
      while (sVals.length && !sVals[sVals.length - 1]) sVals.pop();
      if (!sVals.length) return null;
      const normalized = sVals.map(function (v) { return v || ''; });
      const hasGap = normalized.some(function (v) { return !v; });
      return normalized.join(hasGap ? '.' : '');
    }
    if (fb && _zIsY) {
      const _v = _readSFromForm();
      if (_v) parts.push('s=' + _v);
    } else if (_curS) {
      parts.push('s=' + _curS);
    } else if (fb) {
      // No s in URL yet — write the form's current selects so the user's
      // first state change captures the active custom in the URL.
      const _v = _readSFromForm();
      if (_v) parts.push('s=' + _v);
    } else {
      // Legacy individual ?s1=…&s2=… preservation (rare).
      for (let i = 1; i <= 12; i++) {
        const _v = _curParams.get('s' + i);
        if (_v != null) parts.push('s' + i + '=' + _v);
      }
    }

    // Preserve unlinked-mode metadata so a tuning / chord-form change
    // doesn't accidentally re-link everything: keep the u flag and
    // every section-namespaced override (s<num>_k, s<num>_hl, ...).
    if (_unlinkedNow) {
      if (_curParams.get('u') === '1') parts.push('u=1');
      _curParams.forEach(function (v, k) {
        if (/^s\d+_/.test(k)) parts.push(k + '=' + encodeURIComponent(v));
      });
    }

    navigateTo('?' + parts.join('&'));
  }

  function navigateTo(search) {
    // Canonicalize param order so every navigation emits the same shape.
    let _norm = search;
    try {
      const _p = new URLSearchParams(String(search || '').replace(/^\?/, ''));
      const _qs = canonicalQS(_p);
      _norm = _qs ? '?' + _qs : '?';
    } catch (_) {}
    if (_norm === window.location.search || (_norm === '?' && !window.location.search)) return;
    const target = (_norm === '?' || _norm === '') ? window.location.pathname : _norm;
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
      // Key-picker changes have two modes depending on the "Apply: all"
      // toggle in the fretboard summary:
      //   ENGAGED (default) — propagate the new key to every section's
      //                        picker, then build a new URL → full re-
      //                        render. Single global key.
      //   DISENGAGED        — only the section whose picker changed is
      //                        re-rendered with the new key as a per-
      //                        section override. URL state untouched, so
      //                        other sections keep whatever key they had.
      if (e && e.target && e.target.matches && e.target.matches('select[name="k"]')) {
        const unlinked = document.body.getAttribute('data-apply-all') === 'off';
        if (unlinked) {
          // Project the new key onto the current URL as a section-
          // namespaced param so it persists + is shareable. Other
          // sections + the global k stay put.
          const sectionEl = e.target.closest('details.section, details.collapsible');
          if (sectionEl) {
            const fakeLinkSearch = '?k=' + encodeURIComponent(urlNote(e.target.value));
            const merged = mergeSectionOverrideUrl(sectionEl.id, fakeLinkSearch);
            if (merged != null) {
              navigateTo(merged);
              return;
            }
          }
          return;  // safety: don't fall through to global navigate
        }
        document.querySelectorAll('.section_key_picker select[name="k"]').forEach(function (sel) {
          if (sel !== e.target) sel.value = e.target.value;
        });
      }
      gatherAndNavigate();
    };
    document.querySelectorAll(
      '#options_root select, #options_root input[type="checkbox"], #fretboard_root select:not(.custom_tun_loader), .section_key_picker select[name="k"]'
    ).forEach(function (el) {
      el.addEventListener('change', handler);
    });
    // Chromatic key buttons in each section. Click → set the matching
    // hidden <select> and fire a change event so the existing handler
    // does the rest (URL build, propagation, navigate).
    if (!document.body.dataset.keyBtnDelegated) {
      document.body.dataset.keyBtnDelegated = '1';
      document.addEventListener('click', function (e) {
        const btn = e.target.closest && e.target.closest('.section_key_row .key_btn');
        if (!btn) return;
        const row = btn.closest('.section_key_row');
        const sel = row && row.querySelector('select.key_hidden_select');
        const newKey = btn.getAttribute('data-key');
        if (!sel || !newKey) return;
        sel.value = newKey;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
  }

  // ---- Per-section rerender (used when "Apply: all" is off) ---------
  // Calls only the targeted section's renderer(s) with the supplied
  // state object. Used both for key-picker changes (state = SF_X with k
  // overridden) and for chord/scale/keysig link clicks (state = the
  // link's URL parsed into a SF_X-shape via parseState).
  function rerenderSectionWithState(sectionId, x) {
    if (!x) return;
    switch (sectionId) {
      case 'section_2':
        if (typeof renderFretboard === 'function') renderFretboard(x);
        break;
      case 'section_3':
        if (typeof renderChordGrid === 'function') renderChordGrid(x);
        break;
      case 'section_4':
        if (typeof applyKeyboardColors === 'function') applyKeyboardColors(x);
        if (typeof renderKeyboardPicks === 'function') renderKeyboardPicks(x);
        break;
      case 'section_6':
        if (typeof renderScaleGrid === 'function') renderScaleGrid(x);
        break;
      case 'section_9':
        if (typeof renderKeySignatures === 'function') renderKeySignatures(x);
        break;
    }
  }
  function rerenderSectionWithKey(sectionId, k) {
    // Thin compatibility wrapper. Builds an override state by parsing
    // the current URL fresh (so other URL params are preserved) and
    // swapping in the new key, then routes through the generic helper.
    if (!k) return;
    const x = parseState();
    x.k = k;
    rerenderSectionWithState(sectionId, x);
  }

  // Take a "linked-style" URL (the kind the chord/scale/keysig links
  // pre-build, e.g. `?k=A&hl=1&hl=3&hl=5`) and merge its params into
  // the CURRENT URL as section-namespaced overrides for `sectionId`.
  // Used by the link interceptor when the page is in unlinked mode.
  // Returns the new query string (with leading "?"), or null if the
  // section ID doesn't match the s<num>_* convention.
  function mergeSectionOverrideUrl(sectionId, linkSearch) {
    const m = String(sectionId || '').match(/^section_(\d+)$/);
    if (!m) return null;
    const sNum = m[1];
    const cur = new URLSearchParams(window.location.search);
    const link = new URLSearchParams(linkSearch);

    // Drop existing overrides for this section so the new click wins
    // wholesale (avoids stale s4_hl=… plus a fresh s4_k=… colliding).
    Array.from(cur.keys())
      .filter(k => k.startsWith('s' + sNum + '_'))
      .forEach(k => cur.delete(k));

    // Project each interesting link param into a section-namespaced one.
    // Multi-value fields (hl, pk) compress to a single comma-joined value
    // — virtualSearchForSection expands them back at parse time.
    const single = ['k', 'x', 'y', 'z', 's'];
    single.forEach(f => {
      if (link.has(f)) cur.set('s' + sNum + '_' + f, link.get(f));
    });
    ['hl', 'pk'].forEach(f => {
      const arr = link.getAll(f);
      if (arr.length) cur.set('s' + sNum + '_' + f, arr.join(','));
      // hl can also arrive as a single comma value via the gathered form
      // — `link.has(f)` covers nothing extra in that case.
    });

    // Make sure the unlinked flag stays on; otherwise on next render
    // we'd parse the s<n>_* params as junk.
    cur.set('u', '1');
    const qs = cur.toString();
    return qs ? ('?' + qs) : '?';
  }

  // ---- Linked / Unlinked toggle (fretboard summary) -----------------
  // URL is the source of truth: `u=1` → unlinked (each section can
  // hold its own state via s<n>_* params). No `u` → linked (one
  // global state, current behavior). The toggle navigates the URL,
  // so reload + share preserve whichever mode you were in.
  let _applyAllBound = false;
  function paintApplyAllToggle() {
    const $btn = document.getElementById('apply_all_toggle');
    if (!$btn) return;
    const params = new URLSearchParams(window.location.search);
    const unlinked = params.get('u') === '1';
    document.body.setAttribute('data-apply-all', unlinked ? 'off' : 'on');
    $btn.classList.toggle('on', !unlinked);
    $btn.textContent = unlinked ? 'Unlinked' : 'Linked';
    $btn.setAttribute('aria-pressed', unlinked ? 'false' : 'true');
  }
  // ---- Audio toggle (♪) — Fretboard summary ----------------------
  let _audioToggleBound = false;
  function paintAudioToggle() {
    const $btn = document.getElementById('audio_toggle');
    if (!$btn) return;
    const on = audioOn();
    $btn.classList.toggle('on', on);
    $btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    $btn.title = on
      ? 'Audio on — click again to mute. Notes play when you click a fret or key.'
      : 'Audio off — click to play notes when you click a fret or key.';
  }
  function bindAudioToggle() {
    paintAudioToggle();
    if (_audioToggleBound) return;
    const $btn = document.getElementById('audio_toggle');
    if (!$btn) return;
    _audioToggleBound = true;
    $btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const turningOn = !audioOn();
      setAudioOn(turningOn);
      paintAudioToggle();
      // Pre-warm the AudioContext on the activating gesture so the
      // first played note doesn't have any user-gesture latency.
      if (turningOn) ensureAudioCtx();
    });
  }

  function bindApplyAllToggle() {
    paintApplyAllToggle();          // always repaint to reflect URL state
    if (_applyAllBound) return;
    const $btn = document.getElementById('apply_all_toggle');
    if (!$btn) return;
    _applyAllBound = true;
    $btn.addEventListener('click', function () {
      const params = new URLSearchParams(window.location.search);
      const wasUnlinked = params.get('u') === '1';
      if (wasUnlinked) {
        // Re-link → snap the global state to the FRETBOARD's current
        // effective view (its overrides become the new globals).
        // virtualSearchForSection already drops u= and every s<n>_*
        // prefix, then folds section_2's overrides on top of globals,
        // so the resulting query is exactly the linked-mode URL we
        // want — no full reset, no other section's overrides leak.
        const newSearch = virtualSearchForSection('section_2', window.location.search);
        navigateTo(newSearch ? ('?' + newSearch) : '?');
      } else {
        // Engage unlinked → flip the flag, leave existing state alone
        // so the current view becomes each section's starting point.
        params.set('u', '1');
        const qs = params.toString();
        navigateTo(qs ? ('?' + qs) : '?');
      }
    });
  }

  // Wire the custom-tuning preset loader. When the user picks a preset
  // from this dropdown, we map the preset's notes (low → high in the
  // data) into s1..sN (high → low — s1 is the topmost / highest string)
  // and navigate. The main x= tuning is left untouched, so the user can
  // mix a different preset's notes into a different-string-count main
  // tuning if they want.
  function bindCustomTuningLoader() {
    const sel = document.querySelector('.custom_tun_loader');
    if (!sel || sel._customLoaderBound) return;
    sel._customLoaderBound = true;
    sel.addEventListener('change', function () {
      const key = sel.value;
      if (!key || !TUNINGS[key]) return;
      const preset = TUNINGS[key];
      const noteList = String(preset.notes).split(/\s+/).reverse(); // high → low
      const params = new URLSearchParams(window.location.search);
      // Drop legacy s1..s12 + the compact s= so we can rewrite cleanly.
      params.delete('s');
      for (let i = 1; i <= 12; i++) params.delete('s' + i);
      const sVals = noteList.slice(0, 12).map(function (n) { return urlNote(n); });
      while (sVals.length && !sVals[sVals.length - 1]) sVals.pop();
      if (sVals.length) {
        // Same encoding as ?x= — note tokens with no separator unless
        // there's an internal gap (which the loader never produces).
        const _hasGap = sVals.some(function (v) { return !v; });
        params.set('s', sVals.join(_hasGap ? '.' : ''));
      }
      const qs = params.toString();
      navigateTo(qs ? '?' + qs : '?');
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
      // Build the URL from the raw href attribute, NOT `a.href`. SVG <a>
      // elements (e.g. inside the Circle of Fifths) expose `a.href` as
      // an SVGAnimatedString, which makes `new URL(a.href, …)` throw and
      // skip our interceptor → browser does a full reload (scrolls to top).
      let url;
      try { url = new URL(raw, window.location.href); } catch (_) { return; }
      // External or different-page links: let the browser handle them.
      if (url.origin !== window.location.origin) return;
      if (url.pathname !== window.location.pathname) return;
      e.preventDefault();
      // "Unlinked" mode → state-mutating clicks (chord cells, scale
      // cells, keysig rows, highlight pills) write section-namespaced
      // params (s<n>_k, s<n>_hl, s<n>_x, ...) onto the CURRENT URL
      // instead of replacing it. This way other sections keep their
      // overrides AND the unlinked state survives reload + share.
      const unlinked = document.body.getAttribute('data-apply-all') === 'off';
      if (unlinked) {
        const sectionEl = a.closest('details.section, details.collapsible');
        if (sectionEl) {
          const merged = mergeSectionOverrideUrl(sectionEl.id, url.search || '');
          if (merged != null) {
            navigateTo(merged);
            return;
          }
        }
      }
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
        const qs = canonicalQS(params);
        history.replaceState({}, '', qs ? '?' + qs : window.location.pathname);
      });
    });
  }

  // Filter the visible tunings table rows by both the text filter (matches
  // any cell's text, multi-token AND search) and the active string-count
  // button (6/8/10/12 or All). Either or both may be empty.
  function applyTuningsFilter(textValue, strsValue) {
    const table = document.getElementById('tunings');
    if (!table) return;
    const txt = String(textValue || '').toLowerCase().trim();
    const toks = txt ? txt.split(/\s+/) : [];
    const wantStrs = String(strsValue || '');
    table.querySelectorAll('tbody tr').forEach(function (tr) {
      const cells = tr.querySelectorAll('td');
      if (!cells.length) { tr.style.display = 'none'; return; }
      // First cell is the "N-String" label — pull the leading number out.
      const strsHere = String((cells[0].textContent || '').match(/^\d+/) || '');
      if (wantStrs && wantStrs !== strsHere) { tr.style.display = 'none'; return; }
      if (toks.length) {
        const hay = Array.prototype.map.call(cells, function (td) {
          return (td.textContent || '').toLowerCase();
        }).join(' ');
        const allMatch = toks.every(function (t) { return hay.indexOf(t) !== -1; });
        if (!allMatch) { tr.style.display = 'none'; return; }
      }
      tr.style.display = '';
    });
  }

  let _filterDebounce = null;
  function bindTuningsFilter() {
    const input = document.getElementById('filter');
    const root = document.getElementById('tunings_root');
    if (!input || !root) return;

    // Read current state from URL on bind so re-renders pick up persisted vals
    function urlState() {
      const p = new URLSearchParams(window.location.search);
      return {
        text: (p.get('f') || ''),
        strs: (function () {
          const v = p.get('fc');
          return (v === '4' || v === '5' || v === '6' || v === '8' || v === '10' || v === '12') ? v : '';
        })()
      };
    }
    function persist(text, strs) {
      const params = new URLSearchParams(window.location.search);
      if (text) params.set('f', text); else params.delete('f');
      if (strs) params.set('fc', strs); else params.delete('fc');
      const qs = canonicalQS(params);
      history.replaceState({}, '', qs ? '?' + qs : window.location.pathname);
    }
    function refresh() {
      const s = urlState();
      applyTuningsFilter(s.text, s.strs);
      // Sync button active states with URL
      root.querySelectorAll('.tunings_str_btn').forEach(function (btn) {
        const v = btn.getAttribute('data-strs') || '';
        if (v === s.strs) btn.classList.add('active');
        else btn.classList.remove('active');
        btn.setAttribute('aria-checked', v === s.strs ? 'true' : 'false');
      });
    }

    refresh();

    input.addEventListener('input', function () {
      const value = String(input.value || '').slice(0, 64);
      if (input.value !== value) input.value = value;
      const s = urlState();
      applyTuningsFilter(value, s.strs);
      if (_filterDebounce) clearTimeout(_filterDebounce);
      _filterDebounce = setTimeout(function () { persist(value, s.strs); }, 300);
    });

    root.addEventListener('click', function (e) {
      const btn = e.target.closest && e.target.closest('.tunings_str_btn');
      if (!btn) return;
      e.preventDefault();
      const want = btn.getAttribute('data-strs') || '';
      const cur = urlState();
      const nextStrs = (cur.strs === want) ? '' : want;
      persist(cur.text, nextStrs);
      refresh();
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

    // Guard the toggle handlers — when applyCollapseFromUrl restores state
    // from localStorage on page load, removing the `open` attr fires a
    // <details> "toggle" event that would otherwise write c=… back to
    // the URL bar immediately. Suppress that during initial restore so a
    // bare URL stays bare.
    _suppressCollapseUrl = true;
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
    // Clear the guard on the next tick so any user-triggered toggles
    // dispatched after this microtask still write to the URL normally.
    setTimeout(function () { _suppressCollapseUrl = false; }, 0);
  }
  let _suppressCollapseUrl = false;

  function updateClosedInUrl() {
    const params = new URLSearchParams(window.location.search);
    const closed = [];
    document.querySelectorAll('details.collapsible').forEach(function (d) {
      if (!d.open) closed.push(d.id.replace('section_', ''));
    });
    if (closed.length) params.set('c', closed.join(','));
    else params.delete('c');
    const qs = canonicalQS(params);
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
        // Only push c=… to the URL on real user toggles. Suppressed during
        // applyCollapseFromUrl's initial DOM-attribute restore so bare URLs
        // don't gain a c=… param the moment the page loads.
        if (!_suppressCollapseUrl) updateClosedInUrl();
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
    // Tag every keyboard label cell with data-note so the click-to-pick
    // delegated handler can read it. We set this each render in case the
    // keyboard DOM was just rebuilt.
    for (const note in KEYBOARD_NOTE_CLASSES) {
      const def = KEYBOARD_NOTE_CLASSES[note];
      (def.lbl || def.cls).forEach(function (c) {
        document.querySelectorAll('.ritz .waffle .' + c).forEach(function (el) {
          el.setAttribute('data-note', note);
        });
      });
    }
    // Assign data-midi by walking white- and black-key cells in DOM order.
    // The visible piano spans A0 (MIDI 21) → C8 (MIDI 108). White keys
    // step through the diatonic offsets [0,2,3,5,7,8,10] from each A.
    // Black keys step through [1,4,6,9,11].
    (function () {
      const tbl = document.getElementById('keyboard');
      if (!tbl) return;
      const rows = tbl.querySelectorAll('tr');
      // Find the black-key and white-key rows by inspecting their first td label.
      let whiteRow = null, blackRow = null;
      rows.forEach(function (r) {
        const first = r.querySelector('td');
        if (!first) return;
        const txt = (first.textContent || '').trim().toLowerCase();
        if (txt === 'white keys') whiteRow = r;
        else if (txt === 'black keys') blackRow = r;
      });
      const WHITE_OFF = [0, 2, 3, 5, 7, 8, 10];   // A B C D E F G from A
      const BLACK_OFF = [1, 4, 6, 9, 11];         // A♯ C♯ D♯ F♯ G♯
      function assign(row, offs) {
        if (!row) return;
        const cells = row.querySelectorAll('td[data-note]');
        cells.forEach(function (cell, idx) {
          const cycle = Math.floor(idx / offs.length);
          const pos   = idx % offs.length;
          const midi  = 21 + 12 * cycle + offs[pos];
          cell.setAttribute('data-midi', String(midi));
        });
      }
      assign(whiteRow, WHITE_OFF);
      assign(blackRow, BLACK_OFF);
    })();
    // If any highlights are set, dim notes outside the set so the chosen ones pop.
    // White keys dimmed → plain white bg with text close to white (label fades).
    // Black keys dimmed → label color close to the dark cell bg (also fades).
    const anyHighlighted = DEGREES.some(function (d) {
      return x['hl_' + d.replace('♭', 'b')] === 'y';
    });
    // Real piano: white keys are white, black keys are dark. Dimmed = label fades into bg.
    // Match the fretboard's light-grey "tabletop" so both reference surfaces feel the same.
    const DIM_WHITE_BG    = '#a8a8a8';
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
      const inPickSet = !!(x._pk_set && x._pk_set.has(note));
      def.cls.forEach(function (c) {
        const sel = '.ritz .waffle .' + c;
        if (inPickSet) {
          // Click-to-pick chord-identifier ring (fluorescent yellow).
          css += sel + ' { box-shadow: inset 0 0 0 3px #ffeb00 !important; }\n';
        }
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
        css += sel + '::after { content: "(' + escapeCssString(deg) + ')"; display: block; '
                  +  'font-size: 0.78em; line-height: 1; opacity: 0.85; '
                  +  'color: ' + degColor + '; }\n';
      });
    }
    style.textContent = css;
  }

  // ---------- click-to-pick + chord identifier ----------
  // Pitch-class index used by the chord-identifier lookup. MUST match the
  // C-indexed numbering in js/chord_lookup.js (C=0, C♯=1, ..., B=11).
  // Don't be tempted to derive this from ALLNOTES — that's A-indexed and
  // would put the masks one fifth away from where they belong.
  const NOTE_TO_PC = {
    'C': 0, 'C♯': 1, 'D': 2, 'D♯': 3, 'E': 4, 'F': 5,
    'F♯': 6, 'G': 7, 'G♯': 8, 'A': 9, 'A♯': 10, 'B': 11
  };
  const PC_TO_NOTE = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];

  // Default "+N" cap for the "Selected ⊂ Chord" identify bucket. Stored on
  // the URL-suppressed local-only side so the choice doesn't leak into share
  // links — picks themselves do, the cap pref does not.
  let _identifyExtras = 1;        // 1 / 2 / Infinity ("All")
  try {
    const stored = localStorage.getItem('sf_identify_extras');
    if (stored === '1' || stored === '2' || stored === 'all') {
      _identifyExtras = stored === 'all' ? Infinity : +stored;
    }
  } catch (e) {}

  function setIdentifyExtras(v) {
    _identifyExtras = v;
    try {
      localStorage.setItem('sf_identify_extras', v === Infinity ? 'all' : String(v));
    } catch (e) {}
    if (window.SF_X) renderIdentifyStrips(window.SF_X);
  }

  // Toggle the clicked note in the pk= URL list. Suppresses default link
  // behavior so the page stays put; uses the same history.replaceState path
  // as the rest of the navigation (via the shared link interceptor), so the
  // app re-renders in place.
  function bindNotePick() {
    function handler(e) {
      const cell = e.target.closest && e.target.closest('[data-note]');
      if (!cell) return;
      // Don't capture clicks on form controls inside cells (the s1..sN selects).
      if (e.target.closest('select, input, button, a')) return;
      const note = cell.getAttribute('data-note');
      if (!note) return;
      e.preventDefault();
      // Audio playback (off by default, toggled via the ♪ button in the
      // Fretboard summary). Reads data-midi from the cell — independent
      // of the chord-identifier pick logic that follows.
      if (audioOn()) {
        const midiStr = cell.getAttribute('data-midi');
        const m = midiStr ? parseInt(midiStr, 10) : NaN;
        if (!isNaN(m)) playMidi(m);
      }
      // Section-aware: in unlinked mode each section has its own picks
      // so the fretboard click writes s2_pk and the keyboard click
      // writes s4_pk. Linked mode keeps the global `pk`.
      const _isKb = !!e.target.closest('.ritz');
      const sectionId = _isKb ? 'section_4' : 'section_2';
      const cur = readPkArrForSection(sectionId)
        .map(function (v) {
          const f = bToFlat(sharpToHash(v));
          const FLAT_TO_SHARP = { 'A♭':'G♯','B♭':'A♯','C♭':'B','D♭':'C♯','E♭':'D♯','F♭':'E','G♭':'F♯' };
          return FLAT_TO_SHARP[f] || f;
        });
      const i = cur.indexOf(note);
      const next = i === -1 ? cur.concat([note]) : cur.filter(function (n) { return n !== note; });
      const href = buildPkHref(next, sectionId);
      const qs = href.slice(1);
      const newUrl = window.location.pathname + (qs ? '?' + canonicalQS(new URLSearchParams(qs)) : '');
      // Anchor scroll to the clicked element so the page doesn't appear to
      // shift when the identify strip grows / shrinks above it. The fretboard
      // table is rebuilt by applyState; the keyboard table is static. Either
      // way we find the anchor again by id/class after the re-render and
      // compensate for any vertical delta.
      const anchorSel = _isKb ? '#section_4' : '#fretboard';
      const anchorBefore = (function () {
        const el = document.querySelector(anchorSel);
        return el ? el.getBoundingClientRect().top : null;
      })();
      history.replaceState(null, '', newUrl);
      applyState();
      if (anchorBefore !== null) {
        const el = document.querySelector(anchorSel);
        if (el) {
          const delta = el.getBoundingClientRect().top - anchorBefore;
          if (delta) window.scrollBy(0, delta);
        }
      }
    }
    const fb = document.getElementById('fretboard');
    if (fb && !fb._pickBound) {
      fb._pickBound = true;
      fb.addEventListener('click', handler);
    }
    document.querySelectorAll('.ritz .waffle [data-note]').forEach(function (el) {
      // Visual cue that keys are clickable
      el.style.cursor = 'pointer';
    });
    const kb = document.querySelector('.ritz .waffle');
    if (kb && !kb._pickBound) {
      kb._pickBound = true;
      kb.addEventListener('click', handler);
    }
  }

  // ---------- chord identify strip ----------
  // Convert a pk Set (notes like "A","C♯") to a 12-bit pitch-class mask.
  function pkSetToMask(pkSet) {
    let m = 0;
    pkSet.forEach(function (n) {
      const pc = NOTE_TO_PC[n];
      if (pc !== undefined) m |= (1 << pc);
    });
    return m;
  }
  function popcount(n) {
    let c = 0;
    while (n) { n &= n - 1; c++; }
    return c;
  }

  // Score chords against the picks. Returns three arrays:
  //   exact:     chord.mask == sel
  //   subset:    chord.mask ⊂ sel  (chord lives inside what you played)
  //   superset:  sel ⊂ chord.mask  (you played part of a chord), capped by
  //              the +N extras setting
  function classifyChords(selMask) {
    const data = (window.SLANT_CHORDS && window.SLANT_CHORDS.chords) || [];
    const selSize = popcount(selMask);
    const exact = [];
    const subset = [];
    const superset = [];
    const extrasCap = _identifyExtras;
    for (let i = 0; i < data.length; i++) {
      const m = data[i][0];
      const name = data[i][1];
      if (m === selMask) {
        exact.push(name);
        continue;
      }
      // chord ⊂ sel: every chord bit is set in sel
      if ((m & selMask) === m && m !== 0 && m !== selMask) {
        subset.push({ name: name, size: popcount(m) });
        continue;
      }
      // sel ⊂ chord: every sel bit is set in chord, with a cap on extras
      if ((m & selMask) === selMask && m !== selMask) {
        const extras = popcount(m) - selSize;
        if (extras <= extrasCap) superset.push({ name: name, extras: extras });
      }
    }
    // Sort: subset by chord size desc, then name; superset by extras asc, then name
    subset.sort(function (a, b) {
      if (a.size !== b.size) return b.size - a.size;
      return a.name.localeCompare(b.name);
    });
    superset.sort(function (a, b) {
      if (a.extras !== b.extras) return a.extras - b.extras;
      return a.name.localeCompare(b.name);
    });
    return { exact: exact.sort(), subset: subset, superset: superset };
  }

  // Build a URL that pre-loads the chord — we set k= to the chord's root and
  // hl= to its degrees relative to that root. Strip pk= so the user moves
  // from "what is this?" to "show me this chord on the board" cleanly.
  function applyChordHref(chordName, chordMask) {
    // Find root: longest matching note letter at the start of the name.
    // Walk sharps last so "C♯..." beats "C..." when present.
    let root = null;
    for (const n of PC_TO_NOTE) {
      if (chordName.indexOf(n) === 0 && (root === null || n.length > root.length)) {
        root = n;
      }
    }
    if (!root) return null;
    const rootPc = NOTE_TO_PC[root];
    // Rotate mask to root: degree d is set when bit (rootPc+d)%12 is set.
    const DEG_LBL = ['1','♭2','2','♭3','3','4','♭5','5','♭6','6','♭7','7'];
    const degs = [];
    for (let i = 0; i < 12; i++) {
      if ((chordMask >> ((rootPc + i) % 12)) & 1) degs.push(DEG_LBL[i]);
    }
    const p = new URLSearchParams(window.location.search);
    p.delete('hl'); p.set('k', urlNote(root));
    // Keep pk= so picking a chord chip doesn't reset the user's pick set —
    // they often want to keep exploring from the same selection.
    if (degs.length) {
      p.append('hl', degs.map(function (d) { return d.replace('♭', 'b'); }).join(','));
    }
    return '?' + canonicalQS(p);
  }

  function renderIdentifyStrips(xFB, xKB) {
    const fbHost = document.getElementById('fb_identify_root');
    const kbHost = document.getElementById('kb_identify_root');
    if (!fbHost && !kbHost) return;

    // Each section gets its OWN identify strip (rendered from its own
    // section state) so picks don't leak across in unlinked mode.
    function buildHtml(xs, sectionId) {

    const pkArr = String(xs.pk || '').split(' ').filter(function (v) { return v.length; });
    let html;
    if (pkArr.length < 3) {
      const rem = 3 - pkArr.length;
      html = '<div class="identify_strip identify_hint">'
           + '<span class="identify_label">Identify:</span> '
           + 'click ' + (pkArr.length === 0 ? '3 or more' : (rem + ' more'))
           + ' fret cell' + (rem === 1 ? '' : 's') + ' or piano key'
           + (rem === 1 ? '' : 's') + ' to identify a chord '
           + '<span class="identify_count">(' + pkArr.length + '/3)</span>'
           + '</div>';
    } else {
      const selMask = pkSetToMask(xs._pk_set);
      const buckets = classifyChords(selMask);
      const clearHref = buildPkHref([], sectionId);

      function chipsHtml(items, extractName) {
        if (!items.length) return '<span class="identify_empty">none</span>';
        return items.map(function (it) {
          const name = extractName ? extractName(it) : it;
          // Find this chord's mask so we can build an apply URL + tooltip.
          const data = (window.SLANT_CHORDS && window.SLANT_CHORDS.chords) || [];
          let mask = 0;
          for (let j = 0; j < data.length; j++) {
            if (data[j][1] === name) { mask = data[j][0]; break; }
          }
          // Resolve root + degree set so we can render tooltip + detect
          // engagement (chip is "on" when x.k matches this chord's root and
          // x.hl matches its degree set).
          let root = null, rootPc = -1;
          for (const n of PC_TO_NOTE) {
            if (name.indexOf(n) === 0 && (root === null || n.length > root.length)) {
              root = n; rootPc = NOTE_TO_PC[n];
            }
          }
          let tip = name;
          let degsStr = '';
          if (mask && rootPc >= 0) {
            const DEG_LBL = ['1','♭2','2','♭3','3','4','♭5','5','♭6','6','♭7','7'];
            const degs = [], notes = [];
            for (let i = 0; i < 12; i++) {
              if ((mask >> ((rootPc + i) % 12)) & 1) {
                degs.push(DEG_LBL[i]);
                notes.push(PC_TO_NOTE[(rootPc + i) % 12]);
              }
            }
            degsStr = degs.join(' ');
            tip = name + '\nDegrees: ' + degsStr + '\nNotes: ' + notes.join(' ');
          }
          const isEngaged = root === xs.k && degSetsEqual(degsStr, xs.hl);
          let href;
          if (isEngaged) {
            // Disengage: clear hl, keep everything else (including pk).
            const p = new URLSearchParams(window.location.search);
            p.delete('hl');
            const _qs = canonicalQS(p);
            href = _qs ? '?' + _qs : '?';
          } else {
            href = applyChordHref(name, mask) || '#';
          }
          const cls = 'identify_chip' + (isEngaged ? ' identify_chip_on' : '');
          return '<a class="' + cls + '" href="' + escHtml(href) + '" title="' + escAttr(tip) + '">' + escHtml(name) + '</a>';
        }).join('');
      }

      const extras = _identifyExtras;
      const extrasPills = ['1', '2', 'All'].map(function (lbl) {
        const v = lbl === 'All' ? Infinity : +lbl;
        const on = (extras === v) ? ' identify_pill_on' : '';
        return '<a class="identify_pill' + on + '" href="#" data-extras="' + lbl + '">+' + lbl + '</a>';
      }).join('');

      html = ''
        + '<div class="identify_strip">'
        + '  <div class="identify_head">'
        + '    <span class="identify_label">Identify:</span>'
        + '    <span class="identify_picks">picked: ' + escHtml(pkArr.join(' ')) + '</span>'
        + '    <a class="identify_clear" href="' + escHtml(clearHref) + '">Clear picks</a>'
        + '  </div>'
        + '  <div class="identify_row">'
        + '    <span class="identify_bucket_label">Exact</span>'
        + '    <span class="identify_chips">' + chipsHtml(buckets.exact) + '</span>'
        + '  </div>'
        + '  <div class="identify_row">'
        + '    <span class="identify_bucket_label">Contains</span>'
        + '    <span class="identify_chips">'
        +        chipsHtml(buckets.subset, function (it) { return it.name; })
        + '    </span>'
        + '  </div>'
        + '  <div class="identify_row">'
        + '    <span class="identify_bucket_label">Could be (+ extras)</span>'
        + '    <span class="identify_extras_toggle">' + extrasPills + '</span>'
        + '    <span class="identify_chips">'
        +        chipsHtml(buckets.superset, function (it) { return it.name; })
        + '    </span>'
        + '  </div>'
        + '</div>';
    }
      return html;
    }

    if (fbHost) fbHost.innerHTML = buildHtml(xFB, 'section_2');
    if (kbHost) kbHost.innerHTML = buildHtml(xKB, 'section_4');

    // Wire +N pills + anchor-scroll for any link click inside the strip
    // (delegated, idempotent). Without anchor-scroll, the Clear-picks link
    // shrinks the strip, which lets every section above it slide up — and
    // the user sees the page jump toward the URL bar.
    [fbHost, kbHost].forEach(function (host) {
      if (!host || host._extrasBound) return;
      host._extrasBound = true;
      const anchorSel = (host === fbHost) ? '#fretboard' : '#section_4';
      host.addEventListener('click', function (e) {
        // +N extras pill — local toggle, no navigation.
        const pill = e.target.closest && e.target.closest('.identify_pill');
        if (pill) {
          e.preventDefault();
          e.stopPropagation();
          const lbl = pill.getAttribute('data-extras');
          setIdentifyExtras(lbl === 'All' ? Infinity : +lbl);
          return;
        }
        // Any link inside the strip (Clear picks, chord chips). Capture the
        // anchor's viewport position before the URL change and adjust scroll
        // afterward so the section the user is interacting with stays put.
        const link = e.target.closest && e.target.closest('a');
        if (!link) return;
        let url;
        try { url = new URL(link.href, window.location.href); } catch (_) { return; }
        if (url.origin !== window.location.origin) return;
        if (url.pathname !== window.location.pathname) return;
        e.preventDefault();
        e.stopPropagation();
        const anchorEl = document.querySelector(anchorSel);
        const before = anchorEl ? anchorEl.getBoundingClientRect().top : null;
        navigateTo(url.search || '?');
        if (before !== null) {
          const el = document.querySelector(anchorSel);
          if (el) {
            const delta = el.getBoundingClientRect().top - before;
            if (delta) window.scrollBy(0, delta);
          }
        }
      });
    });
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

  // Site-key-aware degree → note mapping.
  function _qDegsToNotes(degs, key) {
    const i1 = KEYS.indexOf(key);
    if (i1 < 0) return [];
    return degs.map(function (d) {
      const off = DEGREES.indexOf(d);
      return off < 0 ? '' : KEYS[i1 + off];
    });
  }

  function generateQuizQuestion(x) {
    const r = Math.random();
    if (r < 0.20) return _qKeySignature();
    if (r < 0.40) return _qKeySignatureCount();
    if (r < 0.60) return _qScaleByDegrees(x);
    if (r < 0.80) return _qChordByDegrees(x);
    return _qInKey();
  }

  function _qScaleByDegrees(x) {
    const names = Object.keys(SCALES);
    const target = _qPickRandom(names);
    const distractors = _qPickN(names.filter(function (n) { return n !== target; }), 3);
    const choices = _qShuffle([target].concat(distractors)).map(_qPrettyScale);
    const degs = _qDegList(SCALES[target]);
    return {
      prompt: 'Which scale has these degrees?',
      showcase: degs.join('  '),
      showcaseSub: _qDegsToNotes(degs, x.k).join('  '),
      showcaseSubLabel: 'In key of ' + x.k,
      choices: choices,
      answer: _qPrettyScale(target)
    };
  }

  function _qChordByDegrees(x) {
    const names = Object.keys(GRID);
    const target = _qPickRandom(names);
    const distractors = _qPickN(names.filter(function (n) { return n !== target; }), 3);
    const choices = _qShuffle([target].concat(distractors)).map(_qPrettyChord);
    const degs = _qDegList(GRID[target]);
    return {
      prompt: 'Which chord has these degrees?',
      showcase: degs.join('  '),
      showcaseSub: _qDegsToNotes(degs, x.k).join('  '),
      showcaseSubLabel: 'In key of ' + x.k,
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

    const degs = _qDegList(pool[target]);
    const notes = _qDegsToNotes(degs, key);

    return {
      prompt: 'In the key of ' + key + ', which ' + (isScale ? 'scale' : 'chord') + ' has these notes?',
      showcase: notes.join('  '),
      showcaseSub: degs.join('  '),
      showcaseSubLabel: 'Degrees',
      choices: choices,
      answer: fmt(target)
    };
  }

  // "What key has N sharps/flats?" — answer is one of the major keys.
  function _qKeySignature() {
    const useFlats = Math.random() < 0.5;
    const set = useFlats ? KEY_SIGS_FLAT : KEY_SIGS_SHARP.slice(1); // skip C (0 accidentals)
    const target = _qPickRandom(set);
    const distractors = _qPickN(set.filter(function (r) { return r.key !== target.key; }), 3);
    const allKeyNames = (KEY_SIGS_SHARP.concat(KEY_SIGS_FLAT)).map(function (r) { return r.key; });
    // Pad distractors with random keys if there aren't enough in this side
    while (distractors.length < 3) {
      const random = _qPickRandom(allKeyNames);
      if (random !== target.key && !distractors.some(function (d) { return d.key === random; })) {
        distractors.push({ key: random });
      }
    }
    const choices = _qShuffle([target].concat(distractors)).map(function (r) {
      return r.key + ' major';
    });
    return {
      prompt: 'Which key has ' + target.count + ' ' + (useFlats ? 'flat' : 'sharp')
        + (target.count === 1 ? '' : 's') + '?',
      showcase: target.notes,
      showcaseSubLabel: '',
      choices: choices,
      answer: target.key + ' major'
    };
  }

  // "How many sharps/flats are in <key> major?" — answer is the count.
  function _qKeySignatureCount() {
    const all = KEY_SIGS_SHARP.concat(KEY_SIGS_FLAT.filter(function (r) { return r.count > 0; }));
    const target = _qPickRandom(all);
    const isFlat = KEY_SIGS_FLAT.indexOf(target) !== -1;
    const word = isFlat ? 'flats' : 'sharps';
    const correct = String(target.count);
    const distractors = _qShuffle(['0', '1', '2', '3', '4', '5', '6', '7']
      .filter(function (n) { return n !== correct; })).slice(0, 3);
    const choices = _qShuffle([correct].concat(distractors));
    return {
      prompt: 'How many ' + word + ' in ' + target.key + ' major?',
      showcase: target.notes,
      showcaseSubLabel: '',
      choices: choices,
      answer: correct
    };
  }

  function renderQuiz() {
    const root = document.getElementById('quiz_root');
    if (!root) return;
    // Pass current site state in so degree-based questions can echo the
    // notes for the user's chosen key on a sub-line below the degrees.
    const q = generateQuizQuestion(window.SF_X || { k: 'A' });
    _quizCurrent = q;
    let h = '<div class="quiz_card">';
    h += '<div class="quiz_prompt">' + escHtml(q.prompt) + '</div>';
    h += '<div class="quiz_showcase">' + escHtml(q.showcase) + '</div>';
    // Reserve the showcase-sub slot every render — even when there's no
    // sub text — so questions that DO carry a "In key of …" line don't
    // bump the choices down and re-flow the page on appearance.
    h += '<div class="quiz_showcase_sub' + (q.showcaseSub ? '' : ' quiz_showcase_sub_empty') + '">';
    if (q.showcaseSub) {
      h += (q.showcaseSubLabel ? '<span class="quiz_sub_label">' + escHtml(q.showcaseSubLabel) + ':</span> ' : '')
         + escHtml(q.showcaseSub);
    } else {
      h += '&nbsp;';
    }
    h += '</div>';
    h += '<div class="quiz_choices">';
    q.choices.forEach(function (c) {
      h += '<button type="button" class="quiz_choice">' + escHtml(c) + '</button>';
    });
    h += '</div>';
    h += '<div class="quiz_skip_row"><button type="button" class="quiz_skip">Skip →</button></div>';
    h += '<div class="quiz_feedback"></div>';
    h += '</div>';
    root.innerHTML = h;
    root.querySelectorAll('.quiz_choice').forEach(function (btn) {
      btn.addEventListener('click', _quizHandleChoice);
    });
    const skip = root.querySelector('.quiz_skip');
    if (skip) skip.addEventListener('click', renderQuiz);
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
    // When the URL says "unlinked", each section gets its own state
    // built by overlaying that section's s<n>_* overrides onto the
    // global params. Sections without overrides use the global x.
    // Linked mode (default) → every section sees the same x.
    const xFB = stateForSection('section_2', x);
    const xKB = stateForSection('section_4', x);
    const xCG = stateForSection('section_3', x);
    const xSG = stateForSection('section_6', x);
    const xKS = stateForSection('section_9', x);
    renderFretboard(xFB);   // creates #options_root in the middle column
    renderOptions(x);       // form below the fretboard mirrors the GLOBAL state
    renderChordGrid(xCG);
    renderScaleGrid(xSG);
    renderTuningsTable(x);
    renderKeySignatures(xKS);
    applyKeyboardColors(xKB);
    renderKeyboardPicks(xKB);
    bindTuningPicker(x);
    applyCollapseFromUrl();

    renderSummaryExtras(x);  // populate summary dropdowns BEFORE binding
    renderSummaryStatus(x);  // compact key/tuning text in each title bar
    bindAutoSubmit();        // so the change-listener catches them
    bindCustomTuningLoader();// custom-tuning preset loader (bottom-left cell)
    bindCompactToggles();    // chord/scale grid compact-mode checkboxes
    bindNotePick();          // click fret cells / keyboard keys to pick notes
    bindApplyAllToggle();    // one-time wire of the Apply: all chip in fretboard summary
    bindAudioToggle();       // one-time wire of the ♪ audio toggle in fretboard summary
    if (window.SF_TabCapture && typeof window.SF_TabCapture.refresh === 'function') {
      // Site key may have changed — re-render the tab capture mini-fretboard
      // so its degree labels reflect the new key.
      window.SF_TabCapture.refresh();
    }
    renderIdentifyStrips(xFB, xKB); // chord-identify strips below fretboard + keyboard
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
