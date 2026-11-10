"""The upload setup for o2switch. Nothing here touches the server: the scripts run on fakes in a temp folder.

The crontab tests matter most. That account's crontab also runs the CRM, the booking app and scheduled publishing, and
piping into `crontab -` wiped it once (2026-10-15).
"""
import os
import runpy
import stat
import subprocess
import tarfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
INSTALL_CRON = ROOT / "deploy" / "install_cron.sh"
RELEASE = ROOT / "deploy" / "server_release.sh"
EXISTING = ["# CRM relances", "*/5 * * * * /home3/x/crm/run.sh", "0 3 * * * /home3/x/publish.sh", "12 4 * * * acme.sh --cron"]


def _script(path: Path, body: str) -> Path:
    path.write_text("#!/usr/bin/env bash\n" + body)
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


# ---- the live entry point -----------------------------------------------------------------------------
@pytest.fixture
def key(tmp_path, monkeypatch):
    from seo.core import crypto
    path = tmp_path / "key"
    crypto.init_key(path)
    monkeypatch.setattr(crypto, "default_key_path", lambda: path)


def test_the_live_app_has_login_on_and_secure_cookies(engine, key, monkeypatch):
    monkeypatch.setenv("SEO_HTTPS", "0")  # a stray setting can't turn this off, and the test leaves the setting as it found it
    monkeypatch.setenv("DB_NAME", engine.url.database)
    application = runpy.run_path(str(ROOT / "passenger_wsgi.py"))["application"]
    assert application.config["AUTH_ON"] is True
    assert application.config["SESSION_COOKIE_SECURE"] is True
    client = application.test_client()
    assert client.get("/").status_code == 302
    assert client.get("/api/sites").status_code == 401
    assert client.get("/login").status_code == 200


def _path_seen(environ):
    from seo.web.paths import decoded_paths

    seen = {}
    decoded_paths(lambda env, start: seen.setdefault("path", env["PATH_INFO"]))(environ, None)
    return seen["path"]


def test_a_path_passenger_left_encoded_is_decoded_once():
    # As o2switch's Passenger sends it: still escaped, exactly as the browser wrote it. Bright Data couldn't be saved.
    assert _path_seen({"PATH_INFO": "/api/connections/Bright%20Data", "REQUEST_URI": "/api/connections/Bright%20Data?x=1"}) == "/api/connections/Bright Data"
    assert _path_seen({"PATH_INFO": "/api/logos/caf%C3%A9.example"}) == "/api/logos/café.example".encode().decode("latin-1")
    # A server that already decoded it is left alone, so a real % is never decoded twice.
    assert _path_seen({"PATH_INFO": "/api/x/100%25 off", "REQUEST_URI": "/api/x/100%2525%20off"}) == "/api/x/100%25 off"
    assert _path_seen({"PATH_INFO": "/api/connections/HasData", "REQUEST_URI": "/api/connections/HasData"}) == "/api/connections/HasData"


def test_the_live_app_decodes_passengers_paths(engine, key, monkeypatch):
    monkeypatch.setenv("DB_NAME", engine.url.database)
    application = runpy.run_path(str(ROOT / "passenger_wsgi.py"))["application"]
    assert application.wsgi_app.__qualname__.startswith("decoded_paths")


# ---- what gets uploaded -------------------------------------------------------------------------------
def test_the_bundle_has_what_the_app_needs_and_nothing_private():
    paths = [line.strip() for line in (ROOT / "deploy" / "bundle.txt").read_text().splitlines() if line.strip() and not line.startswith("#")]
    for needed in ("passenger_wsgi.py", "seo", "migrations", "alembic.ini", "requirements.txt", "design/mockups", "templates", "scripts", "deploy"):
        assert needed in paths
    for private in (".env", "var", "tests", "reports", ".venv"):
        assert private not in paths
    for path in paths:
        assert (ROOT / path).exists(), path


def test_uploading_needs_an_explicit_go(tmp_path):
    """The owner decides when it goes live. Run with no argument, it must explain and stop before any network call."""
    fakes = tmp_path / "bin"
    fakes.mkdir()
    log = tmp_path / "called"
    for tool in ("ssh", "rsync"):
        _script(fakes / tool, f'echo {tool} >> "{log}"\nexit 0\n')
    done = subprocess.run(["bash", str(ROOT / "deploy" / "deploy.sh")], capture_output=True, text=True, cwd=ROOT, env={**os.environ, "PATH": f"{fakes}:{os.environ['PATH']}"})
    assert done.returncode != 0 and "--go" in done.stderr
    assert not log.exists()


