"""A long scan's working data between chunks, as gzipped JSON in crawl_states. It's saved whole or not at all.

It's stored in parts because a single value can't be larger than the database's largest packet: 16 MB by default,
which the state of a scan reaches at about 450,000 pages. The parts of one scan are replaced in one transaction.
"""
from __future__ import annotations

import gzip
import json

from sqlalchemy import Engine, text

PART_BYTES = 4_000_000


def save(conn, kind: str, run_id: int, site_id: int, data: dict) -> None:
    blob = gzip.compress(json.dumps(data, separators=(",", ":")).encode("ascii"), mtime=0)
    forget(conn, kind, run_id)
    for part, begin in enumerate(range(0, len(blob), PART_BYTES)):
        conn.execute(
            text("INSERT INTO crawl_states (kind, run_id, part, site_id, state, saved_at) VALUES (:k, :r, :p, :s, :b, UTC_TIMESTAMP(3))"),
            {"k": kind, "r": run_id, "p": part, "s": site_id, "b": blob[begin:begin + PART_BYTES]},
        )


def load(engine: Engine, kind: str, run_id: int) -> dict | None:
    with engine.connect() as conn:
        parts = conn.execute(text("SELECT state FROM crawl_states WHERE kind = :k AND run_id = :r ORDER BY part"), {"k": kind, "r": run_id}).scalars().all()
    return json.loads(gzip.decompress(b"".join(parts))) if parts else None


def forget(conn, kind: str, run_id: int) -> None:
    conn.execute(text("DELETE FROM crawl_states WHERE kind = :k AND run_id = :r"), {"k": kind, "r": run_id})


def site_last_asked(engine: Engine, site_id: int) -> float | None:
    """When a scan of this site last stopped asking it, in seconds since 1970. The links checker and the health test can take turns on one site."""
    with engine.connect() as conn:
        value = conn.execute(
            text(
                "SELECT UNIX_TIMESTAMP(MAX(at)) FROM ("
                " SELECT MAX(saved_at) AS at FROM crawl_states WHERE site_id = :s"
                " UNION ALL SELECT MAX(finished_at) FROM link_scans WHERE site_id = :s"
                " UNION ALL SELECT MAX(finished_at) FROM health_audits WHERE site_id = :s) last"
            ),
            {"s": site_id},
        ).scalar()
    return float(value) if value is not None else None
