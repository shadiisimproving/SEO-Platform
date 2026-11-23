"""The Site map: one website's pages drawn as a mind map, for my sites and for competitors.

Two ways to group the same pages:
- "folders": the home page, then each folder of the address (/blog/, /services/...), then the pages inside. Built from
  the addresses alone, so it works for any site the page reader has read.
- "links": the home page, then the pages it links to, then the pages those link to. Each page shows once, under the
  shortest way from the home page. Pages nothing leads to sit in their own branch. It needs each page's links
  (page_links, saved by the page reader), so the answer says how many pages have had theirs read.

The answer is a flat list of boxes, parents before children, each naming its parent: the screen builds the tree. Notes are
counted per box: a page's own notes, and a folder's notes (a "section" note: it applies to every page under it)."""
from __future__ import annotations

import json
import re
from collections import Counter, deque
from urllib.parse import unquote, urlsplit

from sqlalchemy import Engine, text

from seo.accounts import access
from seo.competitors import pages as page_store
from seo.core.errors import NotFound, Refused
from seo.links.urls import host_key, page_key

VIEWS = ("folders", "links", "inlinks")
MAX_PAGES = 5000
_HIDDEN = ("gone", "left_scope")  # pages that no longer exist, or now live on another website
_SEPARATORS = re.compile(r"\s+[|\-–—·:]\s+")


def _site(conn, site_id: int) -> dict:
    row = conn.execute(text("SELECT id, host, start_url, kind FROM sites WHERE id = :i"), {"i": site_id}).mappings().first()
    if row is None:
        raise NotFound("That website doesn't exist.")
    return dict(row)


def _load(value, empty):
    if value is None or value == "":
        return empty
    try:
        return json.loads(value) if isinstance(value, (str, bytes)) else value
    except ValueError:
        return empty


def _pages(conn, host: str) -> tuple[int | None, list[dict]]:
    """Every page of the site still there, once each: http and https, www or not, are one page (the read one wins)."""
    domain_id = conn.execute(text("SELECT id FROM domains WHERE host = :h"), {"h": host.lower()}).scalar()
    if domain_id is None:
        return None, []
    rows = conn.execute(
        text(
            "SELECT id, url, url_hash, title, h1, word_count, last_status, content_hash, last_changed_at FROM pages "
            "WHERE domain_id = :d AND (last_status IS NULL OR last_status NOT IN :hidden) ORDER BY (content_hash IS NULL), id LIMIT :n"
        ).bindparams(hidden=_HIDDEN),
        {"d": domain_id, "n": MAX_PAGES},
    ).mappings()
    seen: dict[str, dict] = {}
    for row in rows:
        key = page_key(row["url"])
        if key and key not in seen:
            seen[key] = {**row, "key": key}
    return domain_id, list(seen.values())


def _repeated_part(titles: list[str], last: bool) -> str:
    """The site's name when most titles end (or start) with it, such as " | Shop": it says nothing on a map of that site."""
    parts = Counter()
    for title in titles:
        bits = _SEPARATORS.split(title)
        if len(bits) > 1:
            parts[bits[-1 if last else 0].strip().casefold()] += 1
    if not parts:
        return ""
    part, count = parts.most_common(1)[0]
    return part if count >= 3 and count >= 0.4 * len(titles) else ""


def _lost(title: str) -> bool:
    """A title saved as question marks (a script the database couldn't keep): the address says more."""
    marks = title.count("?")
    return marks >= 3 and marks * 2 > len(title.replace(" ", ""))


def _namer(pages: list[dict]):
    titles = [(p["title"] or "").strip() for p in pages if (p["title"] or "").strip()]
    tail, lead = _repeated_part(titles, True), _repeated_part(titles, False)
    # The home page's own title names the site ("Shop - Shoes and bags"). A language home says it again
    # ("Shop - Chaussures et sacs"), on too few pages for the rule above, so the home page's first and last parts count too.
    home = min((p for p in pages if (p["title"] or "").strip()), key=lambda p: len(p.get("key") or ""), default=None)
    home_bits = [bit.strip().casefold() for bit in _SEPARATORS.split(home["title"].strip())] if home else []
    brands = {home_bits[0], home_bits[-1]} if len(home_bits) > 1 else set()

    def name(page: dict) -> str:
        title = (page["title"] or "").strip()
        if not title:
            first = _load(page["h1"], [])
            title = str(first[0]).strip() if first else ""
        ends = brands if page is not home else set()
        bits = _SEPARATORS.split(title)
        if len(bits) > 1 and (bits[-1].strip().casefold() == tail and tail or bits[-1].strip().casefold() in ends):
            title = title[: title.rfind(bits[-1])].rstrip(" |-–—·:")
        bits = _SEPARATORS.split(title)
        if len(bits) > 1 and (bits[0].strip().casefold() == lead and lead or bits[0].strip().casefold() in ends):
            title = title[len(bits[0]):].lstrip(" |-–—·:")
        return "" if _lost(title) else title[:200]

    return name


