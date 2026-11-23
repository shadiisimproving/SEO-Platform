"""Exports: one definition per screen, three files from it. Typed Excel cells, a real PDF, a CSV Excel reads, and nothing unsafe in any."""
import csv
import io
import re
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
from openpyxl import load_workbook
from sqlalchemy import text

from seo.accounts import service as accounts
from seo.collectors import common
from seo.exports import csv_out, fmt, glyphs, pdf_out, registry, xlsx_out
from seo.exports.build import C
from seo.exports.model import MAX_PDF_ROWS, Chart, Report, Series, Table, Tile
from seo.exports.safe import cell_text, filename, http_url
from seo.metrics import search
from seo.web import create_app

PASSWORD = "correct horse battery"
END = date(2026, 11, 7)
NASTY = ["=1+1", "+SUM(A1:A9)", "-2+3", "@cmd", "\t=HYPERLINK(\"http://evil.example\")", "  =cmd|' /C calc'!A0"]


def _report(rows=None, lang="en") -> Report:
    rows = rows if rows is not None else [
        {"name": "café à emporter", "url": "https://site-one.example/abonnement/été?x=1&y=2", "clicks": 1234, "rate": 0.0525, "ctr": 5.25, "change": -12.5, "moved": 3,
         "position": 8.46, "cost": 99.5, "day": "2026-11-07", "at": "2026-11-07T09:30:00Z", "ok": True},
        {"name": "=1+1", "url": "javascript:alert(1)", "clicks": 0, "rate": None, "ctr": None, "change": 4.0, "moved": -2, "position": None, "cost": None, "day": None, "at": None, "ok": False},
    ]
    columns = [
        C("name", "Query", "text"), C("url", "Page", "url"), C("clicks", "Clicks", "int"), C("rate", "Lead rate", "pct"), C("ctr", "Click rate", "pct100"),
        C("change", "Change", "change"), C("moved", "Places gained", "delta"), C("position", "Position", "position"), C("cost", "Cost", "money"),
        C("day", "Added", "date"), C("at", "Checked", "datetime"), C("ok", "Connected", "bool"),
    ]
    report = Report("overview", "Search overview", site="site-one.example", period=(date(2026, 10, 11), END), compare=(date(2026, 9, 13), date(2026, 10, 10)),
                    filters=[("Query", "contains “café”")], lang=lang, made_at=datetime(2026, 11, 10, 8, 0))
    report.tiles = [Tile("Clicks", 1736, "int", 29.2), Tile("Average position", 8.5, "position", -3.0, lower_is_better=True)]
    report.charts = [Chart("Clicks", ["11/10", "12/10", "13/10"], [Series("Clicks", [10, 30, 20]), Series("Before", [8, None, 15], dashed=True)])]
    report.tables = [Table("query", "Queries", columns, rows), Table("page", "Pages", columns[:3], [])]
    return report


# ---- safety -----------------------------------------------------------------------------------------


@pytest.mark.parametrize("value", NASTY)
def test_text_that_looks_like_a_formula_is_made_plain(value):
    assert cell_text(value).startswith("'")


def test_ordinary_text_and_numbers_are_left_alone():
    assert cell_text("café-noir") == "café-noir" and cell_text("a=b") == "a=b" and cell_text(None) == "" and cell_text(12) == "12"
    assert cell_text("bell\x07 and null\x00") == "bell and null"


def test_a_file_name_is_safe_in_a_header():
    assert filename("overview", "site-one.example", "2026-11-10", ext="pdf") == "overview-site-one.example-2026-11-10.pdf"
    assert filename('x"; rm -rf', "../../etc/passwd", "été\r\nSet-Cookie: a=b", ext="csv") == "x-rm-rf-etc-passwd-ete-set-cookie-a-b.csv"
    assert filename("", ext="xlsx") == "export.xlsx"


def test_only_web_addresses_become_links():
    assert http_url("https://site-one.example/a?b=1") and not http_url("javascript:alert(1)") and not http_url("file:///etc/passwd") and not http_url("/moulins")


# ---- CSV ----------------------------------------------------------------------------------------------


def test_csv_has_the_mark_commas_and_no_sep_line():
    body, mime, ext = csv_out.write(_report(), "query")
    assert (mime, ext) == ("text/csv", "csv")
    assert body.startswith(b"\xef\xbb\xbf") and not body[3:].lower().startswith(b"sep=")
    rows = list(csv.reader(io.StringIO(body.decode("utf-8-sig"))))
    assert rows[0] == ["Query", "Page", "Clicks", "Lead rate", "Click rate", "Change", "Places gained", "Position", "Cost", "Added", "Checked", "Connected"]
    # A percentage carries its sign, so a spreadsheet reads 5.25% and not 5.25; a negative number is a plain -12.5, never '-12.5.
    assert rows[1] == ["café à emporter", "https://site-one.example/abonnement/été?x=1&y=2", "1234", "5.25%", "5.25%", "-12.5%", "3", "8.46", "99.5", "2026-11-07", "2026-11-07 09:30", "Yes"]
    assert rows[2][6] == "-2" and rows[2][5] == "4%"
    assert rows[2][0] == "'=1+1" and rows[2][3] == "" and rows[2][11] == "No"
    assert len(rows) == 3


def test_csv_guards_every_nasty_cell():
    report = _report([{"name": value} for value in NASTY])
    rows = list(csv.reader(io.StringIO(csv_out.write(report, "query")[0].decode("utf-8-sig"))))[1:]
    assert all(row[0].startswith("'") for row in rows) and len(rows) == len(NASTY)


