# ruff: noqa: F811
"""Route audit fixes; all requests use an isolated synthetic database."""

from pathlib import Path

import pytest
from flask import template_rendered
from sqlalchemy import event
from test_workflows import billing, sale, shop  # noqa: F401


@pytest.fixture(autouse=True)
def isolated_instance(tmp_path, monkeypatch):
    monkeypatch.setattr(billing.app, "instance_path", str(tmp_path))


def cashier():
    user = billing.User.query.first()
    user.is_admin = False
    billing.db.session.commit()


def test_status_cannot_disagree_with_posted_payments(shop):
    client, customer, _ = shop
    client.post("/invoices/create", data=sale(customer, payment_type="partial", partial_amount="0"))
    bill = billing.Invoice.query.first()
    assert (
        client.post(f"/invoices/{bill.id}/update_status", data={"status": "paid"}).status_code
        == 422
    )
    assert bill.status == "pending" and billing.invoice_paid_total(bill.id) == 0
    assert (
        client.post(
            f"/invoices/{bill.id}/payment", data={"amount": "108.15", "payment_method": "cash"}
        ).status_code
        == 302
    )
    assert (
        client.post(f"/invoices/{bill.id}/update_status", data={"status": "pending"}).status_code
        == 422
    )
    billing.db.session.expire_all()
    assert billing.Invoice.query.first().status == "paid"


def test_cashier_can_edit_contact_but_not_credit(shop):
    client, customer, _ = shop
    cashier()
    assert (
        client.post(
            "/clients/1/edit",
            data={"name": "New name", "phone": customer.phone, "credit_limit": "99999"},
        ).status_code
        == 403
    )
    billing.db.session.expire_all()
    assert billing.Client.query.first().credit_limit == 0
    assert (
        client.post(
            "/clients/1/edit", data={"name": "New name", "phone": customer.phone}
        ).status_code
        == 302
    )
    assert billing.Client.query.first().name == "New name"
    assert (
        client.post(
            "/clients/add", data={"name": "Other", "phone": "9111111111", "credit_limit": "1"}
        ).status_code
        == 403
    )
    assert billing.Client.query.count() == 1
    assert b'name="credit_limit"' not in client.get("/clients/1/edit").data


def test_phone_edit_conflict_preserves_form_and_existing_data(shop):
    client, _customer, _ = shop
    billing.db.session.add(billing.Client(name="Other", phone="+91 91111 11111"))
    billing.db.session.commit()
    response = client.post("/clients/1/edit", data={"name": "Typed name", "phone": "9111111111"})
    assert response.status_code == 409 and b"Typed name" in response.data
    billing.db.session.expire_all()
    assert billing.Client.query.get(1).phone == "9000000000"
    assert billing.Client.query.get(1).name == "Sample customer"
    # Historical duplicate records are neither merged nor rewritten by deployment.
    billing.db.session.add(billing.Client(name="Legacy duplicate", phone="9000000000"))
    billing.db.session.commit()
    assert (
        client.post("/clients/1/edit", data={"name": "Renamed", "phone": "9000000000"}).status_code
        == 302
    )
    assert billing.Client.query.count() == 3


@pytest.mark.parametrize(
    "url",
    [
        "/clients?page=" + "9" * 50,
        "/products?page=" + "9" * 50,
        "/invoices?page=" + "9" * 50,
        "/deleted-bills?page=" + "9" * 50,
    ],
)
def test_pagination_bounds(shop, url):
    client, _, _ = shop
    assert client.get(url).status_code == 200


@pytest.mark.parametrize(
    "url", ["/products/" + "9" * 100, "/tags/print?ids=" + "9" * 500, "/tags?tpl=" + "9" * 100]
)
def test_identifier_bounds(shop, url):
    client, _, _ = shop
    assert client.get(url).status_code in (400, 404)


def test_stale_tag_design(shop):
    client, _, _ = shop
    assert client.post("/tags/save", data={"tpl_id": "999999"}).status_code == 404


@pytest.mark.parametrize("endpoint", ["/reports", "/reports.csv", "/reports/products.csv"])
@pytest.mark.parametrize(
    "query", ["?to=9999-12-31", "?from=wrong", "?from=2026-11-20&to=2026-11-01"]
)
def test_report_date_bounds(shop, endpoint, query):
    client, _, _ = shop
    assert client.get(endpoint + query).status_code == 400


@pytest.mark.parametrize(
    "payload", [[], ["wrong"], "wrong", {"password": []}, {"password": "x" * 513}]
)
def test_passkey_payload_shape(shop, monkeypatch, payload):
    client, _, _ = shop
    monkeypatch.setenv("PASSKEY_ORIGIN", "http://localhost")
    monkeypatch.setenv("PASSKEY_RP_ID", "localhost")
    assert client.post("/passkeys/register/options", json=payload).status_code == 400


