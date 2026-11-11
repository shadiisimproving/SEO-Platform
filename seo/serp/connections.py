"""Search tools: their keys (encrypted), the order Refresh tries them in, and what they've used.

The order per engine is free tools that refill first, then one-time credits, then tools with no credits. It's editable.
Paid use is off for every tool until someone switches it on, and only a Refresh ever reads that switch.
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Callable
from urllib.parse import urlsplit

from sqlalchemy import Engine, text

from seo.core import crypto
from seo.core.errors import NotFound, Refused
from seo.serp.tools import BrightData, BrowserBackup, DuckDuckGoDirect, HasData, Searlo, SearXNG, SerpApi, most_cost

ENGINE_ORDER = ("google", "duckduckgo", "bing", "yandex")
BRIGHT, SERPAPI, HASDATA, SEARLO, DDG, SEARX, BROWSER = "Bright Data", "SerpApi", "HasData", "Searlo", "DuckDuckGo direct", "SearXNG", "Browser on this Mac"


@dataclass(frozen=True)
class Info:
    """What the screens need to say about a tool, whether or not it's connected."""

    cls: type
    auth: str  # key, key+zone, url, none, browser
    refills: str  # monthly, one-time, no credits
    price: str | None = None


TOOLS: dict[str, Info] = {
    DDG: Info(DuckDuckGoDirect, "none", "no credits"),
    BRIGHT: Info(BrightData, "key+zone", "monthly", "$1.50 per 1,000"),
    SERPAPI: Info(SerpApi, "key", "monthly", "$25 a month"),
    HASDATA: Info(HasData, "key", "monthly", "$0.83 per 1,000"),
    SEARLO: Info(Searlo, "key", "one-time", "from $3.99 for 5,000"),
    SEARX: Info(SearXNG, "url", "no credits"),
    BROWSER: Info(BrowserBackup, "browser", "no credits"),
}
DEFAULT_ORDER = {
    "google": [BRIGHT, SERPAPI, HASDATA, SEARLO, BROWSER],
    "duckduckgo": [DDG, BRIGHT, SERPAPI],
    "bing": [BRIGHT, SERPAPI, HASDATA, SEARX, BROWSER],
    "yandex": [BRIGHT, SERPAPI, SEARX, BROWSER],
}
SETTINGS = {"disagree_gap": "3", "just_checked_hours": "12", "mac_country": "", "ai_first": "1"}
# Only SerpApi reads Google's AI Overview. With "ai_first" on, a Refresh on Google tries it first while it has free searches,
# then follows the saved order. The owner's order stays as saved; this only goes in front of it.
AI_FIRST_WHY = "SerpApi first while it has free searches, then the order below."

# Tests and the local harness replace this to run on a fake search tool.
tool_factory: Callable[[Engine, str], list] | None = None


def on_this_mac() -> bool:
    """The browser backup only exists while the app runs on the Mac. On hosting it isn't offered at all."""
    return sys.platform == "darwin"


# ---- keys -----------------------------------------------------------------------------------------

def _known(tool: str) -> Info:
    info = TOOLS.get(tool)
    if info is None:
        raise NotFound("That tool doesn't exist.")
    return info


def _address(value: str) -> str:
    try:
        parts = urlsplit(value)
    except ValueError:
        parts = None
    if not parts or parts.scheme not in ("http", "https") or not parts.hostname:
        raise Refused("Paste the whole address, starting with https://.")
    return value.rstrip("/")


def _seal(secret: str, key_path) -> str:
    try:
        return crypto.encrypt(secret, key_path)
    except (crypto.MissingKey, crypto.UnsafeKeyFile) as exc:
        raise Refused(str(exc)) from exc


def save_key(engine: Engine, tool: str, key: str = "", key_path=None, zone: str | None = None) -> dict:
    info = TOOLS.get(tool)
    if info is None or info.auth in ("none", "browser"):
        raise Refused("That tool doesn't take a key yet.")
    secret = key.strip() if isinstance(key, str) else ""
    if info.auth == "key+zone":
        return _save_bright(engine, secret, zone, key_path)
    if not secret:
        raise Refused("Paste the address first." if info.auth == "url" else "Paste the key first.")
    if info.auth == "url":
        secret = _address(secret)
    _store(engine, tool, _seal(secret, key_path), crypto.last_four(secret))
    return status(engine, tool)


