"""Upgrade an old backup into a NEW file, without opening the shop's live database."""

import argparse
import os
import secrets
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source", required=True, type=Path)
parser.add_argument("--output", required=True, type=Path)
args = parser.parse_args()
source = args.source.resolve(strict=True)
output = args.output.resolve()
if source == output or output.exists():
    parser.error("Output must be a new file, different from the source.")
output.parent.mkdir(parents=True, exist_ok=True)
with open(output, "xb"):
    pass
with (
    closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as src,
    closing(sqlite3.connect(str(output))) as dst,
):
    src.backup(dst)
    if dst.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise RuntimeError("Source failed integrity checks. No live database was changed.")
os.environ["DATABASE_URL"] = "sqlite:///" + output.as_posix()
os.environ["FLASK_ENV"] = "development"
os.environ["SECRET_KEY"] = secrets.token_hex(32)
os.environ["TRUST_PROXY"] = "0"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as billing

with billing.app.app_context():
    billing.ensure_schema()
    billing.db.session.remove()
    billing.db.engine.dispose()
with closing(sqlite3.connect(str(output))) as con:
    if (
        con.execute("PRAGMA integrity_check").fetchone()[0] != "ok"
        or con.execute("PRAGMA foreign_key_check").fetchone()
    ):
        raise RuntimeError("Upgraded copy failed verification. Do not restore this copy.")
print(f"Upgraded and checked a separate copy: {output}. Source was not modified.")