# ---- the crontab ---------------------------------------------------------------------------------------
@pytest.fixture
def cron(tmp_path):
    """A fake crontab command holding its table in a file, on the PATH ahead of the real one."""
    table = tmp_path / "table"
    table.write_text("\n".join(EXISTING) + "\n")
    fakes = tmp_path / "bin"
    fakes.mkdir()
    _script(fakes / "crontab", f'if [ "$1" = "-l" ]; then cat "{table}"; exit 0; fi\nif [ "$1" = "-" ]; then echo "PIPED" >> "{tmp_path}/piped"; exit 0; fi\ncp "$1" "{table}"\n')

    class Cron:
        path = table
        home = tmp_path / "home"
        fake_dir = fakes

        def run(self, **extra):
            self.home.mkdir(exist_ok=True)
            env = {**os.environ, "PATH": f"{fakes}:{os.environ['PATH']}", "HOME": str(self.home), "APP_DIR": "/home/x/seo-platform", "VENV_BIN": "/home/x/venv/bin", **extra}
            return subprocess.run(["bash", str(INSTALL_CRON)], capture_output=True, text=True, env=env)

        def lines(self):
            return self.path.read_text().splitlines()

    return Cron()


def test_installing_keeps_every_other_job(cron):
    done = cron.run()
    assert done.returncode == 0, done.stderr
    lines = cron.lines()
    assert lines[: len(EXISTING)] == EXISTING
    assert any("seo.worker tick --lane crawl" in line for line in lines)
    assert any("seo.worker tick --lane refresh" in line for line in lines)
    assert any("seo.worker tick --lane collectors" in line for line in lines)
    for job in ("links-due", "collect-due", "health-due", "competitors-due", "uptime-due", "backlinks-due", "backup_db.py"):
        assert any(job in line for line in lines), job


def test_no_scheduled_job_can_spend_search_credits(cron):
    """Scraped rankings only ever start from a click. Refresh's lane runs clicked jobs, and nothing here may queue one."""
    cron.run()
    assert not any("refresh-due" in line or "serp" in line.lower() for line in cron.lines())


def test_it_takes_a_backup_first(cron):
    cron.run()
    backups = list((cron.home / "crontab-backups").glob("crontab-*.txt"))
    assert len(backups) == 1 and backups[0].read_text().splitlines() == EXISTING


def test_installing_twice_does_not_double_the_jobs(cron):
    cron.run()
    once = cron.lines()
    assert cron.run().returncode == 0
    assert cron.lines() == once


def test_a_new_install_replaces_only_its_own_jobs(cron):
    cron.run(APP_DIR="/old/place")
    assert cron.run(APP_DIR="/new/place").returncode == 0
    joined = "\n".join(cron.lines())
    assert "/old/place" not in joined and "/new/place" in joined
    assert cron.lines()[: len(EXISTING)] == EXISTING


def test_a_failed_read_never_installs_anything(cron, tmp_path):
    """An unreadable table looks like an empty one, and installing over that is how the jobs were lost."""
    _script(cron.fake_dir / "crontab", 'if [ "$1" = "-l" ]; then echo "cannot read" >&2; exit 1; fi\necho INSTALLED >> "' + str(tmp_path / "installed") + '"\n')
    done = cron.run()
    assert done.returncode != 0
    assert not (tmp_path / "installed").exists()


def test_an_empty_table_is_refused_because_this_account_is_never_empty(cron, tmp_path):
    cron.path.write_text("")
    done = cron.run()
    assert done.returncode != 0 and cron.lines() == []
    assert cron.run(ALLOW_EMPTY_CRONTAB="1").returncode == 0


def test_a_wrong_line_count_puts_the_old_table_back(cron, tmp_path):
    """The failure from 2026-10-15: the install ran and left only some of the lines."""
    calls = tmp_path / "calls"
    _script(
        cron.fake_dir / "crontab",
        f'if [ "$1" = "-l" ]; then cat "{cron.path}"; exit 0; fi\n'
        f'echo x >> "{calls}"\n'
        f'if [ "$(wc -l < "{calls}")" -eq 1 ]; then echo "only this" > "{cron.path}"; else cp "$1" "{cron.path}"; fi\n',
    )
    done = cron.run()
    assert done.returncode != 0
    assert cron.lines() == EXISTING


def test_the_script_never_pipes_into_crontab():
    source = INSTALL_CRON.read_text()
    assert "crontab -\n" not in source and "| crontab" not in source
    assert "<(" not in source, "that server's shell has no process substitution"


