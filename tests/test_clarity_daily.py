"""Clarity collection: at most one pass per site per UTC day, or quota runs out.

Clarity allows 10 requests per project per day and a pass costs 7. harvest.py's
--only-missing guards the "logical day" (now minus 12 h), so a morning and an
afternoon run can be two logical days inside one UTC day: 14 requests. These tests
pin the wrapper that prevents that.
"""
import json
import stat
import sys
import textwrap
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from scripts import clarity_daily as cd

FAKE_HARVEST = """\
import json, os, sys, time
from pathlib import Path
root = Path(__file__).parent
args = sys.argv[1:]
slug = args[args.index("--site") + 1]
(root / "calls.log").open("a").write(" ".join(args) + "\\n")
mode = json.loads((root / "modes.json").read_text()).get(slug, "ok")
if mode == "crash":
    sys.exit(1)
if mode == "skip":
    print("already archived")
    sys.exit(0)
out = root / "data" / "raw" / slug / "2026-11-03"
out.mkdir(parents=True, exist_ok=True)
calls = [] if mode == "no_call" else [{"http_status": 200}]
if mode == "partial":
    calls = [{"http_status": 200}, {"http_status": 429}]
(out / f"run{time.time_ns()}__manifest.json").write_text(json.dumps({"calls": calls}))
sys.exit(1 if mode in ("partial", "no_call") else 0)
"""


@pytest.fixture
def setup(tmp_path):
    clarity = tmp_path / "clarity"
    (clarity / "config").mkdir(parents=True)
    (clarity / "config" / "sites.generated.toml").write_text(
        textwrap.dedent(
            """\
            [[site]]
            slug = "one"
            active = true
            [[site]]
            slug = "two"
            active = true
            [[site]]
            slug = "off"
            active = false
            """
        )
    )
    (clarity / "harvest.py").write_text(FAKE_HARVEST)
    (clarity / "modes.json").write_text("{}")
    var = tmp_path / "var"

    class Env:
        pass

    env = Env()
    env.clarity, env.var = clarity, var
    env.python = sys.executable
    env.set_modes = lambda **modes: (clarity / "modes.json").write_text(json.dumps(modes))

    def calls():
        path = clarity / "calls.log"
        return path.read_text().splitlines() if path.exists() else []

    env.calls = calls
    env.run = lambda now: cd.run_all(now=now, clarity_dir=clarity, var_dir=var, python=sys.executable)
    return env


NOON = datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc)


def test_runs_only_active_sites_with_only_missing(setup):
    outcomes = setup.run(NOON)
    assert outcomes == {"one": "harvested", "two": "harvested"}
    assert setup.calls() == ["--site one --only-missing", "--site two --only-missing"]


def test_second_run_the_same_utc_day_spends_nothing(setup):
    setup.run(NOON)
    outcomes = setup.run(NOON + timedelta(hours=5))
    assert outcomes == {"one": "already_today", "two": "already_today"}
    assert len(setup.calls()) == 2


def test_runs_again_the_next_utc_day(setup):
    setup.run(NOON)
    outcomes = setup.run(NOON + timedelta(hours=20))  # 08:00 UTC next day
    assert outcomes == {"one": "harvested", "two": "harvested"}


def test_waits_for_six_utc_if_the_last_run_is_recent(setup):
    setup.run(NOON)
    early = datetime(2026, 11, 5, 3, 0, tzinfo=timezone.utc)
    assert setup.run(early) == {"one": "too_early", "two": "too_early"}


def test_does_not_wait_when_the_last_run_is_over_30_hours_old(setup):
    # The API only reaches back 72 h, so a long gap outranks a tidy schedule.
    setup.run(NOON)
    early = datetime(2026, 11, 6, 3, 0, tzinfo=timezone.utc)
    assert setup.run(early) == {"one": "harvested", "two": "harvested"}


def test_first_ever_run_goes_immediately_even_before_six(setup):
    early = datetime(2026, 11, 4, 2, 0, tzinfo=timezone.utc)
    assert setup.run(early) == {"one": "harvested", "two": "harvested"}


def test_harvester_that_never_reached_the_api_leaves_no_stamp(setup):
    # Nothing was charged, so the next hourly run must try again.
    setup.set_modes(one="crash", two="no_call")
    assert setup.run(NOON) == {"one": "no_quota_spent", "two": "no_quota_spent"}
    setup.set_modes()
    assert setup.run(NOON + timedelta(hours=1)) == {"one": "harvested", "two": "harvested"}


def test_partial_run_still_stamps_because_quota_was_spent(setup):
    setup.set_modes(one="partial")
    assert setup.run(NOON)["one"] == "harvested"
    assert setup.run(NOON + timedelta(hours=1))["one"] == "already_today"


def test_harvester_skipping_a_captured_logical_day_leaves_no_stamp(setup):
    setup.set_modes(one="skip")
    assert setup.run(NOON)["one"] == "no_quota_spent"


def test_one_site_failing_does_not_block_the_other(setup):
    setup.set_modes(one="crash")
    assert setup.run(NOON) == {"one": "no_quota_spent", "two": "harvested"}


def test_manifest_from_an_earlier_run_is_not_counted(setup):
    old = setup.clarity / "data" / "raw" / "one" / "2026-11-01"
    old.mkdir(parents=True)
    (old / "older__manifest.json").write_text(json.dumps({"calls": [{"http_status": 200}]}))
    setup.set_modes(one="crash")
    assert setup.run(NOON)["one"] == "no_quota_spent"


def test_second_copy_exits_without_running(setup):
    with cd.lock(setup.var) as held:
        assert held
        assert setup.run(NOON) == {"_": "busy"}
    assert setup.calls() == []


def test_stamp_files_are_not_readable_by_others(setup):
    setup.run(NOON)
    stamp = next(Path(setup.var / "clarity").glob("one*.json"))
    assert not stat.S_IMODE(stamp.stat().st_mode) & 0o077


def test_missing_config_reports_rather_than_silently_collecting_nothing(setup):
    (setup.clarity / "config" / "sites.generated.toml").unlink()
    with pytest.raises(cd.NoSites):
        setup.run(NOON)
