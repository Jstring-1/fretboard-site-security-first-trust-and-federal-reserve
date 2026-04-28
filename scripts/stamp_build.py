#!/usr/bin/env python3
"""Update <div id="build_num"> in index.html to YYYYMMDD.HHMM (local time, 24h)."""
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
if updated != text:
    HTML.write_text(updated, encoding='utf-8')
    print(f'build stamp -> {ts}')
else:
    print(f'build stamp unchanged ({ts})', file=sys.stderr)