def test_csv_of_several_tables_is_a_zip_unless_one_is_picked():
    body, mime, ext = csv_out.write(_report())
    assert (mime, ext) == ("application/zip", "zip")
    names = zipfile.ZipFile(io.BytesIO(body)).namelist()
    assert names == ["overview-query.csv", "overview-page.csv"]
    assert csv_out.write(_report(), "page")[2] == "csv"


def test_csv_in_french_translates_headings_and_words():
    rows = list(csv.reader(io.StringIO(csv_out.write(_report(lang="fr"), "query")[0].decode("utf-8-sig"))))
    assert rows[0][:3] == ["Requête", "Page", "Clics"] and rows[1][11] == "Oui"


# ---- Excel --------------------------------------------------------------------------------------------


def test_excel_cells_are_typed():
    book = load_workbook(io.BytesIO(xlsx_out.write(_report())))
    assert book.sheetnames == ["About", "Queries", "Pages"]
    sheet = book["Queries"]
    head = [c.value for c in sheet[1]]
    assert head[:3] == ["Query", "Page", "Clicks"]
    row = {name: sheet.cell(row=2, column=i + 1) for i, name in enumerate(head)}
    assert row["Clicks"].value == 1234 and row["Clicks"].data_type == "n" and row["Clicks"].number_format == "#,##0"
    assert row["Lead rate"].value == pytest.approx(0.0525) and row["Lead rate"].number_format == "0.0%"
    assert row["Click rate"].value == pytest.approx(0.0525) and "%" in row["Click rate"].number_format
    assert row["Change"].value == pytest.approx(-0.125) and row["Change"].font.color.rgb.endswith("B42318")
    assert row["Places gained"].value == 3 and row["Places gained"].number_format == "+#,##0;-#,##0;0"
    assert row["Position"].value == pytest.approx(8.46) and row["Position"].number_format == "0.0"
    assert row["Added"].value == datetime(2026, 11, 7) and row["Added"].is_date
    assert row["Checked"].value == datetime(2026, 11, 7, 9, 30) and row["Checked"].is_date
    assert row["Page"].hyperlink.target == "https://site-one.example/abonnement/été?x=1&y=2"
    assert row["Query"].value == "café à emporter" and row["Connected"].value == "Yes"
    assert sheet.freeze_panes == "A2" and sheet.auto_filter.ref == "A1:L3"
    assert sheet.column_dimensions["A"].width >= 20 and sheet.column_dimensions["B"].width >= 40


def test_excel_never_holds_a_formula_or_a_script_link():
    book = load_workbook(io.BytesIO(xlsx_out.write(_report([{"name": v, "url": v} for v in NASTY] + [{"name": "ok", "url": "javascript:alert(1)"}]))))
    sheet = book["Queries"]
    for row in sheet.iter_rows(min_row=2):
        for cell in row:
            assert cell.data_type != "f", cell.value
            if isinstance(cell.value, str) and cell.value.lstrip(" '")[:1] in "=+-@":
                assert cell.value.startswith("'")
        assert row[1].hyperlink is None


def test_excel_about_sheet_says_what_the_file_is():
    sheet = load_workbook(io.BytesIO(xlsx_out.write(_report())))["About"]
    cells = {sheet.cell(row=r, column=1).value: sheet.cell(row=r, column=2).value for r in range(1, sheet.max_row + 1) if sheet.cell(row=r, column=1).value}
    assert sheet["A1"].value == "Search overview"
    assert cells["Site"] == "site-one.example" and cells["Period"] == "11 Oct – 7 Nov 2026" and cells["Compared with"] == "13 Sep – 10 Oct 2026"
    assert cells["Query"] == "contains “café”" and cells["Made on"] == datetime(2026, 11, 10)
    assert cells["Clicks"] == 1736 and cells["Queries"] == 2 and cells["Pages"] == 0


def test_excel_in_french():
    book = load_workbook(io.BytesIO(xlsx_out.write(_report(lang="fr"))))
    assert book.sheetnames == ["À propos", "Requêtes", "Pages"]
    assert book["À propos"]["A3"].value == "Site" and book["Requêtes"]["C1"].value == "Clics"


# ---- PDF ----------------------------------------------------------------------------------------------


def test_pdf_is_a_real_report():
    body = pdf_out.write(_report())
    assert body.startswith(b"%PDF-") and len(body) > 8000
    assert b"/Geist" in body or b"Geist" in body  # the font is embedded, so accents draw anywhere
    assert body.count(b"/Type /Page\n") + body.count(b"/Type /Page ") + body.count(b"/Type /Page>") >= 1


def test_pdf_holds_the_expected_words(tmp_path):
    """Read back with pdftotext when this computer has it; the structure is checked either way."""
    import shutil
    import subprocess

    for lang, words in (("en", ["Search overview", "site-one.example", "11 Oct – 7 Nov 2026", "Made on 10 Nov 2026", "café à emporter", "1,234", "Page 1 of 2", "Queries"]),
                        ("fr", ["Vue d'ensemble de la recherche", "Créé le 10 nov. 2026", "comparé à", "Requêtes", "café à emporter", "1 234", "Page 1 sur 2"])):
        body = pdf_out.write(_report(lang=lang))
        assert body.startswith(b"%PDF-")
        if not shutil.which("pdftotext"):
            continue
        path = tmp_path / f"{lang}.pdf"
        path.write_bytes(body)
        found = subprocess.run(["pdftotext", "-layout", str(path), "-"], capture_output=True, check=True).stdout.decode("utf-8").replace(" ", " ").replace("’", "'")
        for word in words:
            assert word in found, (lang, word, found[:600])
        assert "=1+1" in found  # in a PDF a formula is only text, and is shown as it is


