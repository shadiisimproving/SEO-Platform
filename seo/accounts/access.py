"""Who may see what: a person with chosen access reaches only the websites and sections the admin picked.

An account's `access` is NULL for full access (every admin, and every member made before this existed), or
{"sites": [ids], "sections": {key: "view" | "edit"}, "spend": bool}. Admins ignore it.

The rules, as the owner set them on 2026-11-12:
- "All sites" means all of *their* sites. Something saved for every site (site_id NULL) belongs to the owner's whole
  account, so someone with only some sites doesn't see it.
- View only lets them look, and mark things they've read. Can edit lets them change things in that section.
- Paid credits (paid searches, Firecrawl, AI answers, Moz) need the separate "Can spend credits" tick.
- A change every site shares (link-gap domain edits, a competitor's page read, important domains, mediators,
  adding a site) needs every site.

The server is the guard: `check()` runs before every API call (from `seo.web.auth`), refuses what isn't theirs, and
everything not listed in `seo.accounts.endpoints` is refused, so a route added later can't leak. Lists that answer for
"all sites" ask `own_site_ids()`, so they only count this person's sites. With nobody signed in (cron, jobs, tests
with login off) there is no limit, and nothing behaves differently.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field

from flask import g, has_request_context
from sqlalchemy import text

from seo.core.errors import Refused

# The menu, in its order and groups (design/mockups/mockup.js NAV). Settings is not here: it stays with admins,
# and a person with chosen access only gets their own account there.
SECTIONS = (
    ("today", "Today", ""),
    ("channels", "Channels", "Traffic"), ("conversions", "Conversions", "Traffic"), ("content", "Content", "Traffic"),
    ("overview", "Overview", "Search"), ("pages", "Pages", "Search"), ("map", "Site map", "Search"), ("insights", "Insights", "Search"), ("keywords", "Keywords", "Search"),
    ("competitors", "Competitors", "Search"), ("ai", "AI search", "Search"),
    ("ads", "Google Ads", "Ads"),
    ("tasks", "Tasks", "Work"), ("notes", "Notes", "Work"), ("social", "Social", "Work"), ("backlinks", "Backlinks", "Work"), ("resources", "Resources", "Work"),
    ("health", "Site health", "Health"),
)
SECTION_KEYS = tuple(key for key, _, _ in SECTIONS)
LEVELS = ("view", "edit")
NO_ACCESS = "You don't have access to this."


class NoAccess(Refused):
    """403 with `no_access` in the answer, so the screens never mistake it for a signed-out or out-of-date page."""

    http = 403


@dataclass
class Access:
    full: bool = True
    sites: frozenset = frozenset()
    sections: dict = field(default_factory=dict)
    spend: bool = False
    _every_site: bool | None = None  # worked out once per request

    def can(self, section: str, level: str = "view") -> bool:
        if self.full:
            return True
        given = self.sections.get(section)
        return given == "edit" or (given == "view" and level == "view")

    def sees_site(self, site_id) -> bool:
        return self.full or (isinstance(site_id, int) and site_id in self.sites)

    def every_site(self, conn) -> bool:
        """True when they have every own site, so "all sites" means the same for them as for the owner."""
        if self.full:
            return True
        if self._every_site is None:
            own = {row[0] for row in conn.execute(text("SELECT id FROM sites WHERE kind = 'own'"))}
            self._every_site = own <= self.sites
        return self._every_site


FULL = Access()


def parse(raw) -> dict | None:
    """What the database holds (JSON text, a dict, or NULL), as a clean dict or None for full access."""
    if raw is None or raw == "":
        return None
    if isinstance(raw, (bytes, str)):
        try:
            raw = json.loads(raw)
        except ValueError:
            return {"sites": [], "sections": {}, "spend": False}  # unreadable: nothing, never everything
    if not isinstance(raw, dict):
        return {"sites": [], "sections": {}, "spend": False}
    sites = [int(s) for s in raw.get("sites") or [] if isinstance(s, int) or (isinstance(s, str) and s.isdigit())]
    sections = {k: v for k, v in (raw.get("sections") or {}).items() if k in SECTION_KEYS and v in LEVELS}
    return {"sites": sorted(set(sites)), "sections": sections, "spend": raw.get("spend") is True}


def task_level(role: str, raw_access, site_id: int | None, own_ids) -> str | None:
    """What someone can do with a task on `site_id` (None: a task for every site): "edit", "view", or None when they
    can't see it at all. Used to keep a task from being assigned to someone who would never see it."""
    if role == "admin":
        return "edit"
    chosen = parse(raw_access)
    if chosen is None:
        return "edit"
    level = chosen["sections"].get("tasks")
    if not level:
        return None
    if site_id is None:
        return level if set(own_ids) <= set(chosen["sites"]) else None
    return level if site_id in chosen["sites"] else None


