"""ai_brand: "On your site?" for every point the AIs make, and head-to-head questions ("<brand> or <competitor>?").

- brand_questions.rival_id: the followed competitor a head-to-head question is about (NULL: an ordinary question).
- brand_answers.rival_id: copied from the question when the run starts, so the answer keeps it if the question goes.
- brand_answers.versus: who that answer recommends and what it says about each side ({winner, us, them, by}).
- brand_runs.onsite: each point checked against the site's own stored page texts ({pages, by, at, points: {key: {mark, url, score, by}}}).

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
"""
import sqlalchemy as sa
from alembic import op

revision = "e6f7a8b9c0d1"
down_revision = "d5e6f7a8b9c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("brand_questions", sa.Column("rival_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_brand_questions_rival", "brand_questions", "sites", ["rival_id"], ["id"], ondelete="SET NULL")
    op.add_column("brand_answers", sa.Column("rival_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_brand_answers_rival", "brand_answers", "sites", ["rival_id"], ["id"], ondelete="SET NULL")
    op.add_column("brand_answers", sa.Column("versus", sa.JSON(), nullable=True))
    op.add_column("brand_runs", sa.Column("onsite", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("brand_runs", "onsite")
    op.drop_column("brand_answers", "versus")
    op.drop_constraint("fk_brand_answers_rival", "brand_answers", type_="foreignkey")
    op.drop_column("brand_answers", "rival_id")
    op.drop_constraint("fk_brand_questions_rival", "brand_questions", type_="foreignkey")
    op.drop_column("brand_questions", "rival_id")
