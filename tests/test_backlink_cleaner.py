"""The backlink CSV filter: parser, filtering rules, root domains, and that the browser copy behaves the same."""
import json
import shutil
import subprocess
from dataclasses import asdict
from pathlib import Path

import pytest

from seo.backlinks.cleaner import (
    MULTI_SUFFIXES,
    UPLOAD_MAX_BYTES,
    CleanerError,
    check_upload,
    clean_csv,
    root_domain,
)

ROOT = Path(__file__).resolve().parent.parent
BOM = b"\xef\xbb\xbf"

SEMRUSH = (
    "Source url,Source title,Authority Score,Toxic Score\n"
    "https://blog.alpha.example/post,Alpha,68,12\n"
    "https://beta.example/page,Beta,41,31\n"
    "https://gamma.example/page,Gamma,22,30\n"
).encode()

UBERSUGGEST_SEMICOLON = (
    "Source URL;Domain Authority;Spam Score\n"
    "https://one.example/a;55;4\n"
    "https://two.example/b;33;80\n"
).encode()

CASES = {
    "semrush_comma": SEMRUSH,
    "ubersuggest_semicolon": UBERSUGGEST_SEMICOLON,
    "excel_bom": BOM + SEMRUSH,
    "bom_and_semicolon": BOM + UBERSUGGEST_SEMICOLON,
    "tabs": b"Source URL\tDA\tSpam\nhttps://one.example/a\t12\t3\n",
    "excel_sep_line": b"sep=;\nURL;Spam\nhttps://one.example/a;3\n",
    "sheets_sep_cell": b"sep=;,\nURL,Spam\nhttps://one.example/a,3\n",
    "sheets_sep_quoted": b'"sep=;",\nURL,Spam\nhttps://one.example/a,3\n',
    "sep_line_that_is_wrong": b"sep=;\nURL,Spam\nhttps://one.example/a,3\n",
    "utf16": "Source URL\tSpam Score\nhttps://one.example/é\t3\n".encode("utf-16"),
    "windows_1252": "Source URL;Spam Score;Note\nhttps://one.example/a;3;été\n".encode("cp1252"),
    "crlf": b"URL,Spam\r\nhttps://one.example/a,3\r\n\r\n",
    "quoted_fields": b'URL,Title,Spam\n"https://one.example/a,b","Says ""hi""\nthere",3\n',
    "blank_spam": b"URL,Spam Score\nhttps://one.example/a,\nhttps://two.example/b,5\n",
    "unreadable_spam": b"URL,Spam Score\nhttps://one.example/a,n/a\nhttps://two.example/b,-\n",
    "decimal_comma_spam": b"URL;Spam Score\nhttps://one.example/a;45,5\nhttps://two.example/b;12,5\n",
    "percent_spam": b"URL,Spam Score\nhttps://one.example/a,12%\nhttps://two.example/b,31%\n",
    "exactly_30": b"URL,Spam\nhttps://one.example/a,30\nhttps://two.example/b,30.1\n",
    "no_usable_url": b"URL,Spam\n,1\nn/a,1\nnot a link,1\nmailto:a@b.example,1\nhttps://one.example/a,1\n",
    "no_scheme": b"URL,Spam\nblog.one.example/a,1\n//cdn.two.example/b,1\n",
    "same_domain_twice": b"URL,Spam\nhttps://a.one.example/x,1\nhttps://b.one.example/y,1\nhttps://two.example/z,1\n",
    "only_delimiters_row": b"URL;Spam\n;\nhttps://one.example/a;1\n",
    "short_rows": b"URL,Title,Spam\nhttps://one.example/a\n",
    "no_authority_column": b"URL,Spam\nhttps://one.example/a,1\n",
    "authority_values": b"URL,DR,Spam\nhttps://a.example/,67.5,1\nhttps://b.example/,,1\nhttps://c.example/,high,1\n",
    "missing_spam": b"Source URL,Authority Score\nhttps://one.example/a,4\n",
    "missing_url": b"Authority Score;Spam Score\n4;2\n",
    "missing_both": b"Foo,Bar\n1,2\n",
    "header_only": b"URL,Spam\n",
    "empty": b"",
    "only_bom": BOM,
}


