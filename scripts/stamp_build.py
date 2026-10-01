#!/usr/bin/env python3
"""Pre-commit stamp: update build_num + every ?v= query string in index.html.

Running on every commit keeps:
  - <div id="build_num">YYYYMMDD.HHMM</div>  (visible in the footer)
  - <link href="css/foo.css?v=YYYYMMDD.HHMM">
  - <script src="js/foo.js?v=YYYYMMDD.HHMM">

in lock-step with the commit timestamp, so no cached CSS/JS slips through
after a code change. Previously only build_num was stamped and the ?v=
values had to be hand-bumped, which caused repeated stale-cache bugs.
"""
import datetime
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / 'index.html'

ts = datetime.datetime.now().strftime('%Y%m%d.%H%M')
text = HTML.read_text(encoding='utf-8')

updated = re.sub(
    r'<div id="build_num">[0-9.]+</div>',
    f'<div id="build_num">{ts}</div>',
    text,
)
updated, n_v = re.subn(
    r'(\?v=)[0-9.]+',
    rf'\g<1>{ts}',
    updated,
)

if updated != text:
    HTML.write_text(updated, encoding='utf-8')
    print(f'build stamp -> {ts} ({n_v} ?v= bumps)')
else:
    print(f'build stamp unchanged ({ts})', file=sys.stderr)
