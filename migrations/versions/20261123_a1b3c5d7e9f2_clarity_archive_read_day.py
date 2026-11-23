"""clarity_daily: days from the old Clarity archive move one day on, to the read day that covers them

The archive file's days are the visits' own days (the old project dated a recordings session by its start and an API
pull by the middle of its 24 hours). The app's reads are stored under the day they ran and cover the day before (SEO
review 2026-11-17, W10), and every reader moves the stored day back one. So archive rows uploaded before this fix were
counted a day early. The importer now stores them one day on; this moves the rows already there.

An archive row is one with no `raw`: the app's own pull has always saved Clarity's answer there, the upload never does.
Latest first, so a row never lands on the next archive row before that one has moved. Where the app's own read already
covers the visit day, that read stays and the old copy goes, as the importer does. The day's coverage row moves with it.

Revision ID: a1b3c5d7e9f2
Revises: e2f4a6c8d0b1
"""
import sqlalchemy as sa
from alembic import op

revision = "a1b3c5d7e9f2"
down_revision = "e2f4a6c8d0b1"
branch_labels = None
depends_on = None


def move(conn, step: int) -> None:
    rows = conn.execute(sa.text("SELECT site_id, day FROM clarity_daily WHERE raw IS NULL ORDER BY site_id, day " + ("DESC" if step > 0 else "ASC"))).all()
    for site_id, day in rows:
        values = {"s": site_id, "d": day, "n": step}
        taken = conn.execute(sa.text("SELECT 1 FROM clarity_daily WHERE site_id = :s AND day = :d + INTERVAL :n DAY"), values).first()
        if taken:
            conn.execute(sa.text("DELETE FROM clarity_daily WHERE site_id = :s AND day = :d"), values)
            conn.execute(sa.text("DELETE FROM coverage WHERE site_id = :s AND source = 'clarity' AND day = :d"), values)
            continue
        conn.execute(sa.text("UPDATE clarity_daily SET day = :d + INTERVAL :n DAY WHERE site_id = :s AND day = :d"), values)
        conn.execute(sa.text("DELETE FROM coverage WHERE site_id = :s AND source = 'clarity' AND day = :d + INTERVAL :n DAY"), values)
        conn.execute(sa.text("UPDATE coverage SET day = :d + INTERVAL :n DAY WHERE site_id = :s AND source = 'clarity' AND day = :d"), values)


def upgrade() -> None:
    move(op.get_bind(), 1)


def downgrade() -> None:
    move(op.get_bind(), -1)