def test_filtered_archive_totals(shop):
    client, customer, _ = shop
    client.post("/invoices/create", data=sale(customer))
    bill = billing.Invoice.query.first()
    with billing.app.test_request_context("/"):
        a = billing.archive_deleted_invoice(bill, reason="sample", paid=0)
        a.client_name = "Find this customer"
        b = billing.archive_deleted_invoice(bill, reason="other", paid=100)
        b.client_name = "Other customer"
    billing.db.session.commit()
    contexts = []

    def capture(sender, template, context, **extra):
        contexts.append(context)

    with template_rendered.connected_to(capture, billing.app):
        assert client.get("/deleted-bills?q=Find").status_code == 200
    assert contexts[-1]["totals"] == {"count": 1, "value": bill.total, "paid": 0}


def test_report_query_count_and_values(shop):
    client, customer, _ = shop
    cid = customer.id
    for i in range(100):
        bill = billing.Invoice(
            invoice_number="PERF-" + str(i),
            client_id=cid,
            total=10000,
            subtotal=9700,
            gst_amount=300,
            status="pending",
        )
        billing.db.session.add(bill)
        billing.db.session.flush()
        billing.db.session.add(
            billing.Payment(invoice_id=bill.id, client_id=cid, amount=1000, payment_method="cash")
        )
    billing.db.session.commit()
    statements, contexts = [], []

    def capture(sender, template, context, **extra):
        contexts.append(context)

    def count(*args):
        statements.append(1)

    event.listen(billing.db.engine, "before_cursor_execute", count)
    try:
        with template_rendered.connected_to(capture, billing.app):
            assert client.get("/reports").status_code == 200
    finally:
        event.remove(billing.db.engine, "before_cursor_execute", count)
    assert len(statements) < 30
    assert contexts[-1]["total_revenue"] == 1000000
    assert contexts[-1]["collected"] == 100000
    assert contexts[-1]["outstanding"] == 900000
    assert contexts[-1]["total_gst"] == 30000


def test_customer_lookup_and_tag_batches_are_bounded(shop):
    client, _, _ = shop
    for i in range(110):
        billing.db.session.add(billing.Client(name=f"ZZZ {i:03}", phone=f"800000{i:04}"))
        billing.db.session.add(
            billing.Product(
                name=f"Tag {i:03}",
                sku=f"BOUND-{i}",
                barcode=f"BOUND-{i}",
                item_type="gold",
                weight_per_unit=1,
            )
        )
    billing.db.session.commit()
    assert len(client.get("/api/clients").json["clients"]) == 30
    late = billing.Client.query.filter_by(name="ZZZ 109").first()
    assert client.get(f"/api/clients?id={late.id}").json["clients"][0]["id"] == late.id
    assert client.get("/api/clients?q=ZZZ+109").json["clients"][0]["id"] == late.id
    contexts = []

    def capture(sender, template, context, **extra):
        contexts.append(context)

    with template_rendered.connected_to(capture, billing.app):
        assert client.get("/invoices/create").status_code == 200
        assert len(contexts[-1]["clients"]) == 50
        assert client.get(f"/invoices/create?client_id={late.id}").status_code == 200
        assert late.id in [c.id for c in contexts[-1]["clients"]]
        assert client.get("/tags?page=2").status_code == 200
        assert len(contexts[-1]["products"]) == 50 and contexts[-1]["product_pg"]["page"] == 2
    assert client.get("/tags/print").status_code == 302
    assert client.get("/tags/print?ids=1").status_code == 200
    assert (
        client.get("/tags/print?ids=" + ",".join(str(i) for i in range(1, 102))).status_code == 400
    )


def test_backups_have_no_get_head_retention_and_keep_recovery(shop):
    client, _, _ = shop
    folder = Path(billing.app.instance_path) / "backups"
    assert client.head("/backup/download").status_code == 200
    assert client.get("/backup/database").status_code == 302
    assert not folder.exists()
    download = client.get("/backup/download")
    assert download.status_code == 200 and download.data.startswith(b"SQLite format 3")
    assert not folder.exists()
    folder.mkdir()
    recovery = folder / "recovery-20261118-010101-123456abcdef.db"
    recovery.write_bytes(b"kept")
    legacy = folder / "billing-20261118-010101-123456abcdef.db"
    legacy.write_bytes(b"legacy recovery kept")
    for _ in range(7):
        response = client.post("/backup/database")
        assert response.status_code == 200 and response.data.startswith(b"SQLite format 3")
    assert len(list(folder.glob("snapshot-*.db"))) == 5
    assert recovery.read_bytes() == b"kept"
    assert legacy.read_bytes() == b"legacy recovery kept"


@pytest.mark.parametrize(
    "method,url,data",
    [
        ("GET", "/tags/print?ids=%C2%B2", None),
        ("GET", "/tags?tpl=%C2%B2", None),
        ("POST", "/tags/save", {"tpl_id": "9" * 100}),
    ],
)
def test_identifier_encoding_and_post_bounds(shop, method, url, data):
    client, _, _ = shop
    assert client.open(url, method=method, data=data).status_code == 400
