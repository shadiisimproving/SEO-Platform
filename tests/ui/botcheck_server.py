"""tests/ui/app_server.py, plus a DuckDuckGo direct that always gets a bot check and a Bright Data that works on DuckDuckGo.

  DB_NAME_TEST=test_botcheck_test .venv/bin/python tests/ui/botcheck_server.py --port 8247   (flow_refresh_bot_check)

Every other option is app_server.py's. Made-up sites only; nothing leaves the machine.
"""
import runpy
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))
from seo.serp import connections  # noqa: E402
from seo.serp.tools import DuckDuckGoDirect, ToolStopped  # noqa: E402
from tests.ui import demo_world  # noqa: E402


class BlockedDDG:
    name, engines, free_monthly = "DuckDuckGo direct", ("duckduckgo",), None

    def search(self, *args):
        raise ToolStopped(DuckDuckGoDirect.BOT_CHECK, bot_check=True)


class OtherDDG(demo_world.DemoTool):
    name, engines, free_monthly, gives_ai = "Bright Data", ("google", "duckduckgo"), 5000, False

    def search(self, *args):
        time.sleep(0.8)  # slow enough to read the tray while it runs
        return super().search(*args)


real_install = demo_world.install


def install(websites, tool=None, delay=0.0):
    tool = real_install(websites, tool, delay)
    ddg, other = BlockedDDG(), OtherDDG()
    connections.tool_factory = lambda engine, name: [tool] if name == "google" else [ddg, other] if name == "duckduckgo" else []
    return tool


demo_world.install = install
sys.argv = ["app_server.py", *sys.argv[1:]]
runpy.run_path(str(ROOT / "tests" / "ui" / "app_server.py"), run_name="__main__")