def test_pdf_turns_on_its_side_for_a_wide_table_and_repeats_long_ones():
    full = {"rate": 0.05, "ctr": 5.2, "change": -12.5, "moved": 3, "position": 8.4, "cost": 99.5, "day": "2026-11-07", "at": "2026-11-07T09:30:00Z", "ok": True}
    wide = _report([{**full, "name": f"requête numéro {i} avec des mots", "url": f"https://site-one.example/une/adresse/très/longue/{i}/et-encore-plus-longue-que-ça", "clicks": i} for i in range(130)])
    body = pdf_out.write(wide)
    assert b"841.8898 595.2756" in body or b"841.89 595.28" in body  # A4 on its side
    assert body.count(b"/Type /Page") - body.count(b"/Type /Pages") >= 3
    narrow = _report()
    narrow.tables = [Table("t", "Queries", [C("name", "Query", "text"), C("clicks", "Clicks", "int")], [{"name": "a", "clicks": 1}])]
    assert b"595.2756 841.8898" in pdf_out.write(narrow) or b"595.28 841.89" in pdf_out.write(narrow)


def test_pdf_caps_a_very_long_table_and_says_so(tmp_path):
    import shutil
    import subprocess

    report = _report()
    report.tables = [Table("t", "Queries", [C("name", "Query", "text"), C("clicks", "Clicks", "int")], [{"name": f"q{i}", "clicks": i} for i in range(MAX_PDF_ROWS + 50)])]
    body = pdf_out.write(report)
    assert body.startswith(b"%PDF-")
    if shutil.which("pdftotext"):
        path = tmp_path / "long.pdf"
        path.write_bytes(body)
        found = subprocess.run(["pdftotext", str(path), "-"], capture_output=True, check=True).stdout.decode("utf-8")
        assert f"First 1,000 of 1,050 rows" in found and f"q{MAX_PDF_ROWS - 1}" in found and f"q{MAX_PDF_ROWS + 1}\n" not in found


def test_pdf_leaves_out_a_column_with_nothing_in_it(tmp_path):
    import shutil
    import subprocess

    if not shutil.which("pdftotext"):
        pytest.skip("needs pdftotext to read the PDF back")
    report = _report()
    report.tables = [Table("t", "Queries", [C("name", "Query", "text"), C("clicks", "Clicks", "int"), C("cost", "Cost", "money")], [{"name": "a", "clicks": 1}, {"name": "b", "clicks": 2}])]
    path = tmp_path / "slim.pdf"
    path.write_bytes(pdf_out.write(report))
    found = subprocess.run(["pdftotext", str(path), "-"], capture_output=True, check=True).stdout.decode("utf-8")
    assert "Clicks" in found and "Cost" not in found
    assert [c.value for c in load_workbook(io.BytesIO(xlsx_out.write(report)))["Queries"][1]] == ["Query", "Clicks", "Cost"]  # Excel keeps it


def test_arabic_is_joined_and_other_scripts_fall_back():
    glyphs.register()
    runs = glyphs.runs("قهوة")
    assert runs[0][0] == glyphs.ARABIC and all(0xFE70 <= ord(c) <= 0xFEFF for c in runs[0][1])  # joined forms, not loose letters
    assert glyphs.runs("café")[0][0] == glyphs.REGULAR and glyphs.runs("кофе")[0][0] == glyphs.REGULAR
    assert glyphs.runs("καφές")[0][0] == glyphs.OTHER
    assert pdf_out.write(_report([{"name": "قهوة مختصة café コーヒー"}])).startswith(b"%PDF-")


# ---- words and numbers --------------------------------------------------------------------------------


def test_numbers_read_right_in_both_languages():
    assert fmt.cell("en", 1234567, "int") == "1,234,567" and fmt.cell("fr", 1234567, "int") == "1 234 567"
    assert fmt.cell("en", 0.0526, "pct") == "5.3%" and fmt.cell("fr", 5.26, "pct100") == "5,3 %"
    assert fmt.cell("en", 12.0, "change") == "+12.0%" and fmt.cell("en", -3.5, "change") == "−3.5%" and fmt.cell("en", 0, "change") == "0.0%"
    assert fmt.cell("en", 12.0, "change", trim=True) == "+12%" and fmt.cell("en", 5.0, "pct100", trim=True) == "5%" and fmt.cell("en", 5.0, "pct100") == "5.0%"
    assert fmt.cell("en", 99.97, "pct100") == "99.97%"
    assert fmt.cell("fr", "2026-11-07", "date") == "7 nov. 2026" and fmt.cell("en", "2026-11-07T09:30:00Z", "datetime") == "7 Nov 2026, 09:30"
    assert fmt.tone(5, "change") == "good" and fmt.tone(5, "delta_low") == "bad" and fmt.tone(0, "change") is None


# ---- the registry, on a real database -------------------------------------------------------------------


