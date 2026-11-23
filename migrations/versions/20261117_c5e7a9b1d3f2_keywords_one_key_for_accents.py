"""keywords: nothing to change (kept so the migration chain stays intact)

A first version of this revision merged keywords that differ only by accents ("créer société dubai" and
"creer societe dubai") into one. On a copy of the live data (2026-11-17) Google ranked the two spellings differently
in 29 of 92 same-day, same-tool pairs (46 against 7, found against not found), and the owner tracks both on purpose,
so merging would put two different results pages on one history line. Each spelling stays its own keyword:
keyword_hash is unchanged. Accents are folded for matching Search Console numbers only (store.keyword_key, match_key).

Another migration (links, b8c2d4e6f1a3) was already pointed at this revision, so it stays, doing nothing.

Revision ID: c5e7a9b1d3f2
Revises: a7b1c2d3e4f5
"""

revision = "c5e7a9b1d3f2"
down_revision = "a8b9c0d1e2f3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
