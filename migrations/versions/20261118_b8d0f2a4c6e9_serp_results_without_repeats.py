"""rank checks saved before 2026-11-17 with the same address twice: each address once, the rows under it moved up

SerpApi's deeper Google checks read page after page, and Google repeats its first results on a later page. Before
tools._rows (2026-11-17) every repeat was saved as another row, so a check could say #37 for a page that is #33 without
them (final re-check 2026-11-18, R17: 8 "ok" checks on live). New checks keep each address once. This does the same to the
stored ones: the first row of an address stays, later ones go, and every check touched is numbered 1, 2, 3 … again in its
own order. A row whose address Google hid ('') keeps its place and is never merged with another.

Revision ID: b8d0f2a4c6e9
Revises: a3c5e7f9b1d4
"""
import sqlalchemy as sa
from alembic import op

revision = "b8d0f2a4c6e9"
down_revision = "a3c5e7f9b1d4"
branch_labels = None
depends_on = None


def without_repeats(rows):
    """rows: (id, position, url) in position order. Returns (ids to delete, {id: new position})."""
    seen, drop, renumber, place = set(), [], {}, 0
    for row_id, position, url in rows:
        if url and url in seen:
            drop.append(row_id)
            continue
        if url:
            seen.add(url)
        place += 1
        if place != position:
            renumber[row_id] = place
    return drop, renumber


def remove_repeats(conn) -> int:
    """Every stored check with an address twice, fixed. Returns how many checks were touched."""
    checks = [row[0] for row in conn.execute(sa.text(
        "SELECT DISTINCT check_id FROM serp_results WHERE url <> '' GROUP BY check_id, url HAVING COUNT(*) > 1"
    )).all()]
    for check_id in checks:
        rows = conn.execute(sa.text("SELECT id, position, url FROM serp_results WHERE check_id = :c ORDER BY position, id"), {"c": check_id}).all()
        drop, renumber = without_repeats(rows)
        for row_id in drop:
            conn.execute(sa.text("DELETE FROM serp_results WHERE id = :i"), {"i": row_id})
        for row_id, position in renumber.items():
            conn.execute(sa.text("UPDATE serp_results SET position = :p WHERE id = :i"), {"p": position, "i": row_id})
    return len(checks)


def upgrade() -> None:
    remove_repeats(op.get_bind())


def downgrade() -> None:
    pass  # the repeats were never real results
