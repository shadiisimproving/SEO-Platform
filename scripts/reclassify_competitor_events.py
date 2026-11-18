"""Hide stored competitor events that the noise rules say nobody made (seo.competitors.reclassify). Re-runnable.

    python -m scripts.reclassify_competitor_events            dry run on DB_NAME: prints per site before -> after, changes nothing
    python -m scripts.reclassify_competitor_events --apply    the same, and keeps the changes
    python -m scripts.reclassify_competitor_events --test     on DB_NAME_TEST instead

Nothing is deleted: an event is marked hidden with its reason, and can be shown again with UPDATE ... SET hidden = 0.
"""
from __future__ import annotations

import sys
import time

from seo.competitors import reclassify
from seo.core.db import make_engine


def main(argv: list[str]) -> int:
    engine = make_engine(test="--test" in argv)
    apply = "--apply" in argv
    started = time.monotonic()
    before, report, after = reclassify.run(engine, apply=apply, log=None)  # one site at a time, each its own transaction
    print(f"Database: {engine.url.database}  ({'applied' if apply else 'dry run, nothing kept'}, {time.monotonic() - started:.1f} s)")
    print(f"{'site':<28}{'edit events':>18}{'pages edited':>18}{'new pages':>16}  hidden by rule")
    for host in sorted(set(before) | set(after), key=lambda h: -before.get(h, {}).get("edit_events", 0)):
        b, a = before.get(host, {}), after.get(host, {})
        arrow = lambda k: f"{b.get(k, 0):>6} -> {a.get(k, 0):<6}"  # noqa: E731
        rules = report.get(host, {})
        extra = f" first read still open" if rules.get("first_read_open") else ""
        print(f"{host:<28}{arrow('edit_events'):>18}{arrow('edited_pages'):>18}{arrow('new_pages'):>16}  {rules.get('hidden', {})} redirects+{rules.get('redirects', 0)}{extra}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