def _save_bright(engine: Engine, secret: str, zone, key_path) -> dict:
    """A new zone alone keeps the key already saved."""
    name = zone.strip() if isinstance(zone, str) else ""
    if not name:
        raise Refused("Add the zone name too.")
    if not secret:
        with engine.connect() as conn:
            sealed = conn.execute(text("SELECT secret FROM connections WHERE tool = :t"), {"t": BRIGHT}).scalar()
        if not sealed:
            raise Refused("Paste the key first.")
        try:
            secret = json.loads(crypto.decrypt(sealed, key_path))["key"]
        except (crypto.BadKey, crypto.MissingKey, crypto.UnsafeKeyFile, ValueError, KeyError, TypeError) as exc:
            raise Refused("The saved key can't be read. Paste it again.") from exc
    _store(engine, BRIGHT, _seal(json.dumps({"key": secret, "zone": name}), key_path), crypto.last_four(secret))
    return status(engine, BRIGHT, key_path)


def _store(engine: Engine, tool: str, sealed: str, last4: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO connections (tool, secret, last4) VALUES (:t, :s, :l) ON DUPLICATE KEY UPDATE secret = :s, last4 = :l, last_error = NULL"),
            {"t": tool, "s": sealed, "l": last4},
        )


def status(engine: Engine, tool: str, key_path=None) -> dict:
    with engine.connect() as conn:
        row = conn.execute(text("SELECT secret, last4, last_ok_at, last_error FROM connections WHERE tool = :t"), {"t": tool}).mappings().first()
    if row is None:
        return {"tool": tool, "connected": False}
    answer = {"tool": tool, "connected": True, "last4": row["last4"], "last_error": row["last_error"]}
    if tool == BRIGHT:  # a zone name isn't a secret, and the panel shows it
        try:
            answer["zone"] = json.loads(crypto.decrypt(row["secret"], key_path)).get("zone")
        except (crypto.BadKey, crypto.MissingKey, crypto.UnsafeKeyFile, ValueError, AttributeError):
            answer["zone"] = None
    return answer


def remove_key(engine: Engine, tool: str) -> None:
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM connections WHERE tool = :t"), {"t": tool})


def note_error(engine: Engine, tool: str, error: str) -> None:
    """What the Connections page shows about a key that stopped working."""
    with engine.begin() as conn:
        conn.execute(text("UPDATE connections SET last_error = :e WHERE tool = :t"), {"e": error[:500], "t": tool})


def note_ok(engine: Engine, tool: str) -> None:
    with engine.begin() as conn:
        conn.execute(text("UPDATE connections SET last_ok_at = UTC_TIMESTAMP(3), last_error = NULL WHERE tool = :t"), {"t": tool})


# ---- a tool resting after a bot check ---------------------------------------------------------------
# DuckDuckGo shows a bot check to the hosting server's address, and the app never tries to get past one. Without this,
# every Refresh hit the same check first. So an automatic run skips the tool for BLOCK_HOURS, and a search that works
# lifts it at once. Ticked by hand under Choose tools, it still runs: the Refresh window warns first.
# Kept in serp_settings as "blocked:<tool>" = "<UTC time>|<the tool's own words>", so no table had to change.

BLOCK_HOURS = 24
_BLOCK_STAMP = "%Y-%m-%dT%H:%M:%SZ"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _block_name(tool: str) -> str:
    return f"blocked:{tool}"[:40]


def note_blocked(engine: Engine, tool: str, why: str) -> None:
    value = f"{_now().strftime(_BLOCK_STAMP)}|{why}"[:190]
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO serp_settings (name, value) VALUES (:n, :v) ON DUPLICATE KEY UPDATE value = :v"), {"n": _block_name(tool), "v": value})