# ---- the release, on the server ------------------------------------------------------------------------
@pytest.fixture
def release(tmp_path):
    """Fake pip, python and alembic log what they're asked. A live app folder and a staged new version."""
    staged = tmp_path / "staging"
    live = tmp_path / "live"
    home = tmp_path / "home"
    venv = tmp_path / "venv"
    for folder in (staged / "seo", staged / "deploy", live / "seo", live / "var" / "note-files", venv, home / ".config" / "seo-command-center"):
        folder.mkdir(parents=True)
    (home / ".config" / "seo-command-center" / "key").write_text("k")
    (staged / "requirements.txt").write_text("flask\n")
    (staged / "seo" / "new.py").write_text("new\n")
    (staged / "passenger_wsgi.py").write_text("new\n")
    (staged / "REVISION").write_text("abc123\n")
    (live / "seo" / "old.py").write_text("old\n")
    (live / ".env").write_text("DB_NAME=x\n")
    (live / "var" / "note-files" / "kept.png").write_text("a customer's note\n")
    log = tmp_path / "log"

    def fake(name, fail=False):
        _script(venv / name, f'echo "{name} $*" >> "{log}"\n' + ("echo broken >&2\nexit 1\n" if fail else "exit 0\n"))

    for name in ("pip", "python", "alembic"):
        fake(name)

    class Release:
        def __init__(self):
            self.live, self.log, self.fake, self.home, self.venv = live, log, fake, home, venv

        def run(self, **extra):
            env = {**os.environ, "APP_DIR": str(live), "STAGING_DIR": str(staged), "VENV_BIN": str(venv), "HOME": str(home), **extra}
            return subprocess.run(["bash", str(RELEASE)], capture_output=True, text=True, env=env)

        def steps(self):
            return [line.split()[0:3] for line in log.read_text().splitlines()] if log.exists() else []

    return Release()


def test_a_release_installs_and_migrates_before_the_live_code_changes(release):
    done = release.run()
    assert done.returncode == 0, done.stderr
    assert (release.live / "seo" / "new.py").exists() and not (release.live / "seo" / "old.py").exists()
    assert (release.live / "tmp" / "restart.txt").exists()
    names = [step[0] for step in release.steps()]
    assert names.index("pip") < names.index("alembic")
    backup = next(i for i, step in enumerate(release.steps()) if "backup_db.py" in " ".join(step))
    assert backup < names.index("alembic"), "a copy of the database comes before any migration"


def test_a_release_leaves_the_app_folder_open_to_the_web_server(release, tmp_path):
    """The first real upload answered 500: the build folder is private, rsync copied that onto the app folder, and
    Passenger runs as another user, so it couldn't get in. It's outside the web folder, so opening it serves nothing."""
    (tmp_path / "staging").chmod(0o700)
    assert release.run().returncode == 0
    assert release.live.stat().st_mode & 0o777 == 0o755
    assert (release.live / "var").stat().st_mode & 0o077 == 0, "backups and note files stay private"


def test_a_release_keeps_uploaded_files_and_settings(release):
    assert release.run().returncode == 0
    assert (release.live / "var" / "note-files" / "kept.png").read_text() == "a customer's note\n"
    assert (release.live / ".env").read_text() == "DB_NAME=x\n"
    assert (release.live / ".env").stat().st_mode & 0o077 == 0, "the settings hold the database password"


@pytest.mark.parametrize("step", ["pip", "alembic"])
def test_a_failed_step_leaves_the_old_code_running(release, step):
    release.fake(step, fail=True)
    done = release.run()
    assert done.returncode != 0
    assert (release.live / "seo" / "old.py").exists() and not (release.live / "seo" / "new.py").exists()
    assert not (release.live / "tmp" / "restart.txt").exists()


def test_a_failed_import_check_leaves_the_old_code_running(release):
    release.fake("python", fail=True)
    assert release.run().returncode != 0
    assert (release.live / "seo" / "old.py").exists()


def test_a_release_refuses_a_server_that_is_not_set_up(release):
    (release.live / ".env").unlink()
    done = release.run()
    assert done.returncode != 0 and ".env" in done.stderr and not release.steps()
    (release.live / ".env").write_text("DB_NAME=x\n")
    (release.home / ".config" / "seo-command-center" / "key").unlink()
    done = release.run()
    assert done.returncode != 0 and "key" in done.stderr and not release.steps()