@pytest.fixture
def site(engine):
    search._live_cache.clear()
    with engine.begin() as conn:
        site_id = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('site-one.example', 'https://site-one.example/', 'own')")).lastrowid
        conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('acme-store.com', 'https://acme-store.com/', 'competitor')"))
        conn.execute(text("INSERT INTO site_sources (site_id, source, data_through, fresh_from, fresh_through) VALUES (:s, 'gsc', :d, :f, :t)"), {"s": site_id, "d": END - timedelta(days=2), "f": END - timedelta(days=1), "t": END})
        for back in range(60):
            day = END - timedelta(days=back)
            conn.execute(text("INSERT INTO gsc_daily (site_id, day, clicks, impressions, position) VALUES (:s, :d, :c, 1000, 8.5)"), {"s": site_id, "d": day, "c": 50 if back < 28 else 40})
        for name, clicks in (("café en grains", 30), ("=cmd|' /C calc'!A0", 20), ("moulin à café", 10)):
            conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, :n, :c, 400, 6.5)"), {"s": site_id, "d": END - timedelta(days=3), "h": common.digest(name), "n": name, "c": clicks})
        conn.execute(text("INSERT INTO gsc_page (site_id, day, page_hash, page, clicks, impressions, position) VALUES (:s, :d, :h, :n, 60, 900, 5.0)"),
                     {"s": site_id, "d": END - timedelta(days=3), "h": common.digest("https://site-one.example/abonnement"), "n": "https://site-one.example/abonnement"})
    return site_id


@pytest.fixture
def fixed_today(monkeypatch):
    monkeypatch.setattr(common, "google_today", lambda engine, now=None: END + timedelta(days=1))


ARGS = {
    "channels": {"from": "2026-10-11", "to": "2026-11-07"}, "conversions": {"from": "2026-10-11", "to": "2026-11-07"}, "content": {"from": "2026-10-11", "to": "2026-11-07"}, "content-tracker": {"from": "2026-10-11", "to": "2026-11-07"},
    "ai": {"from": "2026-10-11", "to": "2026-11-07"}, "pages": {"from": "2026-10-11", "to": "2026-11-07"}, "site-page": {"url": "/"}, "ads": {"from": "2026-10-11", "to": "2026-11-07", "compare_from": "2026-09-13", "compare_to": "2026-10-10"},
}


def test_every_view_makes_all_three_files_in_both_languages(engine, site, fixed_today):
    """Each screen's export runs on a site with next to nothing in it, in English and French, and every label has its French."""
    fmt.MISSING.clear()
    views = [v["id"] for v in registry.listing()]
    assert {"overview", "keywords", "insights", "today", "channels", "conversions", "content", "ai", "backlinks", "links", "health", "uptime",
            "competitors", "keyword-check", "page-pairs", "link-gaps", "tasks", "notes", "resources", "connections"} <= set(views)
    for view_id in views:
        if view_id == "competitor":
            continue  # needs a competitor: its own test below
        for lang in ("en", "fr"):
            report = registry.build(engine, view_id, {"site_id": str(site), **ARGS.get(view_id, {})}, lang)
            assert report.tables, view_id
            assert pdf_out.write(report).startswith(b"%PDF-"), view_id
            assert load_workbook(io.BytesIO(xlsx_out.write(report))).sheetnames[0] in ("About", "À propos"), view_id
            assert csv_out.write(report)[0], view_id
            for table in report.tables:
                fmt.tr(lang, table.empty)
    assert not fmt.MISSING, f"no French for: {sorted(fmt.MISSING)}"


def test_overview_export_has_the_screens_numbers_filters_and_order(engine, site, fixed_today):
    from seo.metrics import search as service

    args = {"site_id": str(site), "range": "28d", "compare": "prev", "dim": "query"}
    scope, window = service.scope_for(engine, args)
    screen = service.overview(scope, window)
    rows = service.breakdown(scope, "query")["rows"]
    report = registry.build(engine, "overview", args)
    assert report.site == "site-one.example" and report.period == (date.fromisoformat(window["from"]), date.fromisoformat(window["to"]))
    assert report.tiles[0].value == screen["totals"]["clicks"] and report.tiles[1].value == screen["totals"]["impressions"]
    assert [t.id for t in report.tables] == ["query", "page", "country", "device", "google_updates"]
    assert [r["name"] for r in report.tables[0].rows] == [r["name"] for r in rows] and len(rows) == 3
    # The counted days only: the not-final days the screen draws after the period stay out of the file (review W12).
    assert report.charts and len(report.charts[0].series[0].values) == len([p for p in screen["series"] if p.get("counted", True) is not False])

    picked = registry.build(engine, "overview", {**args, "q": "café", "sort": "clicks", "dir": "asc"})
    assert [r["name"] for r in picked.tables[0].rows] == ["moulin à café", "café en grains"]
    assert ("Query", "contains “café”") in picked.filters
    assert len(picked.tables[1].rows) == 1  # the filter belongs to the table on screen; Pages comes whole

    body = csv_out.write(registry.build(engine, "overview", args), "query")[0].decode("utf-8-sig")
    assert "'=cmd|' /C calc'!A0" in body  # a query scraped from Search Console can't run in the spreadsheet


def test_all_rows_are_exported_past_the_screens_500(engine, site, fixed_today):
    with engine.begin() as conn:
        for i in range(620):
            name = f"requête {i}"
            conn.execute(text("INSERT INTO gsc_query (site_id, day, query_hash, query, clicks, impressions, position) VALUES (:s, :d, :h, :n, 1, 30, 9.0)"), {"s": site, "d": END - timedelta(days=4), "h": common.digest(name), "n": name})
    args = {"site_id": str(site), "range": "28d", "compare": "none", "dim": "query"}
    scope, _window = search.scope_for(engine, args)
    assert len(search.breakdown(scope, "query")["rows"]) == search.TABLE_ROWS == 500
    report = registry.build(engine, "overview", args)
    assert report.tables[0].count == 623 and not report.capped
    assert search.TABLE_ROWS == 500  # the screen's own limit is back as it was
    assert len(list(csv.reader(io.StringIO(csv_out.write(report, "query")[0].decode("utf-8-sig"))))) == 624


