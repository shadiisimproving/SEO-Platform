#!/usr/bin/env python3
"""Turn the Lucide SVGs in var/lucide/ into design/mockups/icons.js, so nothing loads from a CDN."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
icons = {}
for path in sorted((ROOT / "var" / "lucide").glob("*.svg")):
    text = re.sub(r"<!--.*?-->", "", path.read_text(), flags=re.S)
    inner = re.search(r"<svg[^>]*>(.*)</svg>", text, flags=re.S).group(1)
    icons[path.stem] = re.sub(r"\s+", " ", inner).strip()
out = ROOT / "design" / "mockups" / "icons.js"
out.write_text(
    "// Lucide icons (ISC licence), copied so nothing loads from a CDN.\n"
    f"window.ICONS = {json.dumps(icons, indent=0)};\n"
)
print(f"{len(icons)} icons written to {out.name}")