def _note_counts(conn, host: str) -> dict[str, int]:
    """Notes per address hash, for pages ("page" notes) and folders ("section" notes), on this website only."""
    params = {"like": f"%{host_key(f'https://{host}/')}%"}
    mine = access.site_clause("n.site_id", params, conn)  # chosen access: their sites' notes only
    rows = conn.execute(
        text(
            "SELECT n.page_hash, COUNT(*) FROM notes n WHERE n.deleted_at IS NULL AND n.scope IN ('page', 'section') AND n.page_hash IS NOT NULL "
            "AND (n.body <> '' OR EXISTS (SELECT 1 FROM note_files f WHERE f.note_id = n.id AND f.deleted_at IS NULL)) "
            f"AND n.page_url LIKE :like{mine or ''} GROUP BY n.page_hash"
        ),
        params,
    )
    return {row[0]: int(row[1]) for row in rows}


def _segments(key: str, site_host: str) -> list[str]:
    """A page's place by its address: a subdomain first, then each folder, then the page (its query kept with it)."""
    host, _, rest = key.partition("/")
    path, _, query = rest.partition("?")
    parts = [part for part in path.split("/") if part]
    if query:
        if parts:
            parts[-1] = f"{parts[-1]}?{query}"
        else:
            parts = [f"?{query}"]
    if host != site_host:
        parts.insert(0, host)
    return parts


def _natural(value: str) -> str:
    """Sorts guide-2 before guide-10, as a person would."""
    return re.sub(r"\d+", lambda hit: hit.group().zfill(10), value.casefold())


class _Boxes:
    """The flat answer: every box with an id, its parent's id, and what the screen shows on it."""

    def __init__(self, notes: dict[str, int], name) -> None:
        self.items: list[dict] = []
        self.notes, self.name = notes, name

    def _section_notes(self, url: str) -> int:
        folder = url.split("?", 1)[0]
        folder = folder if folder.endswith("/") else f"{folder}/"
        return self.notes.get(page_store.url_hash(folder), 0)

    def page(self, parent: int | None, page: dict, kind: str = "page", seg: str = "") -> int:
        url = page["url"]
        path = unquote(urlsplit(url).path) or "/"
        query = urlsplit(url).query
        notes = self.notes.get(page["url_hash"], 0)
        if kind != "home":  # a home page's folder would be the whole website, which a group note can't be
            notes += self._section_notes(url) if url.split("?", 1)[0].endswith("/") else 0
        self.items.append({
            "id": len(self.items), "parent": parent, "kind": kind, "label": self.name(page) or seg or path, "seg": seg,
            "url": url, "path": f"{path}?{query}" if query else path, "words": page["word_count"],
            "read": bool(page["content_hash"]), "notes": notes,
        })
        return len(self.items) - 1

    def folder(self, parent: int | None, seg: str, url: str) -> int:
        self.items.append({"id": len(self.items), "parent": parent, "kind": "folder", "label": seg, "seg": seg, "url": url, "path": unquote(urlsplit(url).path), "words": None, "read": False, "notes": self._section_notes(url)})
        return len(self.items) - 1

    def group(self, parent: int | None, label: str) -> int:
        self.items.append({"id": len(self.items), "parent": parent, "kind": "group", "label": label, "seg": "", "url": None, "path": "", "words": None, "read": False, "notes": 0})
        return len(self.items) - 1

    def counted(self) -> list[dict]:
        """Adds `pages`: how many pages sit under each box, itself not counted."""
        totals = [0] * len(self.items)
        for item in self.items:  # each page counts once for every box above it (a gathered group comes after its pages)
            if item["kind"] not in ("page", "home"):
                continue
            up = item["parent"]
            while up is not None:
                totals[up] += 1
                up = self.items[up]["parent"]
        for item in self.items:
            item["pages"] = totals[item["id"]]
        return self.items


def _home(site: dict, pages: list[dict]) -> dict | None:
    by_key = {p["key"]: p for p in pages}
    start = by_key.get(page_key(site["start_url"])) or by_key.get(f"{host_key(site['start_url'])}/")
    if start or not pages:
        return start
    return min(pages, key=lambda p: (p["key"].count("/"), len(p["key"])))  # no home page read: the shortest address stands in