def test_the_first_release_makes_the_key_and_only_when_asked(release):
    """The key can only be made once Python's packages are in. A later release must never replace a lost key by itself:
    a new key would make every saved API key unreadable without saying so."""
    (release.home / ".config" / "seo-command-center" / "key").unlink()
    assert release.run().returncode != 0 and not release.steps()
    assert release.run(FIRST_TIME="1").returncode == 0
    steps = [" ".join(step) for step in release.steps()]
    make_key = next(i for i, step in enumerate(steps) if "seo.core.crypto" in step)
    assert next(i for i, step in enumerate(steps) if step.startswith("pip")) < make_key


def test_a_later_release_does_not_touch_the_key(release):
    assert release.run(FIRST_TIME="1").returncode == 0
    assert not any("seo.core.crypto" in " ".join(step) for step in release.steps()), "a key is already there"


# ---- going back to an older release -------------------------------------------------------------------
def test_going_back_switches_the_code_without_migrating(release):
    """The older code has no file for the newest migration, so Alembic would stop and the broken version stay live."""
    done = release.run(ROLLBACK="1")
    assert done.returncode == 0, done.stderr
    assert (release.live / "seo" / "new.py").exists() and not (release.live / "seo" / "old.py").exists()
    assert (release.live / "tmp" / "restart.txt").exists()
    steps = [" ".join(step) for step in release.steps()]
    assert not any(step.startswith("alembic") for step in steps)
    backup = next(i for i, step in enumerate(steps) if "backup_db.py" in step)
    check = steps.index("python -m seo.core.schema")
    assert backup < check, "a copy of the database comes first"
    assert "no database changes ran" in done.stdout


def test_going_back_stops_when_the_older_code_cannot_use_the_database(release, tmp_path):
    """A migration marked breaking: the older code refuses, and nothing is switched."""
    _script(release.venv / "python", f'echo "python $*" >> "{release.log}"\nif [ "$2" = "seo.core.schema" ]; then echo "marked breaking" >&2; exit 1; fi\n')
    done = release.run(ROLLBACK="1")
    assert done.returncode != 0 and "Not switched" in done.stderr
    assert (release.live / "seo" / "old.py").exists() and not (release.live / "seo" / "new.py").exists()
    assert not (release.live / "tmp" / "restart.txt").exists()


def test_a_normal_release_still_migrates_and_skips_the_going_back_check(release):
    assert release.run().returncode == 0
    steps = [" ".join(step) for step in release.steps()]
    assert any(step.startswith("alembic upgrade") for step in steps)
    assert "python -m seo.core.schema" not in steps


@pytest.mark.parametrize("args", [["--rollback"], ["--rollback", "no-such-commit-here"]])
def test_going_back_needs_a_real_commit_and_stops_before_any_network(tmp_path, args):
    fakes = tmp_path / "bin"
    fakes.mkdir()
    log = tmp_path / "called"
    for tool in ("ssh", "rsync"):
        _script(fakes / tool, f'echo {tool} >> "{log}"\nexit 0\n')
    done = subprocess.run(["bash", str(ROOT / "deploy" / "deploy.sh"), *args], capture_output=True, text=True, cwd=ROOT, env={**os.environ, "PATH": f"{fakes}:{os.environ['PATH']}"})
    assert done.returncode == 2 and "commit" in done.stderr
    assert not log.exists()