def clean(name, known=None):
    return clean_csv(CASES[name], known=known)


# ---- reading the file ------------------------------------------------------------

@pytest.mark.parametrize("name", ["excel_bom", "semrush_comma"])
def test_comma_file_with_and_without_bom(name):
    result = clean(name)
    assert result.total == 3
    assert result.kept == 2
    assert result.removed == 1
    assert result.source_format == "semrush"


@pytest.mark.parametrize("name", ["ubersuggest_semicolon", "bom_and_semicolon"])
def test_semicolon_file(name):
    result = clean(name)
    assert result.source_format == "ubersuggest"
    assert [r.domain for r in result.rows] == ["one.example"]
    assert result.rows[0].authority == 55
    assert result.removed_spam == 1


def test_tab_file():
    assert [r.spam_score for r in clean("tabs").rows] == [3]


def test_excel_sep_line_sets_the_delimiter_and_is_not_a_header():
    result = clean("excel_sep_line")
    assert result.headers == ["URL", "Spam"]
    assert result.total == 1


def test_utf16_export():
    assert clean("utf16").rows[0].url == "https://one.example/é"


def test_quoted_commas_and_newlines_stay_in_their_cell():
    result = clean("quoted_fields")
    assert result.total == 1
    assert result.rows[0].url == "https://one.example/a,b"


def test_blank_rows_are_not_counted():
    assert clean("crlf").total == 1
    assert clean("only_delimiters_row").total == 1


def test_short_row_without_a_spam_cell_counts_as_unknown():
    assert clean("short_rows").rows[0].spam_score is None


# ---- required columns and clear errors ---------------------------------------------

def test_missing_spam_column_lists_the_headers():
    with pytest.raises(CleanerError) as err:
        clean("missing_spam")
    assert err.value.code == "missing_columns"
    assert err.value.missing == ["spam_score"]
    assert "spam score" in str(err.value)
    assert "Source URL, Authority Score" in str(err.value)


def test_missing_url_column_lists_the_headers():
    with pytest.raises(CleanerError) as err:
        clean("missing_url")
    assert err.value.missing == ["backlink_url"]
    assert "Authority Score, Spam Score" in str(err.value)


def test_missing_both_columns():
    with pytest.raises(CleanerError) as err:
        clean("missing_both")
    assert err.value.missing == ["backlink_url", "spam_score"]
    assert "Foo, Bar" in str(err.value)


@pytest.mark.parametrize("name", ["empty", "only_bom"])
def test_empty_file(name):
    with pytest.raises(CleanerError) as err:
        clean(name)
    assert err.value.code == "empty"


def test_header_only_file():
    with pytest.raises(CleanerError) as err:
        clean("header_only")
    assert err.value.code == "no_rows"


@pytest.mark.parametrize("alias", ["source url", "source page url", "url from", "referring page url", "referring url", "page url", "url", "source"])
def test_every_url_alias(alias):
    assert clean_csv(f"{alias.title()},Spam\nhttps://one.example/a,1\n".encode()).kept == 1


@pytest.mark.parametrize("alias", ["spam score", "toxic score", "spam", "ts"])
def test_every_spam_alias(alias):
    assert clean_csv(f"URL,{alias.upper()}\nhttps://one.example/a,99\n".encode()).removed == 1


@pytest.mark.parametrize("alias", ["domain authority", "domain rating", "authority score", "da", "dr", "as", "domain score"])
def test_every_authority_alias(alias):
    assert clean_csv(f"URL,Spam,{alias}\nhttps://one.example/a,1,40\n".encode()).rows[0].authority == 40


@pytest.mark.parametrize("alias", ["page authority", "page ascore", "pa", "page score", "url rating", "ur"])
def test_every_page_authority_alias(alias):
    row = clean_csv(f"URL,Spam,DA,{alias}\nhttps://one.example/a,1,40,22\n".encode()).rows[0]
    assert (row.authority, row.page_authority) == (40, 22)


