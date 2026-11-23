# ruff: noqa: F811
"""Read-only query budgets and safe public-asset delivery on temporary fixtures."""

import gzip
import hashlib
import json

from flask import Flask, template_rendered
from sqlalchemy import event
from test_workflows import billing, shop  # noqa: F401

from asset_delivery import install


def test_collections_and_history_query_budgets_and_totals(shop):
    client, customer, _ = shop
    for i in range(60):
        c = billing.Client(name=f"Perf {i:03}", phone=f"810000{i:04}")
        billing.db.session.add(c)
        billing.db.session.flush()
        bill = billing.Invoice(
            invoice_number=f"PERF-{i}",
            client_id=c.id,
            total=10000,
            subtotal=10000,
            status="pending",
        )
        billing.db.session.add(bill)
        billing.db.session.flush()
        billing.db.session.add(
            billing.Payment(invoice_id=bill.id, client_id=c.id, amount=1000, payment_method="cash")
        )
    for i in range(40):
        billing.db.session.add(
            billing.Invoice(
                invoice_number=f"HISTORY-{i}",
                client_id=customer.id,
                total=10000,
                subtotal=10000,
                status="pending",
            )
        )
    billing.db.session.commit()
    for url, budget in [
        ("/collect", 8),
        ("/invoices", 8),
        ("/clients/1", 8),
        ("/clients/1/statement", 8),
        ("/", 18),
    ]:
        statements, contexts = [], []

        def observe(conn, cursor, sql, *args, calls=statements):
            calls.append(sql)

        def capture(sender, template, context, rows=contexts, **kwargs):
            rows.append(context)

        event.listen(billing.db.engine, "before_cursor_execute", observe)
        try:
            with template_rendered.connected_to(capture, billing.app):
                assert client.get(url).status_code == 200
        finally:
            event.remove(billing.db.engine, "before_cursor_execute", observe)
        assert len(statements) <= budget, (url, len(statements))
        assert not any(
            sql.lstrip().upper().startswith(("UPDATE", "INSERT", "DELETE", "ALTER"))
            for sql in statements
        )
        context = contexts[-1]
        if url == "/collect":
            assert context["total_due"] == 940000 and len(context["rows"]) == 61
        elif url == "/":
            assert context["collect_due"] == 940000 and context["collect_count"] == 100
        elif url == "/invoices":
            assert all(inv.paid_amount in (0, 1000) for inv in context["invoices"])
        else:
            assert sum(inv.remaining_amount for inv in context["invoices"]) == 400000


def test_public_assets_compressed_without_compressing_private_pages(shop):
    client, _, _ = shop
    path = "static/js/vendor/zxing-browser-0.2.1.min.js"
    plain = client.get("/" + path)
    compressed = client.get("/" + path, headers={"Accept-Encoding": "gzip"})
    assert compressed.status_code == 200 and compressed.headers["Content-Encoding"] == "gzip"
    assert gzip.decompress(compressed.data) == plain.data
    assert len(compressed.data) < len(plain.data) * 0.4
    assert "Accept-Encoding" in compressed.headers["Vary"]
    assert (
        client.get("/invoices/create", headers={"Accept-Encoding": "gzip"}).headers.get(
            "Content-Encoding"
        )
        is None
    )
    assert (
        client.get("/" + path, headers={"Accept-Encoding": "gzip;q=0"}).headers.get(
            "Content-Encoding"
        )
        is None
    )
    assert (
        client.get(
            "/" + path,
            headers={"Accept-Encoding": "gzip", "If-None-Match": compressed.headers["ETag"]},
        ).status_code
        == 304
    )


def test_stale_or_corrupt_precompressed_asset_falls_back(tmp_path):
    source = b'window.example="' + b"a" * 4000 + b'";'
    zipped = gzip.compress(source)
    (tmp_path / "sample.js").write_bytes(source)
    (tmp_path / "sample.js.gz").write_bytes(zipped)
    manifest = {
        "sample.js": {
            "source": hashlib.sha256(source).hexdigest(),
            "gzip": hashlib.sha256(zipped).hexdigest(),
        }
    }
    (tmp_path / "compressed-assets.json").write_text(json.dumps(manifest))
    app = Flask(__name__, static_folder=str(tmp_path), static_url_path="/static")
    install(app)
    client = app.test_client()
    assert (
        client.get("/static/sample.js", headers={"Accept-Encoding": "gzip"}).headers.get(
            "Content-Encoding"
        )
        == "gzip"
    )
    (tmp_path / "sample.js.gz").write_bytes(gzip.compress(b"wrong script"))
    response = client.get("/static/sample.js", headers={"Accept-Encoding": "gzip"})
    assert response.headers.get("Content-Encoding") is None and response.data == source
    assert client.get("/static/../app.py", headers={"Accept-Encoding": "gzip"}).status_code == 404