def clear_blocked(engine: Engine, tool: str) -> None:
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM serp_settings WHERE name = :n"), {"n": _block_name(tool)})


def blocked(engine: Engine, tool: str) -> dict | None:
    """{name, at, until, why} while the tool rests after a bot check, else None. Times are UTC, ISO."""
    with engine.connect() as conn:
        value = conn.execute(text("SELECT value FROM serp_settings WHERE name = :n"), {"n": _block_name(tool)}).scalar()
    if not value:
        return None
    stamp, _, why = value.partition("|")
    try:
        at = datetime.strptime(stamp, _BLOCK_STAMP).replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    until = at + timedelta(hours=BLOCK_HOURS)
    if _now() >= until:
        return None
    return {"name": tool, "at": at.strftime(_BLOCK_STAMP), "until": until.strftime(_BLOCK_STAMP), "why": why}


def not_blocked(engine: Engine, tools: list) -> list:
    """The tools an automatic search may use now: the same list without those resting after a bot check."""
    return [tool for tool in tools if blocked(engine, tool.name) is None]


def _build(engine: Engine, name: str, key_path=None):
    info = TOOLS[name]
    if info.auth == "none":
        return info.cls()
    if info.auth == "browser":
        return info.cls(get_setting(engine, "mac_country")) if on_this_mac() else None
    with engine.connect() as conn:
        sealed = conn.execute(text("SELECT secret FROM connections WHERE tool = :t"), {"t": name}).scalar()
    if not sealed:
        return None
    try:
        secret = crypto.decrypt(sealed, key_path)
        if info.auth == "key+zone":
            parts = json.loads(secret)
            return info.cls(parts["key"], parts["zone"])
        return info.cls(secret)
    except (crypto.MissingKey, crypto.UnsafeKeyFile, crypto.BadKey) as exc:  # the tool can't run, which is for it to say, not to crash on
        note_error(engine, name, str(exc))
        return None
    except (ValueError, KeyError, TypeError):
        note_error(engine, name, "The saved key can't be read. Paste it again.")
        return None


# ---- the order ------------------------------------------------------------------------------------

def order_for(engine: Engine, search_engine: str) -> list[str]:
    """The saved order, with any tool it doesn't name in its default place at the end."""
    default = DEFAULT_ORDER.get(search_engine, [])
    with engine.connect() as conn:
        saved = [row[0] for row in conn.execute(text("SELECT tool FROM tool_order WHERE engine = :e ORDER BY position"), {"e": search_engine}).all()]
    kept = [name for name in saved if name in default]
    return kept + [name for name in default if name not in kept]


def set_order(engine: Engine, search_engine: str, names) -> list[str]:
    if search_engine not in ENGINE_ORDER:
        raise Refused("That search engine doesn't exist.")
    default = DEFAULT_ORDER[search_engine]
    if not isinstance(names, list) or sorted(map(str, names)) != sorted(default):
        raise Refused(f"Put every tool for this engine in the list: {', '.join(default)}.")
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM tool_order WHERE engine = :e"), {"e": search_engine})
        for position, name in enumerate(names):
            conn.execute(text("INSERT INTO tool_order (engine, tool, position) VALUES (:e, :t, :p)"), {"e": search_engine, "t": name, "p": position})
    return order_for(engine, search_engine)


def ai_first_on(engine: Engine) -> bool:
    return get_setting(engine, "ai_first") != "0"


def ai_first_names(engine: Engine, search_engine: str) -> list[str]:
    """The tools a Refresh puts in front of the saved order for this engine: those that read AI Overviews, on Google only."""
    if search_engine != "google" or not ai_first_on(engine):
        return []
    return [name for name in order_for(engine, search_engine) if getattr(TOOLS[name].cls, "gives_ai", False)]


