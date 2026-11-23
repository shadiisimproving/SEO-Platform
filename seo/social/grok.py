"""Grok's part of the morning: X trends and X posts worth a comment, from the Grok CLI signed in with SuperGrok.

No xAI API key is ever used (the owner pays for SuperGrok, not for the API): `grok login --device-auth` is done once on
the server by the owner, and the CLI keeps its sign-in in ~/.grok. If Grok fails, the day goes on without it.
Grok can make links up or bring old ones, so every X link is checked with X's free oEmbed before it is kept.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timedelta
from urllib.parse import urlparse

import httpx

from seo.social import gather

TIMEOUT = 900
transport: httpx.BaseTransport | None = None  # tests replace this
OEMBED = "https://publish.x.com/oembed"  # publish.twitter.com answers 301 to here since X moved (seen 2026-11-20)
X_HOSTS = {"x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"}
LINKEDIN_HOSTS = {"linkedin.com", "www.linkedin.com"}
MAX_TARGETS = 5
MAX_AGE = timedelta(hours=48)

PROMPT = """You are a research assistant for a social media account. Use your live X search.

The account posts about: {niche}

Today is {today}. Look only at X posts from the last 24 hours, in English and in Arabic.

1. The 5 topics in this field that are getting the most attention on X today: what it is, why people care, and up to 3
   links to real X posts about it.
2. {targets} real X posts, published in the last 24 hours, where a thoughtful comment from this account would be seen:
   posts by people in this field with a real audience, with an open question or a claim worth adding to. Mix English and
   Arabic posts. Never pick posts from giveaway, crypto-scam or engagement-bait accounts.

Only give links you saw in your search, in the form https://x.com/<user>/status/<id>. Never invent a link.

Answer with JSON only, no text before or after, exactly in this shape:
{{"trends": [{{"topic": "...", "why": "...", "links": ["https://x.com/..."]}}],
  "targets": [{{"url": "https://x.com/<user>/status/<id>", "author": "@user", "text": "the post's full text",
                "lang": "en or ar", "posted_at": "2026-11-20T08:00:00Z"}}]}}
"""


class GrokFailed(Exception):
    pass


def command() -> list[str]:
    """The Grok CLI and its flags. GROK_BIN and GROK_FLAGS let the server's install differ without a code change.
    The default flags are the ones reported to make X search work reliably in headless runs."""
    # x.ai's installer puts it in ~/.grok/bin (read 2026-11-20), which cron's bare PATH doesn't hold.
    homes = [os.path.expanduser(p) for p in ("~/.grok/bin/grok", "~/.local/bin/grok")]
    binary = os.environ.get("GROK_BIN") or shutil.which("grok") or next((p for p in homes if os.path.exists(p)), homes[0])
    flags = os.environ.get("GROK_FLAGS", "--no-subagents --max-turns 6 --reasoning-effort low").split()
    return [binary, *flags, "-p"]


def ask(prompt: str) -> str:
    env = {k: v for k, v in os.environ.items() if not k.endswith("XAI_API_KEY")}  # never let a stray key bill the API
    run = command()
    # Cron's PATH is bare: the CLI's own folder goes first, so whatever it starts beside itself is found.
    env["PATH"] = os.pathsep.join(p for p in (os.path.dirname(run[0]), env.get("PATH", "/usr/local/bin:/usr/bin:/bin")) if p)
    try:
        done = subprocess.run([*run, prompt], capture_output=True, text=True, timeout=TIMEOUT, env=env, cwd=os.path.expanduser("~"))
    except FileNotFoundError as error:
        raise GrokFailed("The Grok CLI isn't installed on the server.") from error
    except subprocess.TimeoutExpired as error:
        raise GrokFailed(f"Grok took longer than {TIMEOUT // 60} minutes.") from error
    if done.returncode != 0:
        words = (done.stderr or done.stdout or "").strip().splitlines()
        last = words[-1][:200] if words else f"exit code {done.returncode}"
        if re.search(r"log(ged)? ?in|sign(ed)? ?(in|out)|auth|unauthori[sz]ed|401", last, re.I):
            raise GrokFailed("Grok is signed out. On the server, run: grok login --device-auth")
        raise GrokFailed(f"Grok stopped: {last}")
    return done.stdout


def parse(output: str) -> dict:
    """The JSON object in Grok's answer, even with words or a code fence around it."""
    start, end = output.find("{"), output.rfind("}")
    if start < 0 or end <= start:
        raise GrokFailed("Grok didn't answer with the expected list.")
    try:
        found = json.loads(output[start:end + 1])
    except ValueError as error:
        raise GrokFailed("Grok's answer wasn't valid JSON.") from error
    if not isinstance(found, dict):
        raise GrokFailed("Grok didn't answer with the expected list.")
    return found


