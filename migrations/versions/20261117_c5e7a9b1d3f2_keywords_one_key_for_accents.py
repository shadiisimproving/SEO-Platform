"""keywords: one key whatever the accents, so "café en grains" and "cafe en grains" are one tracked keyword

store.keyword_hash now folds Latin accents as well as case and spacing (store.keyword_key). Saved rows still carry the old
hash, so this recomputes it, for keywords and for keyword notes. Two keywords that now share a key and a market (country and
language) are merged into the older one, without losing anything:
- its sites, Keyword check entries, rank checks (moved onto its own target when it has one for that engine and device),
  Refresh items, credit lines and the rankings tasks are about all move over;
- the older keyword's text stays as it was typed;
- nothing is deleted except the emptied duplicate keyword row (and an emptied duplicate target).

Safe to run twice: a second run finds nothing to merge and every hash already right. Run it with `alembic upgrade head`
like any other; it reads and writes only the tables named above.

Revision ID: c5e7a9b1d3f2
Revises: a7b1c2d3e4f5
"""
import hashlib
import json
import re
import unicodedata

from alembic import op
from sqlalchemy import text

revision = "c5e7a9b1d3f2"
down_revision = "a7b1c2d3e4f5"
branch_labels = None
depends_on = None

# A frozen copy of seo.serp.store.keyword_key on 2026-11-17, so this migration means the same thing whatever the code becomes.
_SPACE = re.compile(r"\s+")
_INVISIBLE = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​‎‏﻿]")
_LIGATURES = str.maketrans({"œ": "oe", "æ": "ae"})


def _clean(value: str) -> str:
    return _SPACE.sub(" ", _INVISIBLE.sub("", unicodedata.normalize("NFKC", value or ""))).strip()


def _bare(ch: str) -> str:
    if ch.isascii() or not ("À" <= ch <= "ɏ" or "Ḁ" <= ch <= "ỿ"):
        return ch
    return "".join(part for part in unicodedata.normalize("NFKD", ch) if not unicodedata.combining(part))


def key_hash(value: str) -> str:
    folded = unicodedata.normalize("NFC", _clean(value).casefold())
    return hashlib.sha256("".join(_bare(ch) for ch in folded).translate(_LIGATURES).encode("utf-8")).hexdigest()


def _move_targets(conn, keep: int, gone: int) -> None:
    keep_targets = {(r["engine"], r["device"]): r["id"] for r in conn.execute(text("SELECT id, engine, device FROM serp_targets WHERE keyword_id = :k"), {"k": keep}).mappings()}
    for target in conn.execute(text("SELECT id, engine, device FROM serp_targets WHERE keyword_id = :k"), {"k": gone}).mappings().all():
        twin = keep_targets.get((target["engine"], target["device"]))
        if twin is None:
            conn.execute(text("UPDATE serp_targets SET keyword_id = :k WHERE id = :t"), {"k": keep, "t": target["id"]})
        else:  # both were checked on this engine: every check goes to one target, so one history line holds them all
            conn.execute(text("UPDATE serp_checks SET target_id = :keep WHERE target_id = :t"), {"keep": twin, "t": target["id"]})
            conn.execute(text("DELETE FROM serp_targets WHERE id = :t"), {"t": target["id"]})


def _move_task_refs(conn, keep: int, gone: int) -> None:
    """A task about a ranking names it "<keyword id>:<engine>" (seo.tasks.options)."""
    prefix = f"{gone}:"
    for row in conn.execute(text("SELECT id, about FROM tasks WHERE about LIKE :p"), {"p": f'%"{prefix}%'}).mappings().all():
        about = row["about"]
        try:
            about = json.loads(about) if isinstance(about, str) else about
        except ValueError:
            continue
        changed = False
        for item in (about or {}).get("items") or []:
            if isinstance(item, dict) and item.get("kind") == "ranking" and str(item.get("ref", "")).startswith(prefix):
                item["ref"] = f"{keep}:{item['ref'][len(prefix):]}"
                changed = True
        if changed:
            conn.execute(text("UPDATE tasks SET about = :a WHERE id = :i"), {"a": json.dumps(about), "i": row["id"]})


def merge_spellings(conn) -> dict:
    """The whole change, on one connection. Returns what it did, for the test and the log."""
    rows = conn.execute(text("SELECT id, keyword, keyword_hash, country, language FROM keywords ORDER BY id")).mappings().all()
    groups: dict[tuple, list] = {}
    for row in rows:
        groups.setdefault((key_hash(row["keyword"]), row["country"], row["language"]), []).append(row)
    merged = 0
    for (new_hash, _country, _language), same in groups.items():
        keep, *rest = same  # the oldest: its text, as typed, is the one kept
        for twin in rest:
            gone = twin["id"]
            conn.execute(text("UPDATE IGNORE site_keywords SET keyword_id = :keep WHERE keyword_id = :gone"), {"keep": keep["id"], "gone": gone})
            conn.execute(text("DELETE FROM site_keywords WHERE keyword_id = :gone"), {"gone": gone})  # a site that tracked both
            conn.execute(text("UPDATE IGNORE probe_keywords SET keyword_id = :keep WHERE keyword_id = :gone"), {"keep": keep["id"], "gone": gone})
            conn.execute(text("DELETE FROM probe_keywords WHERE keyword_id = :gone"), {"gone": gone})
            _move_targets(conn, keep["id"], gone)
            conn.execute(text("UPDATE IGNORE rank_run_items SET keyword_id = :keep WHERE keyword_id = :gone"), {"keep": keep["id"], "gone": gone})
            conn.execute(text("UPDATE rank_run_items SET keyword_id = :keep, active_key = NULL WHERE keyword_id = :gone"), {"keep": keep["id"], "gone": gone})
            conn.execute(text("UPDATE credit_ledger SET keyword_id = :keep WHERE keyword_id = :gone"), {"keep": keep["id"], "gone": gone})
            _move_task_refs(conn, keep["id"], gone)
            conn.execute(text("DELETE FROM keywords WHERE id = :gone"), {"gone": gone})
            merged += 1
        if keep["keyword_hash"] != new_hash:
            conn.execute(text("UPDATE keywords SET keyword_hash = :h WHERE id = :i"), {"h": new_hash, "i": keep["id"]})
    notes = 0
    for note in conn.execute(text("SELECT id, keyword, keyword_hash FROM notes WHERE keyword IS NOT NULL AND keyword <> ''")).mappings().all():
        new_hash = key_hash(note["keyword"])
        if note["keyword_hash"] != new_hash:
            conn.execute(text("UPDATE notes SET keyword_hash = :h WHERE id = :i"), {"h": new_hash, "i": note["id"]})
            notes += 1
    return {"merged": merged, "notes": notes}


def upgrade() -> None:
    merge_spellings(op.get_bind())


def downgrade() -> None:
    pass  # merged keywords can't be told apart again; their checks are all kept on the older one