def tools_for(engine: Engine, search_engine: str, include_manual: bool = False, ai_first: bool = False) -> list:
    """The tools that can search this engine now, in order. A tool only used when ticked by hand stays out unless asked for.

    With ai_first, a tool that reads AI Overviews goes in front on Google (see AI_FIRST_WHY). Once its free searches are
    used, the Refresh picker drops it for the run, so the rest of the saved order takes over by itself.
    """
    order = order_for(engine, search_engine)
    if tool_factory is not None:
        built = list(tool_factory(engine, search_engine))
        place = {name: at for at, name in enumerate(order)}
        built.sort(key=lambda tool: place.get(tool.name, len(place)))  # a stable sort, so unknown names keep their order
    else:
        built = [tool for tool in (_build(engine, name) for name in order) if tool is not None]
    if ai_first and search_engine == "google" and ai_first_on(engine):
        built.sort(key=lambda tool: not getattr(tool, "gives_ai", False))  # stable: the rest keep the saved order
    return [tool for tool in built if include_manual or not getattr(tool, "manual_only", False)]


# ---- settings -------------------------------------------------------------------------------------

def get_setting(engine: Engine, name: str) -> str:
    with engine.connect() as conn:
        value = conn.execute(text("SELECT value FROM serp_settings WHERE name = :n"), {"n": name}).scalar()
    return SETTINGS[name] if value is None else value


def save_setting(engine: Engine, name: str, value) -> str:
    if name not in SETTINGS:
        raise Refused("That setting doesn't exist.")
    text_value = str(value).strip() if isinstance(value, (str, int)) and not isinstance(value, bool) else None
    if text_value is None:
        raise Refused("That value isn't usable.")
    if name in ("disagree_gap", "just_checked_hours") and not (text_value.isdigit() and 0 <= int(text_value) <= 1000):
        raise Refused("Enter a whole number.")
    if name == "mac_country":
        text_value = text_value.upper()
        if text_value and not (len(text_value) == 2 and text_value.isalpha()):
            raise Refused("The country must be a two-letter code, such as AE.")
    if name == "ai_first" and text_value not in ("0", "1"):
        raise Refused("This one is on (1) or off (0).")
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO serp_settings (name, value) VALUES (:n, :v) ON DUPLICATE KEY UPDATE value = :v"), {"n": name, "v": text_value})
    return text_value


def paid_on(engine: Engine, tool: str) -> bool:
    with engine.connect() as conn:
        return bool(conn.execute(text("SELECT paid_on FROM tool_settings WHERE tool = :t"), {"t": tool}).scalar())


def set_paid(engine: Engine, tool: str, on) -> bool:
    info = _known(tool)
    if not isinstance(on, bool):
        raise Refused("Paid use is on or off.")
    if on and getattr(info.cls, "paid_per", None) is None:
        raise Refused("This tool has no pay-as-you-go price, so paid use can't be switched on.")
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO tool_settings (tool, paid_on) VALUES (:t, :o) ON DUPLICATE KEY UPDATE paid_on = :o, updated_at = UTC_TIMESTAMP(3)"),
            {"t": tool, "o": on},
        )
    return on


# ---- what's been used -----------------------------------------------------------------------------

def used_this_month(engine: Engine, tool: str) -> int:
    with engine.connect() as conn:
        value = conn.execute(text("SELECT used FROM tool_usage WHERE tool = :t AND period = DATE_FORMAT(UTC_DATE(), '%Y-%m')"), {"t": tool}).scalar()
    return int(value or 0)


def used_ever(engine: Engine, tool: str) -> int:
    with engine.connect() as conn:
        value = conn.execute(text("SELECT SUM(used) FROM tool_usage WHERE tool = :t"), {"t": tool}).scalar()
    return int(value or 0)


def free_left(engine: Engine, tool) -> int | None:
    """None means the tool has no credits to run out of."""
    once = getattr(tool, "free_once", None)
    if once is not None:
        return max(0, once - used_ever(engine, tool.name))
    allowance = getattr(tool, "free_monthly", None)
    return None if allowance is None else max(0, allowance - used_this_month(engine, tool.name))


def hour_left(engine: Engine, tool) -> int | None:
    """Some tools also limit an hour. None means this one doesn't."""
    limit = getattr(tool, "per_hour", None)
    if limit is None:
        return None
    with engine.connect() as conn:
        used = conn.execute(text("SELECT COALESCE(SUM(amount), 0) FROM credit_ledger WHERE tool = :t AND created_at >= UTC_TIMESTAMP(3) - INTERVAL 1 HOUR"), {"t": tool.name}).scalar()
    return max(0, limit - int(used))


