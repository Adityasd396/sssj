"""Request bounds, CSV text safety and SQLite maintenance coordination."""

import csv
import math
from pathlib import Path

import portalocker
from flask import abort, g, jsonify, request


def safe_csv_writer(stream):
    writer = csv.writer(stream)

    class Writer:
        def writerow(self, row):
            writer.writerow(
                [
                    ("'" + value)
                    if isinstance(value, str)
                    and value.lstrip(" \t\r\n").startswith(("=", "+", "-", "@"))
                    else value
                    for value in row
                ]
            )

    return Writer()


def install_gate(app, db):
    @app.before_request
    def maintenance_gate():
        if request.endpoint == "static":
            return None
        if any(
            isinstance(value, int) and not 0 <= value <= 9223372036854775807
            for value in (request.view_args or {}).values()
        ):
            abort(404, "Record not found.")
        for key in ("tpl", "client_id", "sample"):
            raw = request.args.get(key)
            if raw and (
                not raw.isascii()
                or not raw.isdigit()
                or len(raw) > 19
                or not 0 < int(raw) <= 9223372036854775807
            ):
                abort(400, "Invalid record identifier.")
        if db.engine.dialect.name == "sqlite":
            path = db.engine.url.database
            if path and path != ":memory:":
                lock_path = Path(path + ".maintenance.lock")
                lock_path.parent.mkdir(parents=True, exist_ok=True)
                handle = open(lock_path, "a+b")  # noqa: SIM115 - released in teardown_request
                exclusive = request.endpoint == "backup_restore"
                try:
                    portalocker.lock(
                        handle,
                        (portalocker.LOCK_EX if exclusive else portalocker.LOCK_SH)
                        | portalocker.LOCK_NB,
                    )
                except portalocker.exceptions.LockException:
                    handle.close()
                    abort(
                        503,
                        "Database maintenance is in progress, or billing is active. Please retry.",
                    )
                except Exception:
                    handle.close()
                    raise
                g.maintenance_handle = handle
        if request.method not in ("POST", "PUT", "PATCH") or request.endpoint == "backup_restore":
            return None
        if request.content_length and request.content_length > 1024 * 1024:
            abort(413, "This request is too large.")
        if request.is_json:
            if request.path.startswith("/passkeys/"):
                payload = request.get_json(silent=True)
                if not isinstance(payload, dict):
                    abort(400, "Send passkey details as a JSON object.")
                for key, limit in {"password": 512, "name": 80}.items():
                    if key in payload and (
                        not isinstance(payload[key], str) or len(payload[key]) > limit
                    ):
                        abort(400, "Invalid passkey field.")
            if (
                request.path.startswith("/passkeys/")
                and request.content_length
                and request.content_length > 65536
            ):
                abort(413, "This passkey response is too large.")
            if request.endpoint == "quick_client":
                data = request.get_json(silent=True)
                if not isinstance(data, dict) or any(
                    not isinstance(data.get(key, ""), str) or len(data.get(key, "")) > limit
                    for key, limit in {
                        "name": 200,
                        "phone": 20,
                        "email": 120,
                        "address": 8000,
                    }.items()
                ):
                    abort(400, "Customer details exceed their supported limits.")
            return None
        numeric = {
            "quantity",
            "unit_price",
            "weight",
            "making_charges",
            "discount_value",
            "gst_rate",
            "exchange_weight",
            "exchange_rate",
            "exchange_amount",
            "partial_amount",
            "amount",
            "weight_per_unit",
            "stock_quantity",
            "stock_weight",
            "cost_price",
            "custom_price",
            "credit_limit",
            "gold_price",
            "silver_price",
            "gold_making_charge_percent",
            "gold_making_flat",
            "silver_making_charge_per_10gm",
            "silver_making_percent",
            "gold_manual_price",
            "silver_manual_price",
        }
        for key in ("client_id", "product_id", "tpl_id", "user_id"):
            raw = request.form.get(key)
            if raw and (
                not raw.isascii()
                or not raw.isdigit()
                or len(raw) > 19
                or not 0 < int(raw) <= 9223372036854775807
            ):
                abort(400, "Invalid record identifier.")
        for name, values in request.form.lists():
            if len(values) > 200:
                abort(400, "A bill can contain at most 200 items.")
            for value in values:
                limits = {
                    "name": 200,
                    "category": 80,
                    "username": 80,
                    "email": 120,
                    "phone": 20,
                    "firm_name": 200,
                    "firm_phone": 20,
                    "firm_email": 120,
                    "gstin": 20,
                    "client_gstin": 20,
                    "firm_gst": 20,
                    "existing_code": 100,
                    "submission_key": 64,
                }
                if name in limits and len(value) > limits[name]:
                    abort(400, "A field exceeds its maximum length.")
                if len(value) > (
                    8000 if name in ("description", "notes", "firm_address", "address") else 512
                ):
                    abort(400, "A field is too long. Shorten it and try again.")
                if name in numeric and value.strip():
                    try:
                        number = float(value)
                        if not math.isfinite(number) or abs(number) > 1_000_000_000:
                            raise ValueError
                    except (ValueError, OverflowError):
                        return jsonify(
                            success=False, error="Enter a finite number within the supported range."
                        ), 422

        return None

    @app.teardown_request
    def release_gate(error):
        handle = g.pop("maintenance_handle", None)
        if handle:
            # End transactions before allowing another process to restore.
            db.session.rollback()
            portalocker.unlock(handle)
            handle.close()
