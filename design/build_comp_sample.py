"""Make the sample data the screens use when opened as a plain file: real API answers, on the demo world.

  DB_NAME_TEST=seo_cc_snap_test .venv/bin/python design/build_comp_sample.py

Writes design/mockups/comp-sample-data.js. Empties that test database first. Run it again whenever an API answer changes.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from seo.core.db import make_engine  # noqa: E402
from seo.web import create_app  # noqa: E402
from tests.ui import demo_world  # noqa: E402
from tests.ui.app_server import reset  # noqa: E402


def main() -> None:
    engine = make_engine(test=True)
    reset(engine)
    world = demo_world.build(engine, ROOT / "var" / f"locks-{engine.url.database}")
    client = create_app(engine=engine, url_allowed=lambda url: True, auth=False).test_client()
    answers: dict[str, object] = {}

    def take(path: str):
        reply = client.get(f"/api/{path}")
        assert reply.status_code == 200, (path, reply.status_code, reply.get_data(as_text=True)[:300])
        answers[path] = reply.get_json()
        return answers[path]

    take("links/sites")
    take("health/sites")
    take("alerts")
    take("notes")
    take("uptime/sites")
    take("mediators")
    take("backlinks/summary")
    for part in ("rivals", "keywords", "moves", "links"):
        take(f"collective/{part}")
    for site_id in world["sites"].values():
        for part in ("rivals", "keywords", "moves", "links"):
            take(f"collective/{part}?site_id={site_id}")
        for path in ("competitors", "competitors/suggestions", "page-pairs", "link-gaps", "ai-watch", "prospects", "keyword-check"):
            take(f"{path}?site_id={site_id}")
        take(f"sites/{site_id}/pages")
        take(f"backlinks/summary?site_id={site_id}")
        for audit in take(f"health/sites/{site_id}/audits")["audits"]:
            take(f"health/audits/{audit['id']}")
        for competitor in answers[f"competitors?site_id={site_id}"]["competitors"]:
            take(f"competitors/{competitor['id']}/profile?site_id={site_id}")
            take(f"sites/{competitor['id']}/pages")
            take(f"notes?competitor_id={competitor['id']}")
        for pair in answers[f"page-pairs?site_id={site_id}"]["pairs"]:
            take(f"page-pairs/{pair['id']}")
            for side in ("my_url", "their_url"):
                from urllib.parse import quote

                take(f"notes?page_url={quote(pair[side], safe='')}")
    for scope in ("all", "competitor", "page"):
        take(f"notes?scope={scope}")
    out = {"empty_site_id": world["sites"][demo_world.EMPTY], "sites": world["sites"], "get": answers}
    path = ROOT / "design" / "mockups" / "comp-sample-data.js"
    path.write_text("// Made by design/build_comp_sample.py: real API answers on the demo world. Sample data, not measurement.\nwindow.COMP_SAMPLE = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"{len(answers)} answers, {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