def test_a_table_past_the_cap_is_cut_and_says_so(engine, site, fixed_today, monkeypatch):
    monkeypatch.setattr(registry, "MAX_ROWS", 2)
    report = registry.build(engine, "overview", {"site_id": str(site), "range": "28d", "dim": "query"})
    assert report.tables[0].count == 2 and report.tables[0].total == 3 and report.capped


def test_competitor_profile_and_refusals(engine, site):
    from seo.core.errors import Refused

    with engine.begin() as conn:
        rival = conn.execute(text("SELECT id FROM sites WHERE host = 'acme-store.com'")).scalar()
        conn.execute(text("INSERT INTO site_competitors (site_id, competitor_id, source) VALUES (:s, :c, 'manual')"), {"s": site, "c": rival})
    report = registry.build(engine, "competitor", {"site_id": str(site), "competitor_id": str(rival)}, "fr")
    assert ("Competitor", "acme-store.com") in report.filters and pdf_out.write(report).startswith(b"%PDF-")
    for view_id, args in (("backlinks", {}), ("backlinks", {"site_id": str(rival)}), ("competitors", {"site_id": "1 OR 1=1"}), ("overview", {"site_id": str(rival)}), ("health", {"site_id": "999999"})):
        with pytest.raises(Refused):
            registry.build(engine, view_id, args)


def test_connections_export_never_holds_a_key(engine, site):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO connections (tool, secret, last4, last_error) VALUES ('SerpApi', 'sk-live-SECRETSECRET9876', '9876', 'key sk-live-SECRETSECRET9876 was refused')"))
    report = registry.build(engine, "connections", {})
    for body in (csv_out.write(report)[0], xlsx_out.write(report)):
        pass
    words = " ".join(str(c.value(row)) for table in report.tables for row in table.rows for c in table.columns) + " ".join(c.label for t in report.tables for c in t.columns)
    assert "9876" not in words and "SECRET" not in words and "refused" not in words
    book = load_workbook(io.BytesIO(xlsx_out.write(report)))
    flat = " ".join(str(cell.value) for sheet in book.worksheets for row in sheet.iter_rows() for cell in row)
    assert "sk-live" not in csv_out.write(report)[0].decode("latin1")
    assert "9876" not in flat and "SECRET" not in flat and "SerpApi" in flat


# ---- the route ----------------------------------------------------------------------------------------


@pytest.fixture
def app(engine):
    return create_app(engine=engine, secret_key="test-secret-key")


def _signed_in(app, engine):
    accounts.create_user(engine, "boss@example.com", "Boss", "admin", password=PASSWORD, must_change=False)
    client = app.test_client()
    assert client.post("/api/auth/login", json={"email": "boss@example.com", "password": PASSWORD}).status_code == 200
    return client


def test_exports_need_a_sign_in(app, engine, site):
    client = app.test_client()
    for path in ("/api/export/overview.pdf", "/api/export/keywords.xlsx", "/api/export/backlinks.csv?site_id=1", "/api/export/connections.csv", "/api/export/views"):
        reply = client.get(path)
        assert reply.status_code == 401 and reply.get_json()["signed_out"] is True, path


def test_a_member_with_a_temporary_password_gets_nothing(app, engine, site):
    accounts.create_user(engine, "new@example.com", "New", "member", password=PASSWORD, must_change=True)
    client = app.test_client()
    client.post("/api/auth/login", json={"email": "new@example.com", "password": PASSWORD})
    assert client.get(f"/api/export/overview.csv?site_id={site}").status_code == 403


def test_the_route_serves_each_format_with_a_safe_name(app, engine, site, fixed_today):
    client = _signed_in(app, engine)
    pdf = client.get(f"/api/export/overview.pdf?site_id={site}&range=28d&lang=fr")
    assert pdf.status_code == 200 and pdf.mimetype == "application/pdf" and pdf.data.startswith(b"%PDF-")
    assert re.fullmatch(r'attachment; filename="overview-site-one\.example-2026-10-09-to-2026-11-05\.pdf"', pdf.headers["Content-Disposition"])
    assert pdf.headers["Cache-Control"] == "no-store" and pdf.headers["X-Content-Type-Options"] == "nosniff"
    book = client.get(f"/api/export/overview.xlsx?site_id={site}&range=28d")
    assert book.status_code == 200 and book.mimetype.endswith("spreadsheetml.sheet") and load_workbook(io.BytesIO(book.data)).sheetnames[:2] == ["About", "Queries"]
    one = client.get(f"/api/export/overview.csv?site_id={site}&range=28d&table=page")
    assert one.status_code == 200 and one.mimetype == "text/csv" and one.data.startswith(b"\xef\xbb\xbf") and "overview-page-site-one.example" in one.headers["Content-Disposition"]
    assert one.headers["X-Export-Rows"] and "X-Export-Capped" not in one.headers
    several = client.get(f"/api/export/overview.csv?site_id={site}&range=28d")
    assert several.mimetype == "application/zip" and several.headers["Content-Disposition"].endswith('.zip"')