def can_afford_a_search(engine: Engine, tool, depth: int = 10) -> bool:
    """On free credits alone. One search can cost a tool more than one credit, and the free allowance is never to be passed."""
    cost = max(most_cost(tool, depth), 1 if getattr(tool, "free_monthly", None) is not None or getattr(tool, "free_once", None) is not None else 0)
    left, hour = free_left(engine, tool), hour_left(engine, tool)
    return (left is None or left >= cost) and (hour is None or hour >= cost)


def out_only_for_this_hour(engine: Engine, tool, depth: int = 10) -> bool:
    """It can't search now, but it can once its hourly limit has passed."""
    cost = max(most_cost(tool, depth), 1)
    left, hour = free_left(engine, tool), hour_left(engine, tool)
    return hour is not None and hour < cost and (left is None or left >= cost)


def count_use(engine: Engine, tool_name: str, amount: int, *, paid: bool = False, cost=None, run_id: int | None = None, keyword_id: int | None = None, search_engine: str | None = None, note: str | None = None) -> None:
    """A paid credit goes in the ledger and leaves the free allowance alone. A negative amount is a refund."""
    if not amount:
        return
    with engine.begin() as conn:
        if not paid:
            conn.execute(
                text("INSERT INTO tool_usage (tool, period, used) VALUES (:t, DATE_FORMAT(UTC_DATE(), '%Y-%m'), GREATEST(:n, 0)) ON DUPLICATE KEY UPDATE used = GREATEST(used + :n, 0)"),
                {"t": tool_name, "n": amount},
            )
        conn.execute(
            text("INSERT INTO credit_ledger (tool, amount, paid, cost, run_id, keyword_id, engine, note) VALUES (:t, :n, :p, :c, :r, :k, :e, :o)"),
            {"t": tool_name, "n": amount, "p": paid, "c": cost, "r": run_id, "k": keyword_id, "e": search_engine, "o": note},
        )


def spend_on_search(engine: Engine, tool, keyword: str, search_engine: str, country: str = "", language: str = "", device: str = "desktop", depth: int = 10, *, paid: bool = False, run_id: int | None = None, keyword_id: int | None = None, note: str | None = None):
    """Every search that can cost credits goes through here. It returns the tool's Answer, or raises what the tool raised.

    The most the search can cost is written down before it goes out, so a crash can't hide a spend. Then:
    - it worked: the difference to what the tool really charged is written down;
    - it failed or the tool stopped: only what wasn't charged is given back (pages that answered before the failure stay);
    - it timed out: the pages before, and the one that timed out, stay counted; later pages never went out and are given back;
    - anything else: the estimate stays, because the search may have gone out.
    Whatever stays counted is on the exception as `credits_kept`, and its dollars as `cost_kept` (None on free credits),
    so a run can hold it against its limit, and count the failure toward dropping the tool.
    """
    from seo.serp.tools import SearchFailed, TimedOut, ToolStopped, most_cost  # noqa: PLC0415 - tools imports nothing from here

    estimate = most_cost(tool, depth)
    per = Decimal(str(getattr(tool, "paid_per", 0) or 0))
    money = (lambda credits: per * credits if paid else None)

    def book(amount: int, why: str | None) -> None:
        count_use(engine, tool.name, amount, paid=paid, cost=money(amount), run_id=run_id, keyword_id=keyword_id, search_engine=search_engine, note=why)

    book(estimate, note)
    try:
        answer = tool.search(keyword, search_engine, country, language, device, depth)
    except TimedOut as exc:
        page = max(1, int(getattr(tool, "credits_per_page", 1) or 1)) if estimate else 0
        kept = min(estimate, max(0, int(getattr(exc, "charged", 0) or 0)) + page)
        book(kept - estimate, "never sent: an earlier page timed out")
        exc.credits_kept, exc.cost_kept = kept, money(kept)
        raise
    except (ToolStopped, SearchFailed) as exc:
        kept = min(estimate, max(0, int(getattr(exc, "charged", 0) or 0)))
        book(kept - estimate, "not charged")
        exc.credits_kept, exc.cost_kept = kept, money(kept)
        if getattr(exc, "bot_check", False):  # every job searches through here, so each one rests the tool
            note_blocked(engine, tool.name, str(exc))
        raise
    except Exception as exc:
        exc.credits_kept, exc.cost_kept = estimate, money(estimate)
        raise
    charged = int(answer.charged or 0)
    book(charged - estimate, "what the tool really charged")
    answer.cost = money(charged)
    clear_blocked(engine, tool.name)  # it got through, so the next automatic run may use it again
    return answer


