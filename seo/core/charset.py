"""Every table and text column in utf8mb4, so Arabic, emoji and every other script are kept as typed.

The live database was made with the host's default, latin1, so anything outside Western European letters was saved as "?"
(SEO review 2026-11-17, W3): Arabic titles, emoji in my own titles, Russian addresses. The connection was already utf8mb4.

The conversion is column by column, only for columns that aren't utf8mb4 yet. JSON columns are utf8mb4_bin already and
stay as they are; binary columns have no character set. Each column keeps its type, length, NULL, default and comment.
An index on a text column can hold 3072 bytes, so 768 characters in utf8mb4; the check below stops before any change
when an index would be too long, rather than half-way through. Text already saved as "?" can't be recovered: only new
reads are right.

Run it with a backup first (scripts/backup_db.py). On the live copy of 2026-11-17 (533 MB, 96 tables) it took the time
written in reports/seo-expert-2026-11-17/fixes/competitor-noise.md.
"""
from __future__ import annotations

import time

from sqlalchemy import Connection, text

CHARSET, COLLATION = "utf8mb4", "utf8mb4_unicode_ci"
INDEX_BYTES = 3072  # InnoDB's limit for one index with the DYNAMIC row format
BYTES_PER_CHAR = 4


def _quote(name: str) -> str:
    return "`" + name.replace("`", "``") + "`"


def columns_to_convert(conn: Connection) -> list[dict]:
    return [
        dict(r)
        for r in conn.execute(
            text(
                "SELECT c.TABLE_NAME AS tbl, c.COLUMN_NAME AS col, c.COLUMN_TYPE AS type, c.IS_NULLABLE AS nullable, c.COLUMN_DEFAULT AS dflt, "
                "c.COLUMN_COMMENT AS comment, c.CHARACTER_SET_NAME AS charset FROM information_schema.COLUMNS c "
                "JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE' "
                "WHERE c.TABLE_SCHEMA = DATABASE() AND c.CHARACTER_SET_NAME IS NOT NULL AND c.CHARACTER_SET_NAME <> :cs "
                "ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION"
            ),
            {"cs": CHARSET},
        ).mappings()
    ]


def tables_to_convert(conn: Connection) -> list[str]:
    """Tables whose default isn't utf8mb4 yet, or that still hold a column in another character set."""
    tables = {
        r[0]
        for r in conn.execute(
            text(
                "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' "
                "AND (TABLE_COLLATION IS NULL OR TABLE_COLLATION NOT LIKE 'utf8mb4%')"
            )
        )
    }
    tables |= {c["tbl"] for c in columns_to_convert(conn)}
    return sorted(tables)


def too_long_indexes(conn: Connection) -> list[str]:
    """Indexes that would pass 3072 bytes once their text columns take 4 bytes a character."""
    rows = conn.execute(
        text(
            "SELECT s.TABLE_NAME, s.INDEX_NAME, c.CHARACTER_SET_NAME, COALESCE(s.SUB_PART, c.CHARACTER_MAXIMUM_LENGTH) AS chars, "
            "c.DATA_TYPE, c.NUMERIC_PRECISION FROM information_schema.STATISTICS s JOIN information_schema.COLUMNS c "
            "ON c.TABLE_SCHEMA = s.TABLE_SCHEMA AND c.TABLE_NAME = s.TABLE_NAME AND c.COLUMN_NAME = s.COLUMN_NAME "
            "WHERE s.TABLE_SCHEMA = DATABASE()"
        )
    ).all()
    size: dict[tuple[str, str], int] = {}
    for table, index, charset, chars, _type, _precision in rows:
        # Other columns of a mixed index count 8 bytes: generous for an id or a date, so the check errs on the safe side.
        size[(table, index)] = size.get((table, index), 0) + (int(chars or 0) * BYTES_PER_CHAR if charset else 8)
    return [f"{table}.{index} ({n} bytes)" for (table, index), n in sorted(size.items()) if n > INDEX_BYTES]


def _column_sql(c: dict) -> str:
    parts = [f"MODIFY {_quote(c['col'])} {c['type']} CHARACTER SET {CHARSET} COLLATE {COLLATION}"]
    parts.append("NULL" if c["nullable"] == "YES" else "NOT NULL")
    if c["dflt"] is not None and not (c["dflt"] == "NULL" and c["nullable"] == "YES"):
        parts.append(f"DEFAULT {c['dflt']}")  # MariaDB gives the default as SQL already: 'text' quoted, NULL bare
    if c["comment"]:
        parts.append("COMMENT '" + c["comment"].replace("\\", "\\\\").replace("'", "''") + "'")
    return " ".join(parts)


def convert(conn: Connection, log=None) -> dict:
    """Converts the database default, then each table that needs it. Safe to run again: done tables are skipped.
    Returns {"tables": n, "columns": n, "seconds": s, "per_table": {name: seconds}}."""
    started = time.monotonic()
    long_ones = too_long_indexes(conn)
    if long_ones:
        raise RuntimeError("These indexes would be too long in utf8mb4; nothing was changed: " + ", ".join(long_ones))
    database = conn.execute(text("SELECT DATABASE()")).scalar()
    conn.execute(text(f"ALTER DATABASE {_quote(database)} CHARACTER SET {CHARSET} COLLATE {COLLATION}"))
    by_table: dict[str, list[dict]] = {}
    for c in columns_to_convert(conn):
        by_table.setdefault(c["tbl"], []).append(c)
    per_table: dict[str, float] = {}
    tables = tables_to_convert(conn)
    for table in tables:
        t0 = time.monotonic()
        clauses = [_column_sql(c) for c in by_table.get(table, [])]
        clauses.append(f"DEFAULT CHARACTER SET {CHARSET} COLLATE {COLLATION}")
        conn.execute(text(f"ALTER TABLE {_quote(table)} " + ", ".join(clauses)))
        per_table[table] = round(time.monotonic() - t0, 2)
        if log:
            log(f"{table}: {len(clauses) - 1} columns, {per_table[table]} s")
    return {
        "tables": len(tables),
        "columns": sum(len(v) for v in by_table.values()),
        "seconds": round(time.monotonic() - started, 1),
        "per_table": per_table,
    }