def x_status(url: str) -> str | None:
    """The tidy https://x.com/<user>/status/<id> form, or None when it isn't a link to one X post."""
    if not gather.safe_link(url):
        return None
    parsed = urlparse(url.strip())
    if (parsed.hostname or "").lower() not in X_HOSTS:
        return None
    match = re.match(r"^/([A-Za-z0-9_]{1,15})/status(?:es)?/(\d{5,25})", parsed.path)
    return f"https://x.com/{match.group(1)}/status/{match.group(2)}" if match else None


def linkedin_post(url: str) -> str | None:
    if not gather.safe_link(url):
        return None
    parsed = urlparse(url.strip())
    if (parsed.hostname or "").lower() not in LINKEDIN_HOSTS or not re.match(r"^/(posts|feed/update|pulse)/", parsed.path):
        return None
    return f"https://www.linkedin.com{parsed.path}"


def x_link_lives(url: str) -> bool:
    """X's free oEmbed answers 200 for a public post that exists, 404 for one that doesn't."""
    try:
        with httpx.Client(transport=transport, timeout=15, follow_redirects=True) as client:  # X has moved this address before
            reply = client.get(OEMBED, params={"url": url, "omit_script": "1"})
        return reply.status_code == 200
    except httpx.HTTPError:
        return False


def clean(found: dict, now: datetime, check=x_link_lives) -> dict:
    """Grok's answer, cut to what can be trusted: real X links that exist, posts no older than 48 hours."""
    trends = []
    for t in (found.get("trends") or [])[:8]:
        if not isinstance(t, dict) or not str(t.get("topic") or "").strip():
            continue
        links = [x_status(u) for u in (t.get("links") or []) if isinstance(u, str)]
        trends.append({"topic": gather.plain(str(t["topic"]), 200), "why": gather.plain(str(t.get("why") or ""), 600), "links": [u for u in links if u][:3]})
    targets, seen = [], set()
    for t in (found.get("targets") or [])[:12]:
        if not isinstance(t, dict):
            continue
        url = x_status(str(t.get("url") or ""))
        if not url or url in seen:
            continue
        when = gather._when(str(t.get("posted_at") or "")) if t.get("posted_at") else None
        if when and now - when > MAX_AGE:
            continue
        if not check(url):
            continue
        seen.add(url)
        lang = "ar" if str(t.get("lang") or "").lower().startswith("ar") else "en"
        targets.append({"platform": "x", "url": url, "author": gather.plain(str(t.get("author") or ""), 100), "text": gather.plain(str(t.get("text") or ""), 2000),
                        "lang": lang, "posted_at": when, "checked": True})
        if len(targets) >= MAX_TARGETS:
            break
    return {"trends": trends, "targets": targets}


def research(niche: str, now: datetime, targets: int = MAX_TARGETS, run=ask, check=x_link_lives) -> dict:
    prompt = PROMPT.format(niche=niche.strip() or "business and entrepreneurship", today=now.strftime("%Y-%m-%d"), targets=targets)
    return clean(parse(run(prompt)), now, check)