def clean(value, conn) -> dict | None:
    """What the admin sent, checked: None for full access, or the chosen sites and sections. Refuses an empty choice."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise Refused("Access is full, or a choice of sites and sections.")
    sites = value.get("sites")
    if not isinstance(sites, list) or not all(isinstance(s, int) and not isinstance(s, bool) for s in sites):
        raise Refused("Pick the websites as a list.")
    sections = value.get("sections")
    if not isinstance(sections, dict):
        raise Refused("Pick the sections.")
    for key, level in sections.items():
        if key not in SECTION_KEYS:
            raise Refused(f"There is no section called {key}.")
        if level not in LEVELS:
            raise Refused("Each section is view or edit.")
    if not sites:
        raise Refused("Pick at least one website.")
    if not sections:
        raise Refused("Pick at least one section.")
    own = {row[0] for row in conn.execute(text("SELECT id FROM sites WHERE kind = 'own'"))}
    if not set(sites) <= own:
        raise Refused("One of those websites isn't one of yours.")
    spend = value.get("spend", False)
    if not isinstance(spend, bool):
        raise Refused("Can spend credits is yes or no.")
    return {"sites": sorted(set(sites)), "sections": {k: sections[k] for k in SECTION_KEYS if k in sections}, "spend": spend}


def narrower(before: dict | None, after: dict | None) -> bool:
    """True when the change takes something away, so the person's open pages should be signed out."""
    if after is None:
        return False
    if before is None:
        return True
    if not set(after["sites"]) >= set(before["sites"]):
        return True
    if before.get("spend") and not after.get("spend"):
        return True
    for key, level in before["sections"].items():
        now = after["sections"].get(key)
        if now is None or (level == "edit" and now == "view"):
            return True
    return False


def of_user(user: dict | None) -> Access:
    if not user or user.get("role") == "admin" or user.get("access") is None:
        return FULL
    a = user["access"]
    return Access(full=False, sites=frozenset(a["sites"]), sections=dict(a["sections"]), spend=bool(a.get("spend")))


def current() -> Access:
    """The signed-in person's access, or full access outside a request (cron, jobs) or with login off."""
    if not has_request_context():
        return FULL
    cached = g.get("_access")
    if cached is None:
        cached = of_user(g.get("user"))
        g._access = cached
    return cached


def limited() -> bool:
    return not current().full


def own_site_ids(conn) -> list[int]:
    """The own sites this person may see, by id. Everything that answers for "all sites" goes through here."""
    ids = [row[0] for row in conn.execute(text("SELECT id FROM sites WHERE kind = 'own' ORDER BY id"))]
    who = current()
    return ids if who.full else [i for i in ids if i in who.sites]


def sees_everything(conn) -> bool:
    """Full access, or chosen access that happens to cover every site: no list needs filtering by site."""
    return current().every_site(conn)


def site_clause(column: str, values: dict, conn=None, name: str = "_vis") -> str:
    """` AND <column> IN (their sites)`, or nothing when they see every site. Rows for every site (NULL) drop out too,
    because those belong to the owner's whole account."""
    who = current()
    if who.full or (conn is not None and who.every_site(conn)) or who._every_site:
        return ""
    if not who.sites:
        return " AND 1 = 0"
    marks = []
    for n, site_id in enumerate(sorted(who.sites)):
        values[f"{name}{n}"] = site_id
        marks.append(f":{name}{n}")
    return f" AND {column} IN ({', '.join(marks)})"


def require_site(site_id) -> None:
    """For code paths the guard can't see into: refuse a site that isn't theirs."""
    if not current().sees_site(site_id):
        raise NoAccess(NO_ACCESS)


def require_site_or_every(site_id, conn) -> None:
    """For a service about to save: a site that is theirs, or (no site: for every site) every site. Full access: anything."""
    who = current()
    if who.full:
        return
    if site_id is None or site_id == "" or site_id == "all":
        if not who.every_site(conn):
            raise NoAccess(NO_ACCESS)
        return
    if isinstance(site_id, bool) or not isinstance(site_id, (int, str)) or (isinstance(site_id, str) and not (site_id.isascii() and site_id.isdigit())):
        raise NoAccess(NO_ACCESS)
    if int(site_id) not in who.sites:
        raise NoAccess(NO_ACCESS)


_KEY_FIELDS = {"last4", "zone", "last_error"}


def without_key_details(answer):
    """A tool or connection answer with the key's last characters, zone and error removed for chosen access (Settings is
    the admin's). Full access gets it unchanged."""
    if current().full:
        return answer
    if isinstance(answer, dict):
        return {k: without_key_details(v) for k, v in answer.items() if k not in _KEY_FIELDS}
    if isinstance(answer, list):
        return [without_key_details(v) for v in answer]
    return answer


def require_every_site(conn) -> None:
    if not current().every_site(conn):
        raise NoAccess(NO_ACCESS)