# ---- the copy on the Mac ------------------------------------------------------------------------------
def test_pulling_backups_only_reads_from_the_server_and_checks_each_file(tmp_path):
    """Fakes for ssh and rsync, and a host name that can't exist (.invalid), so nothing here can reach a server."""
    import gzip

    served = tmp_path / "served"
    (served / "database").mkdir(parents=True)
    with gzip.open(served / "database" / "seo-20261110-022000.sql.gz", "wb") as out:
        out.write(b"-- dump\n-- Dump completed on 2026-11-10\n")
    (served / "database" / "seo-20261109-022000.sql.gz").write_bytes(b"\x1f\x8b cut off")
    fakes = tmp_path / "bin"
    fakes.mkdir()
    log = tmp_path / "rsync-args"
    _script(fakes / "ssh", f'echo "ssh $*" >> "{tmp_path}/ssh-called"\nexit 1\n')
    _script(fakes / "rsync", f'echo "$@" > "{log}"\nfor dest; do :; done\ncp -R "{served}/." "$dest"\n'
            'echo ">f+++++++ database/seo-20261110-022000.sql.gz"\necho ">f+++++++ database/seo-20261109-022000.sql.gz"\n')
    key, hosts, settings = tmp_path / "key", tmp_path / "known_hosts", tmp_path / "settings.env"
    key.write_text("fake")
    hosts.write_text("server.invalid ssh-ed25519 AAAA\n")
    settings.write_text(f"SSH_USER=someone\nSSH_HOST=server.invalid\nSSH_KEY={key}\nKNOWN_HOSTS_FILE={hosts}\n")
    dest = tmp_path / "copies"
    env = {**os.environ, "PATH": f"{fakes}:{os.environ['PATH']}", "DEPLOY_SETTINGS": str(settings), "BACKUP_COPY_DIR": str(dest)}
    done = subprocess.run(["bash", str(ROOT / "scripts" / "pull_backups.sh")], capture_output=True, text=True, env=env)
    args = log.read_text()
    assert "--delete" not in args and "someone@server.invalid:seo-platform/var/backups/" in args
    assert done.returncode == 1 and "seo-20261109-022000.sql.gz" in done.stderr, "the cut-off copy is named"
    assert "seo-20261110-022000.sql.gz" not in done.stderr and "Newest database copy" in done.stdout
    assert dest.stat().st_mode & 0o077 == 0 and (dest / "database" / "seo-20261110-022000.sql.gz").stat().st_mode & 0o077 == 0


# ---- files uploaded to notes --------------------------------------------------------------------------
def test_note_files_are_backed_up_and_old_copies_dropped(tmp_path, monkeypatch):
    from scripts import backup_db

    notes = tmp_path / "note-files"
    (notes / "a").mkdir(parents=True)
    (notes / "a" / "photo.png").write_bytes(b"picture")
    monkeypatch.setenv("SEO_NOTE_FILES", str(notes))
    folder = tmp_path / "backups"
    folder.mkdir()
    for number in range(1, 10):  # 1 to 9 January
        (folder / f"note-files-2026010{number}-000000.tar.gz").write_bytes(b"old")
    saved = backup_db.run_note_files(folder)
    with tarfile.open(saved) as archive:
        assert any(name.endswith("a/photo.png") for name in archive.getnames())
    assert saved.stat().st_mode & 0o077 == 0
    # Kept by age: the newest of 7 days (today and 9 to 4 January), and nothing older within the same week or month
    assert len(list(folder.glob("note-files-*.tar.gz"))) == 7 and saved.exists()
    assert not (folder / "note-files-20260103-000000.tar.gz").exists()


def test_a_note_files_copy_that_does_not_read_back_is_removed(tmp_path, monkeypatch):
    from scripts import backup_db

    notes = tmp_path / "note-files"
    notes.mkdir()
    (notes / "photo.png").write_bytes(b"picture")
    monkeypatch.setenv("SEO_NOTE_FILES", str(notes))
    real_check = backup_db.verify_archive
    monkeypatch.setattr(backup_db, "verify_archive", lambda path, expected: real_check(path, expected + 1))  # one file short
    with pytest.raises(SystemExit) as err:
        backup_db.run_note_files(tmp_path / "backups")
    assert "removed" in str(err.value)
    assert list((tmp_path / "backups").iterdir()) == []


def test_a_note_files_copy_that_is_not_an_archive_does_not_pass(tmp_path):
    from scripts import backup_db

    broken = tmp_path / "broken.tar.gz"
    broken.write_bytes(b"not a tar")
    with pytest.raises(SystemExit):
        backup_db.verify_archive(broken, 1)


def test_no_note_files_yet_is_not_a_problem(tmp_path, monkeypatch):
    from scripts import backup_db

    monkeypatch.setenv("SEO_NOTE_FILES", str(tmp_path / "nothing-here"))
    assert backup_db.run_note_files(tmp_path / "backups") is None


def test_bright_data_can_be_saved_when_the_path_arrives_encoded(engine, key):
    import json

    from werkzeug.test import EnvironBuilder, run_wsgi_app

    from seo.web import create_app
    from seo.web.paths import decoded_paths

    app = create_app(engine=engine, auth=False)
    environ = EnvironBuilder(method="PUT", path="/api/connections/x", json={"key": "k-1234", "zone": ""}).get_environ()
    environ["PATH_INFO"] = environ["REQUEST_URI"] = "/api/connections/Bright%20Data"
    body, status, _ = run_wsgi_app(decoded_paths(app.wsgi_app), environ)
    answer = json.loads(b"".join(body))
    assert status.startswith("400") and "zone" in answer["error"], answer  # Bright Data's own answer, not "doesn't take a key"
