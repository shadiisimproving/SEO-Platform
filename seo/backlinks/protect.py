"""Protecting a site's links: spam marked by a person and the disavow file it makes, and a monthly budget for buying links.

Nothing here is decided for anyone. A page with hundreds of outbound links or a high spam score is only suggested; a person marks it.
Google says most sites never need a disavow file, so the screen says so beside the button.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from sqlalchemy import Engine, text

from seo.backlinks import live
from seo.backlinks.cleaner import root_domain
from seo.competitors.keywords import require_own
from seo.core.errors import NotFound, Refused

CURRENCIES = ("USD", "EUR", "AED", "GBP")
MAX_BUDGET = Decimal("9999999999.99")
SPAM_SCORE = 30  # the same line as the CSV filter in cleaner.py


def mark_disavow(engine: Engine, backlink_id: int, disavow) -> dict:
    if type(disavow) is not bool:
        raise Refused("Say whether to mark this link as spam.")
    with engine.begin() as conn:
        if not conn.execute(text("SELECT 1 FROM backlinks WHERE id = :i"), {"i": backlink_id}).first():
            raise NotFound("That backlink doesn't exist.")
        conn.execute(text("UPDATE backlinks SET disavow = :d WHERE id = :i"), {"d": disavow, "i": backlink_id})
    return {"id": backlink_id, "disavow": disavow}


def suggested(row) -> bool:
    """Worth a look as spam: a link-list page, or a spam score from the file at or over the CSV filter's line."""
    return (row.get("outbound_links") or 0) > live.MANY_OUTBOUND or (row.get("spam_score") is not None and row["spam_score"] >= SPAM_SCORE)


def disavow_file(engine: Engine, site_id: int) -> tuple[str, int]:
    """Google's format: one domain: line per site, # for comments. A whole domain, because a spam site's other pages are spam too."""
    with engine.connect() as conn:
        require_own(conn, site_id)
        host = conn.execute(text("SELECT host FROM sites WHERE id = :s"), {"s": site_id}).scalar()
        rows = conn.execute(text("SELECT domain, source_url FROM backlinks WHERE site_id = :s AND disavow = 1"), {"s": site_id}).all()
    # Worked out again from the address, so a link saved under a platform's domain before F105 disavows its own blog, not the platform.
    domains = sorted({root_domain(url) or domain for domain, url in rows})
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    lines = [
        f"# Disavow file for {host}, made {stamp}",
        "# Upload it in Search Console: search.google.com/search-console/disavow-links. It replaces any file uploaded before.",
        "# Google says most sites never need one. Use it only for links you can't get removed and that could look like paid or spam links.",
        *[f"domain:{d}" for d in domains],
    ]
    return "\n".join(lines) + "\n", len(domains)


def get_budget(engine: Engine, site_id: int) -> dict | None:
    with engine.connect() as conn:
        require_own(conn, site_id)
        row = conn.execute(text("SELECT amount, currency FROM backlink_budgets WHERE site_id = :s"), {"s": site_id}).mappings().first()
    return {"amount": float(row["amount"]), "currency": row["currency"]} if row else None


def set_budget(engine: Engine, site_id: int, body: dict) -> dict | None:
    amount, currency = body.get("amount"), body.get("currency")
    with engine.begin() as conn:
        require_own(conn, site_id)
        if amount in (None, ""):
            conn.execute(text("DELETE FROM backlink_budgets WHERE site_id = :s"), {"s": site_id})
            return None
        if isinstance(amount, bool):
            raise Refused("The budget must be a number.")
        try:
            value = Decimal(str(amount)).quantize(Decimal("0.01"))
        except (InvalidOperation, ValueError):
            raise Refused("The budget must be a number.") from None
        if value < 0 or value > MAX_BUDGET:
            raise Refused("The budget must be a number.")
        if currency not in CURRENCIES:
            raise Refused(f"Choose one of {', '.join(CURRENCIES)}.")
        conn.execute(
            text("INSERT INTO backlink_budgets (site_id, amount, currency) VALUES (:s, :a, :c) ON DUPLICATE KEY UPDATE amount = :a, currency = :c, updated_at = UTC_TIMESTAMP(3)"),
            {"s": site_id, "a": value, "c": currency},
        )
    return {"amount": float(value), "currency": currency}
