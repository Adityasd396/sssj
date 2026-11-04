"""Create the schema and the first admin user.

By default this refuses to touch a database that already has data — pass
--force to rebuild from scratch (which DESTROYS every bill, client and
product in it).

    python init_db.py            # safe: create if empty, else stop
    python init_db.py --force    # wipe and recreate
"""

import getpass
import os
import sys

from sqlalchemy import inspect

from app import Settings, User, app, db

FORCE = "--force" in sys.argv


def _has_data() -> bool:
    insp = inspect(db.engine)
    return (
        insp.has_table("invoice")
        and db.session.query(db.func.count())
        .select_from(db.Table("invoice", db.MetaData(), autoload_with=db.engine))
        .scalar()
        > 0
    )


with app.app_context():
    if FORCE:
        db.drop_all()
    elif _has_data():
        sys.exit(
            "Database already has invoices — refusing to wipe it. "
            "Pass --force if you really want to rebuild (DESTROYS DATA)."
        )

    db.create_all()

    if not User.query.first():
        admin = User(username="admin", email="admin@example.com", is_admin=True)
        password = os.environ.get("INITIAL_ADMIN_PASSWORD") or getpass.getpass(
            "Choose the owner password (at least 12 characters): "
        )
        if len(password) < 12:
            sys.exit("Owner password must contain at least 12 characters.")
        admin.set_password(password)
        db.session.add(admin)
        print("Created owner account: admin (using your chosen password).")
    if not Settings.query.first():
        db.session.add(Settings())
    db.session.commit()
    print("OK: schema ready.")
