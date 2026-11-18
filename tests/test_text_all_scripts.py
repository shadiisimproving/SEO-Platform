"""English, French and Arabic text and emoji are kept everywhere (owner, 2026-11-17; SEO review W3).

The live tables were latin1, so "تأسيس شركة في دبي" and "🏆" were saved as "?". These tests first put the tables in the
live database's old format, show the loss, run the utf8mb4 conversion (seo.core.charset, the e4f6a8b0c2d5 migration),
then send each text through the screens' own paths: a keyword and its Search Console query, a competitor page's title
and meta read by the crawler, a backlink file and a competitor's link file, a note and a task.
"""
import pytest
from sqlalchemy import text

from seo.backlinks.cleaner import clean_csv
from seo.competitors import gaps
from seo.core import charset
from seo.serp import rankings
from tests.test_competitor_follow import first_read, next_day  # noqa: F401
from tests.test_competitors_backend import add_rival, page_html, rows, scalar, sitemap_xml, world  # noqa: F401  (world is a fixture)

TEXTS = ["Créer société à Dubaï", "تأسيس شركة في دبي", "🏆 test"]
LIVE_TABLES = ("keywords", "gsc_query", "pages", "change_events", "backlinks", "competitor_referrer_links", "notes", "tasks")


def _as_live_was(conn, tables=LIVE_TABLES, charset_name="latin1", collation="latin1_swedish_ci"):
    """Every text column of these tables in latin1, as on the live server before the conversion. JSON stays utf8mb4.
    With utf8mb4_general_ci: a table a server with that default made, as a fresh test database does."""
    for table in tables:
        columns = conn.execute(
            text(
                "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
                "AND TABLE_NAME = :t AND DATA_TYPE IN ('varchar', 'text', 'mediumtext', 'char')"
            ),
            {"t": table},
        ).all()
        parts = []
        for name, kind, nullable, default in columns:
            clause = f"MODIFY `{name}` {kind} CHARACTER SET {charset_name} COLLATE {collation} {'NULL' if nullable == 'YES' else 'NOT NULL'}"
            if default is not None and not (default == "NULL" and nullable == "YES"):
                clause += f" DEFAULT {default}"
            parts.append(clause)
        parts.append(f"DEFAULT CHARACTER SET {charset_name} COLLATE {collation}")
        conn.execute(text(f"ALTER TABLE `{table}` " + ", ".join(parts)))


@pytest.fixture
def converted(engine):
    """The live tables' old format, the loss shown, then the conversion run."""
    with engine.begin() as conn:
        _as_live_was(conn)
        # Two tables already utf8mb4 but on the server's other collation: backlinks joins prospects on the domain, and
        # the two collations can't be compared (found after the merge, 2026-11-17).
        _as_live_was(conn, ("prospects", "sites"), "utf8mb4", "utf8mb4_general_ci")
        assert charset.tables_to_convert(conn)
        conn.execute(text("SET SESSION sql_mode = ''"))  # the live server saved what it couldn't hold as "?" instead of refusing
        conn.execute(text("INSERT INTO tasks (title) VALUES (:t)"), {"t": TEXTS[1]})
        assert conn.execute(text("SELECT title FROM tasks")).scalar() == "????? ???? ?? ???"
        conn.execute(text("DELETE FROM tasks"))
    with engine.begin() as conn:
        done = charset.convert(conn)
        assert done["tables"] >= len(LIVE_TABLES)
        assert charset.columns_to_convert(conn) == [] and charset.tables_to_convert(conn) == []
        assert set(charset.collations(conn)) == {"utf8mb4_unicode_ci"}
    return engine


ASCII_KEYS = {
    ("ga4_key_event_daily", "report"), ("ga4_key_event_daily", "row_hash"), ("ga4_key_event_daily", "event_hash"),
    ("ga4_host_daily", "host_hash"),
}


