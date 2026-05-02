"""Music-theory helpers used by the songs API.

Mirrors the JS implementation in js/sheetmusic.js so the same Nashville
degree numbers come back from the server as the frontend would compute
on the fly via the key-cycle controls. Centralising here lets us re-
derive degrees from chord symbols + declared key on every read,
sidestepping the (frequent) case where Claude Vision picked a wrong
key and produced shifted degrees.

The derivation is deterministic: given chords[] and key, you get the
same degrees[] back every time. Re-running extraction or fixing keys
later doesn't require a DB rewrite — the API just hands fresh degrees
out on the next read.
"""
from __future__ import annotations

import re
from typing import List, Optional

NOTE_PC = {
    'C':  0, 'C#': 1, 'C♯': 1, 'Db': 1, 'D♭': 1,
    'D':  2, 'D#': 3, 'D♯': 3, 'Eb': 3, 'E♭': 3,
    'E':  4, 'Fb': 4, 'F♭': 4,
    'F':  5, 'E#': 5, 'E♯': 5,
    'F#': 6, 'F♯': 6, 'Gb': 6, 'G♭': 6,
    'G':  7, 'G#': 8, 'G♯': 8, 'Ab': 8, 'A♭': 8,
    'A':  9, 'A#': 10, 'A♯': 10, 'Bb': 10, 'B♭': 10,
    'B': 11, 'Cb': 11, 'C♭': 11,
}
# 12 semitones from the tonic → Nashville degree label. Note: this is
# the SAME table for major and minor — Nashville numbers diatonic and
# chromatic positions identically; the implicit chord QUALITY changes
# between modes, but that's encoded in the chord symbol's suffix
# (already preserved from the original `degrees` field below).
PC_TO_DEGREE = ['1', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7']

_CHORD_ROOT_RE = re.compile(r'^([A-G][#♯b♭]?)')
_DEGREE_SUFFIX_RE = re.compile(r'^[♭♯]?[1-7](.*)$')


def parse_chord_root_pc(chord: Optional[str]) -> int:
    """Pitch class (0–11) for a chord symbol's ROOT. Handles slash
    chords (`C/E` → root C → 0). Returns -1 for bar lines, rests, or
    anything we can't parse (the post-pass leaves those rows alone)."""
    if not chord or chord in ('|', '%'):
        return -1
    head = chord.split('/')[0]
    m = _CHORD_ROOT_RE.match(head)
    if not m:
        return -1
    return NOTE_PC.get(m.group(1), -1)


def parse_key_pc(key_str: Optional[str]) -> int:
    """Pitch class for the song's key. The text after the root note
    (`major` / `minor`) doesn't change the tonic's pitch class — both
    `C major` and `C minor` start at pc=0."""
    if not key_str:
        return -1
    m = _CHORD_ROOT_RE.match(key_str)
    if not m:
        return -1
    return NOTE_PC.get(m.group(1), -1)


def _split_degree_suffix(deg: Optional[str]) -> str:
    """Pull the chord-quality suffix off a Nashville degree string.
    `1M7` → `M7`, `5⁷` → `⁷`, `♭7` → `` (no suffix). We preserve this
    suffix when re-deriving so Claude's chord-quality interpretation
    rides through unchanged."""
    if not deg or deg == '%':
        return ''
    m = _DEGREE_SUFFIX_RE.match(deg)
    return m.group(1) if m else ''


def derive_degrees(
    chords: Optional[List[str]],
    original_degrees: Optional[List[str]],
    key_str: Optional[str],
) -> List[str]:
    """Re-derive a degrees[] array deterministically from chords[] and
    the song's declared key. Quality suffix carries through from the
    original Claude-produced degrees; only the leading degree number is
    recomputed against the key's tonic. Bar lines and unparseable
    chords pass through unchanged."""
    if not chords:
        return list(original_degrees) if original_degrees else []
    key_pc = parse_key_pc(key_str)
    if key_pc < 0:
        # Unknown / unparseable key — best-effort fall-through. The
        # frontend's key-cycle controls let the user dial in manually.
        return list(original_degrees) if original_degrees else []
    out: List[str] = []
    for i, c in enumerate(chords):
        if c == '|':
            out.append('|')
            continue
        orig = (original_degrees[i]
                if (original_degrees and i < len(original_degrees))
                else '')
        suffix = _split_degree_suffix(orig)
        pc = parse_chord_root_pc(c)
        if pc < 0:
            out.append(orig)
            continue
        interval = (pc - key_pc) % 12
        out.append(PC_TO_DEGREE[interval] + suffix)
    return out