def test_a_file_with_no_page_authority_leaves_it_empty():
    assert clean_csv(b"URL,Spam,DA\nhttps://one.example/a,1,40\n").rows[0].page_authority is None


def test_file_size_and_type():
    check_upload("links.csv", UPLOAD_MAX_BYTES)
    with pytest.raises(CleanerError) as err:
        check_upload("links.csv", UPLOAD_MAX_BYTES + 1)
    assert err.value.code == "too_large"
    with pytest.raises(CleanerError) as err:
        check_upload("links.xlsx", 10)
    assert err.value.code == "not_csv"


# ---- spam score ---------------------------------------------------------------------

def test_blank_spam_score_is_kept_as_unknown_not_zero():
    result = clean("blank_spam")
    assert result.kept == 2
    assert result.rows[0].spam_score is None
    assert result.rows[1].spam_score == 5
    assert result.unknown_spam == 1


def test_unreadable_spam_score_is_kept_as_unknown_not_zero():
    result = clean("unreadable_spam")
    assert [r.spam_score for r in result.rows] == [None, None]
    assert result.unknown_spam == 2


def test_a_real_zero_stays_zero():
    assert clean_csv(b"URL,Spam\nhttps://one.example/a,0\n").rows[0].spam_score == 0


def test_threshold_keeps_30_and_removes_above():
    result = clean("exactly_30")
    assert [r.domain for r in result.rows] == ["one.example"]
    assert result.removed_spam == 1


def test_decimal_comma_is_read_as_a_number():
    # The old parser read 45,5 as unreadable, so it became 0 and passed as clean.
    result = clean("decimal_comma_spam")
    assert [r.domain for r in result.rows] == ["two.example"]
    assert result.rows[0].spam_score == 12.5
    assert result.removed_spam == 1


def test_percent_sign():
    result = clean("percent_spam")
    assert [r.spam_score for r in result.rows] == [12]
    assert result.removed_spam == 1


# ---- URLs and root domains -----------------------------------------------------------

def test_rows_with_no_usable_url_are_removed():
    result = clean("no_usable_url")
    assert result.total == 5
    assert result.kept == 1
    assert result.removed == 4
    assert result.removed_no_url == 4


def test_address_without_a_scheme_is_completed():
    assert [r.url for r in clean("no_scheme").rows] == ["https://blog.one.example/a", "https://cdn.two.example/b"]


@pytest.mark.parametrize("value, expected", [
    ("https://blog.example.co.uk/post", "example.co.uk"),
    ("blog.example.co.uk", "example.co.uk"),
    ("example.co.uk", "example.co.uk"),
    ("shop.example.com", "example.com"),
    ("example.com", "example.com"),
    ("www.example.com", "example.com"),
    ("EXAMPLE.COM/Path", "example.com"),
    ("https://a.b.c.example.com.au/x?y=1#z", "example.com.au"),
    ("http://example.org:8080/x", "example.org"),
    ("example.org:8080", "example.org"),
    ("https://user:pw@example.net/x", "example.net"),
    ("//cdn.example.org/x", "example.org"),
    ("example.com.", "example.com"),
    ("blog.site.com.ae", "site.com.ae"),
    ("shop.example.co.ae", "example.co.ae"),
    ("service-public.gouv.fr", "service-public.gouv.fr"),
    ("www.impots.gouv.fr/page", "impots.gouv.fr"),
    # Shared platforms: the subdomain is someone's own site (F105), and a suffix that is a website is one too.
    ("https://spammy-site.blogspot.com/p", "spammy-site.blogspot.com"),
    ("blogspot.com", "blogspot.com"),
    ("a.b.blogspot.co.uk", "b.blogspot.co.uk"),
    ("me.github.io/x", "me.github.io"),
    ("monblog.over-blog.com", "monblog.over-blog.com"),
    ("www.gov.uk/x", "gov.uk"),
    ("exämple.fr", "exämple.fr"),
    ("مثال.ae", "مثال.ae"),
    ("", ""),
    ("   ", ""),
    ("n/a", ""),
    ("-", ""),
    ("not a link", ""),
    ("localhost", ""),
    ("localhost:3000/x", ""),
    ("192.168.1.10/page", ""),
    ("mailto:someone@example.com", ""),
    ("javascript:alert(1)", ""),
    ("ftp://example.com/file", ""),
    ("co.uk", ""),
    ("com.ae", ""),
    (".example.com", ""),
    ("example..com", ""),
])
def test_root_domain(value, expected):
    assert root_domain(value) == expected