# ---- what the screens read ------------------------------------------------------------------------

def _usable_by_engine(engine: Engine) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for search_engine in ENGINE_ORDER:
        for tool in tools_for(engine, search_engine, include_manual=True):
            found.setdefault(tool.name, tool)
    return found


def tool_list(engine: Engine, key_path=None) -> dict:
    """Every tool, connected or not, with real credits. The browser backup isn't listed at all on hosting."""
    usable = _usable_by_engine(engine)
    with engine.connect() as conn:
        paid = {row[0]: bool(row[1]) for row in conn.execute(text("SELECT tool, paid_on FROM tool_settings")).all()}
    rows = []
    for name, info in TOOLS.items():
        if info.auth == "browser" and not on_this_mac() and name not in usable:
            continue
        tool = usable.get(name)
        cls = tool or info.cls
        allowance = getattr(cls, "free_once", None) if getattr(cls, "free_once", None) is not None else getattr(cls, "free_monthly", None)
        left = free_left(engine, tool) if tool is not None else allowance
        state = status(engine, name, key_path)
        rows.append({
            "name": name, "auth": info.auth, "refills": info.refills, "price": info.price,
            "engines": list(getattr(cls, "engines", ())), "connected": tool is not None,
            "left": left, "of": allowance, "hour_left": hour_left(engine, tool) if tool is not None else None,
            "credits_per_search": most_cost(cls), "paid_per": getattr(cls, "paid_per", None), "paid_on": paid.get(name, False),
            "manual_only": bool(getattr(cls, "manual_only", False)), "gives_ai": bool(getattr(cls, "gives_ai", False)),
            "last4": state.get("last4"), "zone": state.get("zone"), "last_error": state.get("last_error"),
        })
    missing_browser = False
    if on_this_mac():
        try:
            import playwright  # noqa: F401, PLC0415 - only asking whether it's there
        except ImportError:
            missing_browser = True
    return {
        "tools": rows,
        "order": {name: order_for(engine, name) for name in ENGINE_ORDER},
        # Refresh puts these in front of the saved order; the order screen says so, with the reason.
        "first_for_ai": {name: ai_first_names(engine, name) for name in ENGINE_ORDER if ai_first_names(engine, name)},
        "first_for_ai_why": AI_FIRST_WHY,
        "settings": {name: get_setting(engine, name) for name in SETTINGS},
        "browser_available": on_this_mac(), "browser_missing": missing_browser,
    }


def test_tool(engine: Engine, name: str) -> dict:
    """Only what costs nothing: SerpApi's account page and a SearXNG search. Others say plainly the key wasn't tried."""
    _known(name)
    from seo.serp.tools import SearchFailed, ToolStopped

    tool = _usable_by_engine(engine).get(name)
    if tool is None:
        return {"ok": False, "checked": False, "message": "Save the key first."}
    tester = getattr(tool, "test", None)
    if tester is None:
        return {"ok": None, "checked": False, "message": "Not checked, to save a credit. Save it; the first search shows if it works."}
    try:
        left = tester()
    except (ToolStopped, SearchFailed) as exc:
        note_error(engine, name, str(exc))
        return {"ok": False, "checked": True, "message": str(exc)}
    note_ok(engine, name)
    return {"ok": True, "checked": True, "message": "Works.", "searches_left": left if isinstance(left, int) else None}