def _by_folders(site: dict, pages: list[dict], boxes: _Boxes) -> None:
    home = _home(site, pages)
    site_host = host_key(site["start_url"]) or site["host"]
    front = urlsplit(home["url"] if home else site["start_url"])
    scheme, netloc = front.scheme or "https", front.netloc or site["host"]  # the site's own spelling (www or not), so a folder's notes match its pages
    tree: dict = {"page": home, "kids": {}}
    for page in pages:
        if page is home:
            continue
        node = tree
        for seg in _segments(page["key"], site_host):
            node = node["kids"].setdefault(seg, {"page": None, "kids": {}})
        if node is tree or node["page"] is not None:
            continue  # two spellings of one place: the first one read stays
        node["page"] = page

    def size(node: dict) -> int:
        node["size"] = sum(size(kid) + (1 if kid["page"] else 0) for kid in node["kids"].values())
        return node["size"]

    size(tree)
    root = boxes.page(None, home, "home") if home else boxes.folder(None, site["host"], f"{scheme}://{netloc}/")
    todo = deque([(tree, root, [])])
    while todo:
        node, parent, trail = todo.popleft()
        for seg, kid in sorted(node["kids"].items(), key=lambda item: (-item[1]["size"], _natural(item[0]))):
            here = [*trail, seg]
            shown = f"/{seg}/" if kid["kids"] else f"/{seg}"
            if kid["page"]:
                box = boxes.page(parent, kid["page"], seg=shown)
            else:
                on_sub = here[0].endswith(f".{site_host}")  # a subdomain's own folders
                parts = here[1:] if on_sub else here
                address = f"{scheme}://{here[0] if on_sub else netloc}/{'/'.join(parts) + '/' if parts else ''}"
                box = boxes.folder(parent, shown, address)
            todo.append((kid, box, here))
    _gather_loose(boxes, root, "Pages with no folder")


LOOSE_MIN = 8  # more pages than this hanging straight off the home page are gathered into one group


def _gather_loose(boxes: _Boxes, root: int, label: str) -> None:
    """Pages that hang straight off the home page and lead nowhere are put in one named group, so the home page's
    branches are the few things that hold pages (owner, 2026-11-20: forty loose boxes around the home page can't be read).
    A site with nothing but loose pages keeps them as they are: one group alone would only hide them."""
    parents = {item["parent"] for item in boxes.items}
    under_home = [item for item in boxes.items if item["parent"] == root]
    loose = [item for item in under_home if item["kind"] == "page" and item["id"] not in parents]
    if len(loose) <= LOOSE_MIN or len(loose) == len(under_home):
        return
    group = boxes.group(root, label)
    for item in loose:
        item["parent"] = group


def _links_of(conn, domain_id: int) -> dict[int, list[str]]:
    rows = conn.execute(text("SELECT page_id, links FROM page_links WHERE domain_id = :d"), {"d": domain_id})
    return {row[0]: _load(row[1], []) for row in rows}


def _by_links(site: dict, pages: list[dict], links: dict[int, list[str]], boxes: _Boxes, other_label: str) -> None:
    home = _home(site, pages)
    if home is None:
        return
    by_key = {p["key"]: p for p in pages}
    placed = {home["key"]: boxes.page(None, home, "home")}
    todo = deque([home])
    while todo:  # nearest to the home page first, so each page lands under its shortest way in
        page = todo.popleft()
        for key in links.get(page["id"], []):
            target = by_key.get(key)
            if target is None or key in placed:
                continue
            placed[key] = boxes.page(placed[page["key"]], target)
            todo.append(target)
    _gather_loose(boxes, placed[home["key"]], "Linked from the home page, leading to no other page")
    left = sorted((p for p in pages if p["key"] not in placed), key=lambda p: _natural(p["key"]))
    if left:
        group = boxes.group(placed[home["key"]], other_label)
        for page in left:
            boxes.page(group, page)


# Internal links: how many of the site's other pages link to a page. Fewest first, because those are the ones to work on.
# (most, label, colour on the map: red, amber, olive, green, teal)
INLINK_GROUPS = (
    (0, "No page links to it", 5),
    (1, "1 page links to it", 1),
    (4, "2 to 4 pages link to it", 7),
    (19, "5 to 19 pages link to it", 3),
    (None, "20 pages or more link to it", 0),
)


def _by_inlinks(site: dict, pages: list[dict], links: dict[int, list[str]], boxes: _Boxes) -> None:
    home = _home(site, pages)
    if home is None:
        return
    by_key = {p["key"]: p for p in pages}
    inbound: Counter = Counter()
    for page in pages:
        for key in set(links.get(page["id"], [])):
            if key in by_key and key != page["key"]:
                inbound[key] += 1
    root = boxes.page(None, home, "home")
    boxes.items[root]["inlinks"] = inbound[home["key"]]
    rest = sorted((p for p in pages if p is not home), key=lambda p: (inbound[p["key"]], _natural(p["key"])))
    least = 0
    for most, label, hue in INLINK_GROUPS:
        inside = [p for p in rest if inbound[p["key"]] >= least and (most is None or inbound[p["key"]] <= most)]
        least = (most or 0) + 1
        if not inside:
            continue
        group = boxes.group(root, label)
        boxes.items[group].update(hue=hue, open=True)
        for page in inside:
            boxes.items[boxes.page(group, page)]["inlinks"] = inbound[page["key"]]