def test_the_route_refuses_what_the_screens_refuse(app, engine, site, fixed_today):
    client = _signed_in(app, engine)
    assert client.get("/api/export/nothing.pdf").status_code == 404
    assert client.get(f"/api/export/overview.exe?site_id={site}").status_code == 404
    assert client.get("/api/export/overview.pdf?site_id=999999").status_code == 400
    assert client.get(f"/api/export/overview.csv?site_id={site}&min_clicks=abc").get_json()["error"] == "Filters take numbers."
    assert client.get(f"/api/export/overview.csv?site_id={site}&q_mode=evil").status_code == 400
    assert client.get("/api/export/backlinks.pdf").get_json()["error"] == "Pick one site to export its links."
    listed = client.get("/api/export/views").get_json()
    assert listed["formats"] == ["pdf", "xlsx", "csv"] and any(v["id"] == "overview" for v in listed["views"])


# ---- what is on screen ----------------------------------------------------------------------------------


def _tasks(engine, site):
    from seo.tasks import service as tasks

    made = [tasks.create(engine, {"title": title, "site_id": site, **extra}) for title, extra in (("Fix the broken link", {}), ("Write the guide", {"status": "done"}), ("Ask for a link", {}))]
    with engine.begin() as conn:
        other = conn.execute(text("INSERT INTO sites (host, start_url, kind) VALUES ('site-two.example', 'https://site-two.example/', 'own')")).lastrowid
    made.append(tasks.create(engine, {"title": "Another site's task", "site_id": other}))
    made.append(tasks.create(engine, {"title": "A task for no site"}))
    return [t["id"] for t in made]


def test_the_rows_on_screen_in_their_order_and_only_this_sites(engine, site):
    ids = _tasks(engine, site)
    whole = registry.build(engine, "tasks", {"site_id": str(site)})
    assert [r["title"] for r in whole.tables[0].rows if r["title"] in ("A task for no site", "Another site's task")] == ["A task for no site"]  # as on the board
    # The screen sends the tasks it shows, in its order. Another site's task can't be pulled in by naming it, and nonsense is ignored.
    seen = {"tasks": [str(ids[2]), str(ids[0]), str(ids[3]), "999999", "x' OR 1=1", None, True]}
    report = registry.build(engine, "tasks", {"site_id": str(site), "seen": seen, "seen_words": [["Search", "Open"], ["Period", "This week"], ["bad"], [1, 2]]}, "fr")
    assert [r["title"] for r in report.tables[0].rows] == ["Ask for a link", "Fix the broken link"]
    assert report.tiles[0].value == 2 and report.tiles[1].value == 0  # the tiles count what the file holds
    assert ("Search", "Open") in report.filters  # what was typed stays as it was typed, even when it is one of the app's words
    assert fmt.filter_value("fr", report.filters[0][1]) == "Open" and fmt.filter_value("fr", "Open") == "Ouvert"
    nothing = registry.build(engine, "tasks", {"site_id": str(site), "seen": {"tasks": []}})
    assert nothing.tables[0].rows == [] and nothing.tiles[0].value == 0  # filters that match nothing give an empty file, not everything


def test_too_long_a_list_from_the_screen_is_refused(engine, site, monkeypatch):
    from seo.core.errors import Refused

    monkeypatch.setattr(registry, "MAX_SEEN_IDS", 3)
    with pytest.raises(Refused):
        registry.build(engine, "tasks", {"site_id": str(site), "seen": {"tasks": ["1", "2", "3", "4"]}})


def test_filters_in_the_header_are_french(engine, site, fixed_today, tmp_path):
    import shutil
    import subprocess

    report = registry.build(engine, "overview", {"site_id": str(site), "range": "28d", "dim": "query", "q": "café", "q_mode": "not", "show": "gaining"}, "fr")
    words = [(fmt.tr("fr", label), fmt.filter_value("fr", value)) for label, value in report.filters]
    assert ("Requête", "ne contient pas « café »") in words and ("Requêtes", "En hausse") in words
    report = registry.build(engine, "uptime", {"site_id": str(site)}, "fr")
    assert [fmt.filter_value("fr", v) for _l, v in report.filters] == ["30 derniers jours"]
    assert fmt.filter_value("fr", date(2026, 11, 10)) == "10 nov. 2026" and fmt.filter_value("en", date(2026, 11, 10)) == "10 Nov 2026"
    sheet = load_workbook(io.BytesIO(xlsx_out.write(report)))["À propos"]
    assert "30 derniers jours" in [c.value for row in sheet.iter_rows() for c in row]
    if shutil.which("pdftotext"):
        path = tmp_path / "uptime.pdf"
        path.write_bytes(pdf_out.write(report))
        assert "Période : 30 derniers jours" in subprocess.run(["pdftotext", str(path), "-"], capture_output=True, check=True).stdout.decode().replace(" ", " ")


def test_the_links_checkers_reasons_are_french():
    from seo.links import checker

    said = [checker._status_reason(code, status, error) for code, status, error in
            ((None, "robots", None), (None, "refused", None), (None, "network_error", None), (None, "rate_limited", None), (999, "ok", None), (403, "blocked", None), (503, "ok", None), (None, "ok", None), (418, "ok", None))]
    said += ["Page not found", "Page gone", "3 redirects before the final page", "More than 9 redirects, so the check gave up", "Redirects to another website: https://other.example/", "Took 6.2 s to answer"]
    fmt.MISSING.clear()
    french = [fmt.tr("fr", words) for words in said]
    assert not fmt.MISSING and all(f != e for f, e in zip(french, said)), [e for f, e in zip(french, said) if f == e]
    assert fmt.tr("fr", "Took 6.2 s to answer") == "A mis 6,2 s à répondre" and fmt.tr("fr", "The site answered 418") == "Le site a répondu 418"
    # Free-form: the network library's reason stays in English inside the French sentence.
    assert fmt.tr("fr", "The request failed: timed out") == "La requête a échoué : timed out"