def test_every_text_column_has_one_collation_after_the_migrations_and_every_model_creates_it(engine):
    from sqlalchemy.dialects import mysql
    from sqlalchemy.schema import CreateTable

    from seo.core.models import Base

    with engine.connect() as conn:  # the session's tables, built by the real migrations from the server's default
        # Text is utf8mb4_unicode_ci. The only exception: GA4's hex hash keys are ascii_bin on purpose, so they join with the
        # other GA4 tables before (latin1) and after (utf8mb4) the owner's conversion; ASCII never clashes with either.
        ascii_columns = {tuple(r) for r in conn.execute(text(
            "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLLATION_NAME = 'ascii_bin'"
        ))}
        assert ascii_columns <= ASCII_KEYS, ascii_columns - ASCII_KEYS
        assert set(charset.collations(conn)) - {"ascii_bin"} == {"utf8mb4_unicode_ci"}
        assert {r[0] for r in conn.execute(text("SELECT TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"))} == {"utf8mb4_unicode_ci"}
        assert conn.execute(text("SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE()")).scalar() == "utf8mb4_unicode_ci"
        json_columns = {r[0] for r in conn.execute(text(
            "SELECT DISTINCT c.COLLATION_NAME FROM information_schema.COLUMNS c JOIN information_schema.CHECK_CONSTRAINTS k ON k.CONSTRAINT_SCHEMA = c.TABLE_SCHEMA "
            "AND k.TABLE_NAME = c.TABLE_NAME AND k.CHECK_CLAUSE = CONCAT('json_valid(`', c.COLUMN_NAME, '`)') WHERE c.TABLE_SCHEMA = DATABASE()"
        ))}
        assert json_columns == {"utf8mb4_bin"}  # MariaDB's JSON, never compared as text
    # create_all and every model: the same charset and collation, whatever the server's default.
    for table in Base.metadata.tables.values():
        assert str(CreateTable(table).compile(dialect=mysql.dialect())).rstrip().endswith("CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci"), table.name


def test_the_conversion_keeps_types_defaults_indexes_and_rows_and_json_stays_as_it_was(engine):
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS zz_latin"))
        conn.execute(text(
            "CREATE TABLE zz_latin (id INT PRIMARY KEY, name VARCHAR(190) NOT NULL DEFAULT 'x' COMMENT 'it''s a name', body TEXT NULL, "
            "facts JSON NULL, UNIQUE KEY uq_name (name)) DEFAULT CHARSET = latin1"
        ))
        conn.execute(text("INSERT INTO zz_latin (id, name, body, facts) VALUES (1, 'Créer société à Dubaï', 'été', '[\"🏆\"]'), (2, 'b', NULL, NULL)"))
    try:
        with engine.begin() as conn:
            charset.convert(conn)
            cols = {r[0]: r[1:] for r in conn.execute(text(
                "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT, COLLATION_NAME FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'zz_latin'"
            ))}
            assert cols["name"] == ("varchar(190)", "NO", "'x'", "it's a name", "utf8mb4_unicode_ci")
            assert cols["body"][:2] == ("text", "YES") and cols["body"][4] == "utf8mb4_unicode_ci"
            assert cols["facts"][4] == "utf8mb4_bin"  # JSON is left as it was
            assert conn.execute(text("SELECT COUNT(*) FROM zz_latin")).scalar() == 2
            assert conn.execute(text("SELECT name FROM zz_latin WHERE id = 1")).scalar() == "Créer société à Dubaï"
            assert conn.execute(text("SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'zz_latin' AND INDEX_NAME = 'uq_name'")).scalar() == 1
            for value in TEXTS:
                conn.execute(text("UPDATE zz_latin SET body = :v WHERE id = 2"), {"v": value})
                assert conn.execute(text("SELECT body FROM zz_latin WHERE id = 2")).scalar() == value
            assert charset.convert(conn)["tables"] == 0  # run again: nothing left to do
    finally:
        with engine.begin() as conn:
            conn.execute(text("DROP TABLE IF EXISTS zz_latin"))


def test_an_index_too_long_for_utf8mb4_stops_the_conversion_before_any_change(engine):
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS zz_long"))
        conn.execute(text("CREATE TABLE zz_long (id INT PRIMARY KEY, a VARCHAR(800), KEY ix_a (a)) DEFAULT CHARSET = latin1"))
    try:
        with engine.begin() as conn:
            assert charset.too_long_indexes(conn) == ["zz_long.ix_a (3200 bytes)"]
            with pytest.raises(RuntimeError, match="zz_long.ix_a"):
                charset.convert(conn)
            assert conn.execute(text("SELECT TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'zz_long'")).scalar() == "latin1_swedish_ci"
    finally:
        with engine.begin() as conn:
            conn.execute(text("DROP TABLE IF EXISTS zz_long"))


