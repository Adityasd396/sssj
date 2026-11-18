"""SQLite online snapshots and staged, validated recovery, behind maintenance gate."""

import io
import re
import secrets
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path

from flask import flash, redirect, request, send_file, session, url_for
from sqlalchemy import inspect


def install(app, db, User, admin_required, ensure_schema, now):
    def live_path():
        if db.engine.dialect.name != "sqlite" or db.engine.url.database == ":memory:":
            raise ValueError(
                "This action supports file-backed SQLite only. Use pg_dump/pg_restore for PostgreSQL."
            )
        return Path(db.engine.url.database)

    def snapshot(source, destination):
        with (
            closing(sqlite3.connect(str(source), timeout=10)) as src,
            closing(sqlite3.connect(str(destination), timeout=10)) as dst,
        ):
            src.backup(dst)
            if dst.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("Database integrity check failed.")

    def backup_path(prefix="snapshot"):
        folder = Path(app.instance_path) / "backups"
        folder.mkdir(parents=True, exist_ok=True)
        return folder / (
            prefix + "-" + now().strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(6) + ".db"
        )

    def response(data, name):
        return send_file(
            io.BytesIO(data),
            as_attachment=True,
            download_name=name,
            mimetype="application/octet-stream",
            max_age=0,
        )

    def prune_snapshots(folder):
        # Recovery and legacy billing-* copies are excluded from retention.
        files = [
            p
            for p in folder.iterdir()
            if p.is_file()
            and not p.is_symlink()
            and re.fullmatch(r"snapshot-\d{8}-\d{6}-[0-9a-f]{12}\.db", p.name)
        ]
        for path in sorted(files, key=lambda p: (p.stat().st_mtime_ns, p.name), reverse=True)[5:]:
            path.unlink(missing_ok=True)

    @admin_required
    def download():
        if request.method == "HEAD":
            return response(b"", "billing-backup.db")
        try:
            db.session.remove()
            # Ordinary downloads leave no retained database copies on disk.
            with tempfile.TemporaryDirectory(prefix="billing-download-") as folder:
                path = Path(folder) / "billing-backup.db"
                snapshot(live_path(), path)
                return response(path.read_bytes(), path.name)
        except Exception:
            app.logger.exception("Backup failed")
            flash("Backup failed. The live database was not changed.", "danger")
            return redirect(url_for("settings"))

    @admin_required
    def create():
        if request.method != "POST":
            return redirect(url_for("settings") + "#backup")
        try:
            path = backup_path()
            db.session.remove()
            snapshot(live_path(), path)
            data = path.read_bytes()
            prune_snapshots(path.parent)
            return response(data, path.name)
        except Exception:
            app.logger.exception("Retained backup failed")
            flash("Backup could not be created. The live database was not changed.", "danger")
            return redirect(url_for("settings"))

    @admin_required
    def restore():
        old = None
        changed = False
        try:
            user = db.session.get(User, session["user_id"])
            if not user.check_password(request.form.get("password", "")):
                raise ValueError("Confirm your current password to restore a backup.")
            file = request.files.get("backup_file")
            if not file or not file.filename.lower().endswith(".db"):
                raise ValueError("Choose a billing .db backup.")
            live = live_path()
            required = {
                name: {c["name"] for c in inspect(db.engine).get_columns(name)}
                for name in inspect(db.engine).get_table_names()
            }
            db.session.remove()
            with tempfile.TemporaryDirectory(
                prefix="billing-restore-", dir=app.instance_path
            ) as folder:
                staged = Path(folder) / "staged.db"
                file.save(staged)
                with closing(sqlite3.connect(str(staged))) as con:
                    if con.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                        raise ValueError("The uploaded database failed its integrity check.")
                    tables = {
                        r[0]
                        for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")
                    }
                    for name, columns in required.items():
                        if name not in tables or not columns <= {
                            r[1] for r in con.execute('PRAGMA table_info("' + name + '")')
                        }:
                            raise ValueError(
                                "Backup schema differs from this version. Upgrade a copy of the backup before restoring."
                            )
                    if con.execute("PRAGMA foreign_key_check").fetchone():
                        raise ValueError("The backup contains broken record references.")
                    if not con.execute("SELECT 1 FROM user WHERE is_admin=1 LIMIT 1").fetchone():
                        raise ValueError("The backup has no owner account.")
                    # Old browser sessions and restored passkeys must not regain access.
                    for (uid,) in con.execute("SELECT id FROM user").fetchall():
                        con.execute(
                            "UPDATE user SET auth_version=?, must_change_password=1 WHERE id=?",
                            (secrets.randbelow(2**30) + 1, uid),
                        )
                    con.execute("DELETE FROM passkey")
                    con.execute("DELETE FROM passkey_challenge")
                    con.commit()
                old = backup_path("recovery")
                snapshot(live, old)
                changed = True
                snapshot(staged, live)
                db.engine.dispose()
                session.clear()
                flash(
                    "Backup restored. Sign in with a restored owner account. Register your passkeys again. A recovery copy was kept.",
                    "success",
                )
                return redirect(url_for("login"))
        except Exception as exc:
            db.session.remove()
            if changed and old:
                try:
                    snapshot(old, live_path())
                    db.engine.dispose()
                except Exception:
                    app.logger.critical(
                        "Restore rollback failed; database requires recovery from %s",
                        old,
                        exc_info=True,
                    )
                    return (
                        "Recovery requires the shop owner to restore the retained backup. Stop billing until recovered.",
                        503,
                    )
            app.logger.warning("Restore rejected: %s", exc)
            flash(
                str(exc)
                if isinstance(exc, ValueError)
                else "Restore failed. The previous database was retained.",
                "danger",
            )
            return redirect(url_for("settings"))

    app.view_functions["backup_download"] = download
    app.view_functions["backup_database"] = create
    app.view_functions["backup_restore"] = restore