def test_todays_stored_sentences_are_french_in_the_old_wording_and_the_new():
    """Alerts keep the English they were saved with: the wording before 2026-11-11 and the one since have the same French."""
    for old, new, french in (
        ("/a/ lost 32% of its Google clicks", "/a/: −32% Google clicks", "/a/ : −32 % de clics Google"),
        ("Last 7 days against the 7 before: 85 → 58", "Week on week: 85 → 58", "Semaine sur semaine : 85 → 58"),
        ("About 12 clicks a month at stake. See Search → Insights.", "~12 clicks/month at stake", "~12 clics/mois en jeu"),
        ("About 12 clicks a month at stake", "~12 clicks/month at stake", "~12 clics/mois en jeu"),
        ("Clarity only keeps the last 3 days for the app to read.", "Clarity keeps only 3 days of data.", "Clarity ne garde que 3 jours de données."),
        ("site-one.example: the site's robots.txt answers with a server error, so search engines stay away",
         "site-one.example: robots.txt gives a server error, so search engines stay away",
         None),
    ):
        assert fmt.tr("fr", old) != old and fmt.tr("fr", new) != new, (old, new)
        if french:
            assert fmt.tr("fr", old) == fmt.tr("fr", new) == french
    assert fmt.tr("fr", "Last two AI Overview checks") == "Deux derniers relevés de l'AI Overview"
    assert fmt.tr("fr", "site-one.example: start page didn't load; certificate expired") == "site-one.example : la page de départ n'a pas chargé ; certificat expiré"


def test_every_view_in_french_has_no_english_the_app_wrote(engine, site, fixed_today):
    """The check tests/ui/check_exports_french.py runs on the demo's full data, here on this small site."""
    from tests.ui.check_exports_french import check

    with engine.begin() as conn:
        rival = conn.execute(text("SELECT id FROM sites WHERE host = 'acme-store.com'")).scalar()
        conn.execute(text("INSERT INTO site_competitors (site_id, competitor_id, source) VALUES (:s, :c, 'manual')"), {"s": site, "c": rival})
    _tasks(engine, site)
    labels, cells = check(engine, site, rival)
    assert not labels, labels
    assert not [c for c in cells if c[3] == "status word"], cells


# ---- numbers, icons, characters, a server without Pillow --------------------------------------------------


def test_numbers_are_numbers_in_excel_and_csv():
    report = _report()
    sheet = load_workbook(io.BytesIO(xlsx_out.write(report)))["Queries"]
    moved, change = sheet.cell(row=3, column=7), sheet.cell(row=3, column=6)
    assert moved.value == -2 and moved.data_type == "n" and change.value == pytest.approx(0.04) and "%" in change.number_format
    rows = list(csv.reader(io.StringIO(csv_out.write(report, "query")[0].decode("utf-8-sig"))))
    assert rows[2][6] == "-2" and rows[1][3] == "5.25%" and not any(cell.startswith("'-") for row in rows for cell in row[2:])


def _png(size: int = 16) -> bytes:
    """A small blue square, made without any imaging library."""
    import struct
    import zlib

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + b"\x17\x6a\xab" * size for _ in range(size))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def test_the_pdf_header_shows_the_icon_the_app_stored(engine, site, fixed_today):
    """Stored the way the app stores it: the logo job reads the home page, follows its <link rel=icon>, keeps the image."""
    from seo.backlinks import logos
    from seo.crawl.fetch import FetchResult

    class Websites:
        requests = 0

        def get(self, url, **_options):
            self.requests += 1
            if url == "https://site-one.example/":
                return FetchResult(url=url, status="ok", http_status=200, body=b'<html><head><link rel="icon" sizes="32x32" href="/brand/icon.png"></head></html>', final_url=url)
            if url == "https://site-one.example/brand/icon.png":
                return FetchResult(url=url, status="ok", http_status=200, body=_png(), final_url=url)
            return FetchResult(url=url, status="gone", http_status=404)

    args = {"site_id": str(site), "range": "28d", "dim": "query"}
    plain = pdf_out.write(registry.build(engine, "overview", args))
    assert b"/Subtype /Image" not in plain  # no icon yet: the letter tile, drawn as shapes
    logos.queue_for(engine, ["site-one.example"])
    assert logos.fetch_for(engine, "site-one.example", Websites(), lambda used: None) == "found"
    report = registry.build(engine, "overview", args)
    assert report.logo and report.logo[1] == "image/png" and report.logo[0].startswith(b"\x89PNG")
    assert b"/Subtype /Image" in pdf_out.write(report)
    # An icon the PDF can't draw (an SVG, or bytes that aren't an image) gives the letter tile, never an error.
    with engine.begin() as conn:
        conn.execute(text("UPDATE site_logos SET content_type = 'image/svg+xml', image = :i WHERE domain = 'site-one.example'"), {"i": b"<svg xmlns='http://www.w3.org/2000/svg'/>"})
    assert registry.build(engine, "overview", args).logo is None
    broken = registry.build(engine, "overview", args)
    broken.logo = (b"\x89PNG not really", "image/png")
    assert b"/Subtype /Image" not in pdf_out.write(broken)


