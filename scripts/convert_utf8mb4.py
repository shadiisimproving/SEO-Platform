"""Convert the database to utf8mb4 (seo.core.charset). Back up first: python -m scripts.backup_db.

    python -m scripts.convert_utf8mb4            converts the database in .env (DB_NAME)
    python -m scripts.convert_utf8mb4 --check    only lists what would change and any index that would be too long
    python -m scripts.convert_utf8mb4 --test     works on DB_NAME_TEST instead

Prints the row count of every table before and after, so nothing else changed can be seen.
"""
from __future__ import annotations

import sys

from sqlalchemy import text

from seo.core import charset
from seo.core.db import make_engine


def _counts(conn) -> dict[str, int]:
    tables = [r[0] for r in conn.execute(text("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY 1"))]
    return {t: int(conn.execute(text(f"SELECT COUNT(*) FROM `{t}`")).scalar()) for t in tables}


def main(argv: list[str]) -> int:
    engine = make_engine(test="--test" in argv)
    with engine.connect() as conn:
        print(f"Database: {engine.url.database}")
        todo, long_ones = charset.tables_to_convert(conn), charset.too_long_indexes(conn)
        print(f"{len(todo)} tables and {len(charset.columns_to_convert(conn))} columns to convert")
        for name in long_ones:
            print(f"Index too long: {name}")
        if "--check" in argv or long_ones:
            return 1 if long_ones else 0
        before = _counts(conn)
        done = charset.convert(conn, log=print)
        after = _counts(conn)
    changed = {t: (before.get(t), after.get(t)) for t in set(before) | set(after) if before.get(t) != after.get(t)}
    print(f"Done: {done['tables']} tables, {done['columns']} columns in {done['seconds']} s")
    print("Row counts equal before and after in every table." if not changed else f"Row counts differ: {changed}")
    return 0 if not changed else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