def test_every_script_and_emoji_goes_through_every_path_after_the_conversion(world, converted):
    client, own = world.client, world.own
    # A keyword, and the same words searched in Search Console: the keyword's row gets the query's numbers.
    reply = client.post("/api/keywords/upload", json={"site_id": own, "text": "\n".join(TEXTS), "country": "fr", "language": "fr"})
    assert reply.status_code in (200, 201, 202), reply.get_data(as_text=True)
    assert sorted(r["keyword"] for r in rows(world.engine, "SELECT keyword FROM keywords")) == sorted(TEXTS)
    with world.engine.begin() as conn:
        for n, words in enumerate(TEXTS):
            conn.execute(text(
                "INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, UTC_DATE() - INTERVAL 3 DAY, :h, :q, :c, :i, 4.0)"
            ), {"s": own, "h": f"h{n}", "q": words, "c": n + 1, "i": 10 * (n + 1)})
    listed = {r["keyword"]: r for r in rankings.listing(world.engine, own)["rows"]}
    for n, words in enumerate(TEXTS):
        assert listed[words]["impressions"] == 10 * (n + 1), words
    assert sorted(r["query"] for r in rows(world.engine, "SELECT query FROM gsc_query")) == sorted(TEXTS)

    # A competitor's page: its title and meta are read and kept as written, and reading again is no edit.
    world.pages["rival.example/"] = page_html(TEXTS[1], extra=f'<meta name="description" content="{TEXTS[2]} {TEXTS[0]}">')
    world.pages["rival.example/sitemap.xml"] = sitemap_xml([])
    rival = first_read(world)
    page = rows(world.engine, "SELECT title, meta_description FROM pages WHERE url = 'https://rival.example/'")[0]
    assert page == {"title": TEXTS[1], "meta_description": f"{TEXTS[2]} {TEXTS[0]}"}
    next_day(world, rival)
    assert rows(world.engine, "SELECT kind FROM change_events WHERE kind NOT IN ('new_page')") == []

    # My backlinks from a file: the page address and its anchor.
    parsed = clean_csv("URL,Spam\nhttps://ar.example/صفحة-🏆,1\n".encode("utf-8"))
    assert parsed.rows[0].url == "https://ar.example/صفحة-🏆"
    with world.engine.begin() as conn:  # a prospect for the same site, so saving the link joins backlinks to prospects
        conn.execute(text("INSERT INTO prospects (site_id, url, domain, authority) VALUES (:s, :u, 'ar.example', 33)"), {"s": own, "u": parsed.rows[0].url})
    sent = [{"site_id": own, "source_url": parsed.rows[0].url, "anchor": TEXTS[1], "notes": TEXTS[2], "owner": TEXTS[0]}]
    assert client.post("/api/backlinks/bulk", json={"rows": sent}).status_code == 201
    saved = client.get(f"/api/backlinks?site_id={own}").get_json()["backlinks"][0]
    assert (saved["source_url"], saved["anchor"], saved["notes"], saved["owner"]) == (parsed.rows[0].url, TEXTS[1], TEXTS[2], TEXTS[0])

    # A competitor's link file (Link gaps): anchor text and the linking page's title.
    csv = "Source url,Source title,Anchor,Authority Score\n" + "".join(f"https://l{n}.example/a,{t},{t},40\n" for n, t in enumerate(TEXTS))
    gaps.import_referrers(world.engine, own, rival, csv.encode("utf-8"), "links.csv")
    kept = rows(world.engine, "SELECT anchor, source_title FROM competitor_referrer_links ORDER BY source_url")
    assert [(r["anchor"], r["source_title"]) for r in kept] == [(t, t) for t in TEXTS]

    # A note and a task title.
    for words in TEXTS:
        assert client.post("/api/notes", json={"scope": "screen", "body": words, "site_id": own, "screen": "tasks"}).status_code == 201
        assert client.post("/api/tasks", json={"title": words}).status_code == 201
    assert sorted(r["body"] for r in rows(world.engine, "SELECT body FROM notes")) == sorted(TEXTS)
    assert sorted(r["title"] for r in rows(world.engine, "SELECT title FROM tasks")) == sorted(TEXTS)
