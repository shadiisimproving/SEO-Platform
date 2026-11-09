from __future__ import annotations

from dataclasses import dataclass, field

from seo.collectors.common import digest
from seo.insights import rules


@dataclass
class Finding:
    kind: str
    grp: str
    subject: str  # what it's about, in words: a query, a page, a day, "site"
    at_stake: float = 0.0  # clicks a month
    severity: str = "normal"
    query: str | None = None
    page: str | None = None
    evidence: dict = field(default_factory=dict)

    def key(self, site_id: int) -> str:
        return digest("finding", site_id, self.kind, self.subject)

    def settle(self) -> "Finding":
        self.at_stake = round(max(0.0, self.at_stake), 1)
        if self.severity == "normal" and self.at_stake < rules.INFO_BELOW:
            self.severity = "info"
        return self


@dataclass
class Result:
    """What one detector returns. `ran` lists the kinds it really looked at: a kind that couldn't run (not enough history,
    no brand words) leaves its old findings alone instead of marking them gone."""

    findings: list[Finding] = field(default_factory=list)
    ran: set[str] = field(default_factory=set)
    needs: dict[str, str] = field(default_factory=dict)  # kind → what it's missing
