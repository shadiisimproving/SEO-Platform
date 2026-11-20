"""A writing-style skill, uploaded as the Writing guide.

The owner can keep their style as a Claude skill: a SKILL.md, or a .zip / .skill folder with SKILL.md plus
references and examples. Its text files become the guide the morning writer reads, SKILL.md first. Only text is
read; nothing in the file is run.
"""
from __future__ import annotations

import io
import posixpath
import re
import zipfile

from seo.core.errors import Refused

MAX_UPLOAD = 2 * 1024 * 1024          # the file as uploaded
MAX_UNPACKED = 4 * 1024 * 1024        # all text inside a zip, before it's read
MAX_FILES = 200
GUIDE_LIMIT = 60000                   # same limit as a guide typed by hand
TEXT_ENDINGS = (".md", ".markdown", ".txt")


def _decode(raw: bytes, name: str) -> str:
    try:
        return raw.decode("utf-8-sig").replace("\r\n", "\n").strip()
    except UnicodeDecodeError:
        raise Refused(f"{name} isn't plain text (UTF-8).") from None


def _skill_name(skill_md: str, fallback: str) -> str:
    head = re.match(r"\A---\n(.*?)\n---", skill_md, re.S)
    if head:
        found = re.search(r"^name:\s*['\"]?([^'\"\n]+)", head.group(1), re.M)
        if found:
            return found.group(1).strip()[:80]
    return fallback


def _from_zip(data: bytes) -> list[tuple[str, str]]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise Refused("That file isn't a zip I can open.") from None
    entries = [i for i in archive.infolist() if not i.is_dir()]
    if len(entries) > MAX_FILES:
        raise Refused(f"The skill has {len(entries)} files. The limit is {MAX_FILES}.")
    wanted = []
    for info in entries:
        path = info.filename.replace("\\", "/")
        parts = path.split("/")
        if "__MACOSX" in parts or any(p.startswith(".") for p in parts):
            continue
        if not path.lower().endswith(TEXT_ENDINGS):
            continue
        wanted.append(info)
    if sum(i.file_size for i in wanted) > MAX_UNPACKED:
        raise Refused("The skill's text is too large once unpacked (over 4 MB).")
    files = [(i.filename.replace("\\", "/"), _decode(archive.read(i), i.filename)) for i in wanted]
    # A zip of the folder puts everything under "my-skill/": show paths from inside it.
    tops = {p.split("/")[0] for p, _ in files if "/" in p}
    if len(tops) == 1 and all("/" in p for p, _ in files):
        top = tops.pop() + "/"
        files = [(p[len(top):], body) for p, body in files]
    return files


def read(filename: str, data: bytes) -> tuple[str, str]:
    """The skill's name and the guide text made from it."""
    name = posixpath.basename((filename or "").replace("\\", "/")) or "skill"
    if not data:
        raise Refused("The file is empty.")
    if len(data) > MAX_UPLOAD:
        raise Refused("The file is over 2 MB. A writing skill is text: remove images or other large files.")
    lower = name.lower()
    if lower.endswith((".zip", ".skill")):
        files = _from_zip(data)
    elif lower.endswith(TEXT_ENDINGS):
        files = [("SKILL.md", _decode(data, name))]
    else:
        raise Refused("Upload the skill as SKILL.md, or as a .zip or .skill file.")
    files = [(p, body) for p, body in files if body]
    main = [f for f in files if posixpath.basename(f[0]).lower() == "skill.md"]
    if not main:
        raise Refused("There's no SKILL.md in that file. A skill needs one.")
    main.sort(key=lambda f: f[0].count("/"))
    skill_md = main[0]
    others = sorted((f for f in files if f is not skill_md), key=lambda f: f[0])
    title = _skill_name(skill_md[1], re.sub(r"\.(zip|skill|md|markdown|txt)$", "", name, flags=re.I))
    parts = [f"# Skill: {title}", skill_md[1]]
    parts += [f"---\n## File: {path}\n\n{body}" for path, body in others]
    guide = "\n\n".join(parts)
    if len(guide) > GUIDE_LIMIT:
        raise Refused(f"The skill's text is {len(guide):,} characters. The guide holds up to {GUIDE_LIMIT:,}: "
                      "keep the best examples and remove the rest.")
    return title, guide
