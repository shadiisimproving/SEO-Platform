"""every table and text column in utf8mb4 (SEO review 2026-11-17, W3)

The live tables were latin1, so Arabic, emoji and other scripts were saved as "?". seo.core.charset converts the database
default and every column that isn't utf8mb4 yet, keeping each column's type, NULL, default and comment; JSON and binary
columns are left as they are. It first checks that no index would grow past InnoDB's 3072 bytes.

It rebuilds most tables, so on the live server it runs only when the owner says so, after a backup:
    SEO_CONVERT_UTF8MB4=yes  (in .env or the environment) while migrating, or later: python -m scripts.convert_utf8mb4
Without it, this step only prints that it was skipped; the script can be run at any time and skips what is done.
Test databases (name ending in _test) are always converted, so tests run on the real target format.

Downgrade does nothing on purpose: going back to latin1 would turn every Arabic letter and emoji into "?" again.

Revision ID: e4f6a8b0c2d5
Revises: d1e3f5a7b9c2
"""
import os

from alembic import op
from sqlalchemy import text

from seo import config
from seo.core import charset

revision = "e4f6a8b0c2d5"
down_revision = "d1e3f5a7b9c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    database = conn.execute(text("SELECT DATABASE()")).scalar() or ""
    wanted = (os.environ.get("SEO_CONVERT_UTF8MB4") or config.get("SEO_CONVERT_UTF8MB4", "") or "").lower() == "yes"
    if not (wanted or database.endswith("_test")):
        print("utf8mb4: skipped. Back up, then run python -m scripts.convert_utf8mb4 (or migrate with SEO_CONVERT_UTF8MB4=yes).")
        return
    done = charset.convert(conn, log=print)
    print(f"utf8mb4: {done['tables']} tables, {done['columns']} columns in {done['seconds']} s")


def downgrade() -> None:
    pass