def for_browser(user: dict | None) -> dict | None:
    """What the screens get in BOOT.user.access: None for full access."""
    who = of_user(user)
    if who.full:
        return None
    return {"sites": sorted(who.sites), "sections": dict(who.sections), "spend": who.spend}


# ---- the check before every API call ------------------------------------------------------------------------

def _refuse():
    raise NoAccess(NO_ACCESS)


def _plain_id(value):
    """An id written the one plain way (a JSON whole number, or ASCII digits) as an int; None for anything else.
    Python's int() also reads "+7", " 7", "0_7", 7.0 and true as numbers, so nothing looser may pass the guard."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and 0 < len(value) <= 18 and value.isascii() and value.isdigit():
        return int(value)
    return None


def _site_value(value):
    """A site id as sent. Returns an int; "none" for no site ("all" or empty); "null" for JSON null; "bad" otherwise."""
    if value is None:
        return "null"
    if isinstance(value, str) and value in ("", "all"):
        return "none"
    found = _plain_id(value)
    return "bad" if found is None else found


def _owner_rows(conn, sql: str, value) -> list | None:
    """The sites of a stored item, or None when no id was really sent. An id written any other way is refused."""
    if value is None or value == "":
        return None
    found = _plain_id(value)
    if found is None:
        _refuse()
    return [row[0] for row in conn.execute(text(sql), {"v": found})]


def _item_ok(who: Access, conn, sites: list) -> bool:
    """A stored item passes when one of its sites is theirs, or it is for every site and they have every site."""
    if not sites:
        return True  # no such item: the route answers 404
    if any(isinstance(s, int) and s in who.sites for s in sites):
        return True
    return any(s is None for s in sites) and who.every_site(conn)


def check(engine, request) -> None:
    """Refuses (NoAccess) an API call this person may not make. Full access returns at once."""
    from seo.accounts import endpoints as table

    who = current()
    if who.full or not request.path.startswith("/api/"):
        return
    endpoint = request.url_rule.endpoint if request.url_rule is not None else None
    if endpoint is None:
        return  # 404 or 405: nothing to reach
    spec = table.ENDPOINTS.get(endpoint)
    if spec is None:
        _refuse()
    sections, kind, flags = spec
    body = request.get_json(silent=True) if request.is_json else None
    body = body if isinstance(body, dict) else {}
    if kind == "admin":
        _refuse()
    if endpoint == "exports_api.export":
        sections = table.EXPORT_SECTIONS.get((request.view_args or {}).get("view_id"))
        if sections is None:
            _refuse()
    if kind == "paid?":
        kind = "spend" if body.get("allow_paid") is True else "write"
    level = "view" if kind in ("read", "self") else "edit"
    if sections != "*" and not any(who.can(s, level) for s in sections.split()):
        _refuse()
    if kind in ("spend", "gspend") and not who.spend:
        _refuse()
    with engine.connect() as conn:
        who.every_site(conn)  # worked out now, so lists later in this request can filter without asking again
        if kind in ("global", "gspend") and not who.every_site(conn):
            _refuse()
        if "free" in flags:
            return
        named = False
        overrides = table.OWNER_OVERRIDES.get(endpoint, {})
        places = [request.view_args or {}, request.args, body, request.form if request.form else {}]
        sent = {_site_value(place.get("site_id")) for place in places if "site_id" in place}
        if "bad" in sent or len(sent - {"none"}) > 1:
            _refuse()  # a site written oddly, or two different sites in one request: the route might read either
        for place in places:
            if "site_id" in place:
                value = _site_value(place.get("site_id"))
                if isinstance(value, int):
                    named = True
                    if value not in who.sites:
                        _refuse()
                elif value == "null" and place is body and level == "edit":
                    named = True  # saving something for every site
                    if not who.every_site(conn):
                        _refuse()
            for key, sql in {**table.OWNERS, **overrides}.items():
                if key in place and sql is not None:
                    rows = _owner_rows(conn, sql, place.get(key))
                    if rows is None:
                        continue
                    named = True
                    if not _item_ok(who, conn, rows):
                        _refuse()
        if endpoint in table.LIST_OWNERS:
            key, sql = table.LIST_OWNERS[endpoint]
            for value in body.get(key) or [] if isinstance(body.get(key), list) else []:
                rows = _owner_rows(conn, sql, value)
                if rows is None:
                    continue
                named = True
                if not _item_ok(who, conn, rows):
                    _refuse()
        if endpoint in table.ROW_SITES:
            for row in body.get(table.ROW_SITES[endpoint]) or []:
                if isinstance(row, dict):
                    value = _site_value(row.get("site_id"))
                    if value == "bad":
                        _refuse()
                    named = True
                    if not (isinstance(value, int) and value in who.sites) and not who.every_site(conn):
                        _refuse()
        if not named and "all" not in flags and not who.every_site(conn):
            _refuse()  # it would answer for every site, and they don't have every site
