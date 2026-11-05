"""What Passenger starts on o2switch. Login is on, and the live site is always https, so cookies are always Secure."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
os.environ["SEO_HTTPS"] = "1"

from seo.web import create_app  # noqa: E402

application = create_app(screens_dir=ROOT / "design" / "mockups")