def site_map(engine: Engine, site_id: int, view: str = "folders") -> dict:
    if view not in VIEWS:
        raise Refused("view must be folders or links.")
    with engine.connect() as conn:
        site = _site(conn, site_id)
        domain_id, pages = _pages(conn, site["host"])
        notes = _note_counts(conn, site["host"]) if pages else {}
        links = _links_of(conn, domain_id) if domain_id is not None else {}
    boxes = _Boxes(notes, _namer(pages))
    readable = [p for p in pages if p["content_hash"]]
    links_read = sum(1 for p in readable if p["id"] in links)
    if pages:
        if view == "inlinks":
            _by_inlinks(site, pages, links, boxes)
        elif view == "links":
            _by_links(site, pages, links, boxes, "Not reached from the home page")
        else:
            _by_folders(site, pages, boxes)
    return {
        "site": {"id": site["id"], "host": site["host"], "kind": site["kind"]},
        "view": view,
        "pages": len(pages),
        "capped": len(pages) >= MAX_PAGES,
        "links": {"read": links_read, "of": len(readable)},  # pages whose links are saved, of those the reader could read
        "boxes": boxes.counted(),
    }


def page_card(engine: Engine, site_id: int, url: str) -> dict:
    """One page's facts for the map's side panel: what the reader saw, the pages it links to and the pages linking to it."""
    with engine.connect() as conn:
        site = _site(conn, site_id)
        clean = page_store.clean_page_url(url, site["host"])
        domain_id, pages = _pages(conn, site["host"])
        by_key = {p["key"]: p for p in pages}
        known = by_key.get(page_key(clean))
        if known is None:
            raise NotFound("That page isn't on the map.")
        row = dict(conn.execute(text("SELECT * FROM pages WHERE id = :i"), {"i": known["id"]}).mappings().first())
        links = _links_of(conn, domain_id)
    name = _namer(pages)

    def brief(page: dict) -> dict:
        return {"url": page["url"], "path": unquote(urlsplit(page["url"]).path) or "/", "label": name(page)}

    out = None
    if known["id"] in links:
        out = [brief(by_key[key]) for key in links[known["id"]] if key in by_key]
    into = [brief(p) for p in pages if p["id"] != known["id"] and known["key"] in links.get(p["id"], [])]
    stamp = lambda value: value.isoformat() if value else None  # noqa: E731
    return {
        "url": row["url"], "path": unquote(urlsplit(row["url"]).path) or "/", "host": site["host"], "kind": site["kind"],
        "title": row["title"] or "", "meta_description": row["meta_description"] or "",
        "h1": _load(row["h1"], []), "headings": _load(row["headings"], []),
        "word_count": row["word_count"], "read": bool(row["content_hash"]), "status": row["last_status"],
        "last_checked_at": stamp(row["last_checked_at"]), "last_changed_at": stamp(row["last_changed_at"]),
        "links_out": out,  # None: this page's links haven't been read yet
        "links_in": into, "links_known": bool(links),
    }


def reading(engine: Engine, site_id: int) -> dict:
    """Where the page reader is with this website: waiting, reading now, or when it last finished."""
    with engine.connect() as conn:
        _site(conn, site_id)
        row = conn.execute(text("SELECT status, message, started_at, finished_at FROM competitor_crawls WHERE competitor_id = :c"), {"c": site_id}).mappings().first()
    if row is None:
        return {"status": None, "busy": False, "message": None, "finished_at": None}
    stamp = lambda value: value.isoformat(timespec="seconds") + "Z" if value else None  # noqa: E731
    return {"status": row["status"], "busy": row["status"] in ("queued", "running"), "message": row["message"], "finished_at": stamp(row["finished_at"])}


def read_again(engine: Engine, site_id: int) -> dict:
    """Asks the page reader to read this website now instead of tonight. It keeps its own limits (pages a day, pauses)."""
    from seo.competitors import suggest, tracking

    with engine.connect() as conn:
        site = _site(conn, site_id)
        if site["kind"] != "own" and not tracking.reads_pages(conn, site_id):
            raise Refused("Tracking is off, so its pages aren't read. Set it to On or Pages only first.")
    suggest.queue_crawl(engine, site_id)
    return reading(engine, site_id)
