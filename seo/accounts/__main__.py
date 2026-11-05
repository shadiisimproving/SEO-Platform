"""The first admin can't be made from a screen, because there is no sign-up page.

    python -m seo.accounts create-admin --username you --name "Your name"
"""
from __future__ import annotations

import argparse
import sys

from seo.accounts import service
from seo.core.db import make_engine
from seo.core.errors import Refused


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="seo.accounts")
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("create-admin", help="make an admin account and print its temporary password once")
    make.add_argument("--username", "--email", dest="email", required=True, help="a username or an email")
    make.add_argument("--name", required=True)
    args = parser.parse_args(argv)
    try:
        user, password = service.create_user(make_engine(), args.email, args.name, "admin")
    except Refused as exc:
        print(exc, file=sys.stderr)
        return 1
    print(f"Created {user['email']}. Temporary password, shown once: {password}\nYou'll be asked to change it at first login.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