# ---- duplicates: checked, never recorded ----------------------------------------------

def test_same_domain_twice_in_a_file():
    result = clean("same_domain_twice")
    assert [r.duplicate_of for r in result.rows] == [None, "file", None]
    assert result.duplicates == 1


def test_duplicates_say_where_the_domain_already_is():
    known = {"one.example": "consideration", "two.example": "done"}
    result = clean("same_domain_twice", known=known)
    assert [r.duplicate_of for r in result.rows] == ["consideration", "consideration", "done"]
    assert result.duplicates == 3


def test_uploading_the_same_file_twice_flags_nothing_new():
    # The old tool recorded domains during upload, so a second upload flagged every row.
    first = clean("semrush_comma")
    second = clean("semrush_comma")
    assert first.duplicates == 0
    assert second.duplicates == 0


def test_filtering_records_nothing():
    known = {"other.example": "done"}
    clean("semrush_comma", known=known)
    assert known == {"other.example": "done"}


# ---- authority: labelled with its source -----------------------------------------------

def test_authority_label_names_the_source():
    assert clean("semrush_comma").authority_label == "Authority Score (SEMrush)"
    assert clean("ubersuggest_semicolon").authority_label == "Domain Authority (Ubersuggest)"
    assert clean("authority_values").authority_label == "DR (CSV)"
    assert clean("no_authority_column").authority_label is None


def test_authority_values():
    assert [r.authority for r in clean("authority_values").rows] == [68, None, None]


# ---- the browser copy must behave the same ------------------------------------------------

NODE = shutil.which("node")
needs_node = pytest.mark.skipif(not NODE, reason="node is not installed")


def run_browser_copy(tmp_path, data=None, known=None, command="clean"):
    path = tmp_path / "input.csv"
    path.write_bytes(data or b"")
    out = subprocess.run(
        [NODE, str(ROOT / "tests" / "js" / "clean_csv.cjs"), command, str(path), json.dumps(known or {})],
        capture_output=True, text=True, check=True, timeout=30,
    )
    return json.loads(out.stdout)


@needs_node
@pytest.mark.parametrize("name", sorted(CASES))
def test_browser_copy_gives_the_same_result(tmp_path, name):
    known = {"one.example": "done", "alpha.example": "found"}
    browser = run_browser_copy(tmp_path, CASES[name], known)
    try:
        python = asdict(clean_csv(CASES[name], known=known))
    except CleanerError as err:
        python = {"error": {"code": err.code, "missing": err.missing, "headers": err.headers, "message": str(err)}}
    assert browser == python


@needs_node
def test_browser_copy_has_the_same_suffix_list(tmp_path):
    assert sorted(run_browser_copy(tmp_path, command="suffixes")) == sorted(MULTI_SUFFIXES)


@needs_node
def test_browser_copy_gives_the_same_root_domains(tmp_path):
    params = [mark.args[1] for mark in test_root_domain.pytestmark if mark.name == "parametrize"][0]
    values = [v for v, _ in params]
    path = tmp_path / "values.json"
    path.write_text(json.dumps(values), encoding="utf-8")
    out = subprocess.run([NODE, str(ROOT / "tests" / "js" / "clean_csv.cjs"), "domains", str(path)], capture_output=True, text=True, check=True, timeout=30)
    assert json.loads(out.stdout) == [e for _, e in params]