def test_characters_the_pdf_cant_draw_stay_in_excel_and_csv(tmp_path):
    import shutil
    import subprocess

    report = _report([{"name": "コーヒー 咖啡 커피"}, {"name": "café"}])
    body = pdf_out.write(report)
    assert report.undrawn
    if shutil.which("pdftotext"):
        path = tmp_path / "cjk.pdf"
        path.write_bytes(body)
        found = subprocess.run(["pdftotext", str(path), "-"], capture_output=True, check=True).stdout.decode()
        assert found.count("Some characters show as “?” in this PDF") == 1
    assert load_workbook(io.BytesIO(xlsx_out.write(report)))["Queries"]["A2"].value == "コーヒー 咖啡 커피"
    assert "コーヒー 咖啡 커피" in csv_out.write(report, "query")[0].decode("utf-8-sig")
    fine = _report([{"name": "café"}])
    pdf_out.write(fine)
    assert not fine.undrawn  # the line is only there when it is true
    assert sum(f.stat().st_size for f in glyphs.FONT_DIR.glob("*.ttf")) < 1_500_000  # no large font came in for them


def test_without_pillow_excel_and_csv_still_work_and_pdf_is_not_offered(app, engine, site, fixed_today, monkeypatch):
    """reportlab cannot load at all without Pillow (reportlab/lib/utils.py imports it). Such a server makes Excel and CSV,
    the menu leaves PDF out, and nothing else in the app needs Pillow."""
    import subprocess
    import sys

    monkeypatch.setitem(sys.modules, "PIL", None)
    assert registry.formats() == ["xlsx", "csv"]
    client = _signed_in(app, engine)
    assert client.get("/api/export/views").get_json()["formats"] == ["xlsx", "csv"]
    assert client.get(f"/api/export/overview.pdf?site_id={site}").status_code == 400
    assert client.get(f"/api/export/overview.xlsx?site_id={site}&range=28d").data.startswith(b"PK")
    # A fresh Python where Pillow can't be imported at all: the app and the two writers load and work.
    code = (
        "import sys, importlib.abc\n"
        "class Block(importlib.abc.MetaPathFinder):\n"
        "    def find_spec(self, name, path, target=None):\n"
        "        if name == 'PIL' or name.startswith('PIL.'): raise ImportError('no Pillow here')\n"
        "sys.meta_path.insert(0, Block())\n"
        "import seo.web, seo.web.exports_api\n"
        "from seo.exports import registry, xlsx_out, csv_out\n"
        "from seo.exports.model import Column, Report, Table\n"
        "report = Report('overview', 'Search overview', site='site-one.example', tables=[Table('query', 'Queries', [Column('name', 'Query'), Column('clicks', 'Clicks', 'int')], [{'name': 'café', 'clicks': 3}])])\n"
        "assert registry.formats() == ['xlsx', 'csv'], registry.formats()\n"
        "assert xlsx_out.write(report).startswith(b'PK') and b'caf' in csv_out.write(report)[0]\n"
        "try:\n    import seo.exports.pdf_out\nexcept ImportError:\n    print('pdf unavailable')\n"
    )
    done = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=str(Path(__file__).resolve().parent.parent))
    assert done.returncode == 0, done.stderr
    assert "pdf unavailable" in done.stdout


def test_a_file_name_says_the_site_the_days_and_the_competitor(app, engine, site, fixed_today):
    with engine.begin() as conn:
        rival = conn.execute(text("SELECT id FROM sites WHERE host = 'acme-store.com'")).scalar()
        conn.execute(text("INSERT INTO site_competitors (site_id, competitor_id, source) VALUES (:s, :c, 'manual')"), {"s": site, "c": rival})
    client = _signed_in(app, engine)
    names = {
        f"/api/export/competitor.pdf?site_id={site}&competitor_id={rival}": r"competitor-acme-store\.com-site-one\.example-\d{4}-\d\d-\d\d\.pdf",
        f"/api/export/channels.xlsx?site_id={site}&from=2026-10-11&to=2026-11-07": r"channels-site-one\.example-2026-10-11-to-2026-11-07\.xlsx",
        "/api/export/today.csv?site_id=all&table=todo": r"today-todo-all-sites-\d{4}-\d\d-\d\d(-to-\d{4}-\d\d-\d\d)?\.csv",
    }
    for path, pattern in names.items():
        reply = client.get(path)
        assert reply.status_code == 200, (path, reply.get_data(as_text=True)[:200])
        assert re.fullmatch(f'attachment; filename="{pattern}"', reply.headers["Content-Disposition"]), reply.headers["Content-Disposition"]


def test_every_fixed_word_an_export_can_write_has_french():
    """The words the views pick from by code, including the ones a small test site never shows."""
    from seo.competitors import quality
    from seo.exports import views_competitors as vc, views_links as vl, views_search as vs, views_traffic as vt, views_work as vw
    from seo.exports.words import FR
    from seo.health import audit
    from seo.links import service as links

    words = [v[0] for v in audit.CHECKS.values()] + [v[0] for v in audit.SITE_CHECKS.values()] + [*quality.REASONS.values(), quality.reason_words("nothing-like-it")] + [*links.GROUPS.values()]
    for table in (vs.FINDING_NAMES, vs.GROUP_WORDS, vs.STATUS_WORDS, vs.SHOW_WORDS, vs.OPP_TITLES, vc.MOVE_KINDS, vc.AI_STATES, vc.AI_KINDS, vc.TRACKING, vl.STATUS, vl.STAGES, vl.OUTCOMES,
                  vl.SEVERITY, vl.STATES, vl.OUTAGES, vt.CHANGE_KINDS, vw.TASK_STATUS, vw.PRIORITY, vw.SCOPES, vw.NOTE_KINDS):
        words += list(table.values())
    assert [w for w in words if w not in FR] == []
