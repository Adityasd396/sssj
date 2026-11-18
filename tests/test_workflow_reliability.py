# ruff: noqa: F811
"""Workflow reliability uses isolated synthetic databases; no live data is opened."""

import re
from html import unescape
from unittest.mock import patch
from urllib.parse import urlsplit

import pytest
from flask import template_rendered
from sqlalchemy import event, inspect
from test_workflows import billing, sale, shop  # noqa: F401 - shared isolated fixture

from invoice_sharing import share_token, whatsapp_number


@pytest.mark.parametrize("json_request", [False, True])
def test_customer_retry_reuses_record_with_formatted_phone(shop, json_request):
    client, _, _ = shop
    data = {"name": "New Person", "phone": "+91 98765 43210"}
    first = client.post("/clients/quick", **({"json": data} if json_request else {"data": data}))
    assert first.status_code == 201
    data["phone"] = "9876543210"
    again = client.post("/clients/quick", data=data)
    assert again.status_code == 200 and again.json["existing"]
    assert first.json["client"]["id"] == again.json["client"]["id"]
    assert billing.Client.query.count() == 2
    assert (
        billing.db.session.get(billing.Client, first.json["client"]["id"]).phone
        == "+91 98765 43210"
    )


def test_expired_csrf_can_be_refreshed_without_new_customer(shop):
    client, _, _ = shop
    billing.app.config["WTF_CSRF_ENABLED"] = True
    try:
        data = {"name": "Recovered", "phone": "9888888888"}
        response = client.post("/clients/quick", data=data, headers={"Accept": "application/json"})
        assert response.status_code == 400 and response.json["code"] == "csrf_expired"
        assert billing.Client.query.count() == 1
        token = client.get("/api/session").json["csrf_token"]
        assert (
            client.post("/clients/quick", data=data, headers={"X-CSRFToken": token}).status_code
            == 201
        )
    finally:
        billing.app.config["WTF_CSRF_ENABLED"] = False


def test_inventory_is_paged_and_searches_weight_without_altering_records(shop):
    client, _, _ = shop
    for i in range(60):
        billing.db.session.add(
            billing.Product(
                name=f"Weight ring {i:02}",
                sku=f"R{i}",
                barcode=f"R{i}",
                item_type="gold",
                unit="pcs",
                weight_per_unit=2 + i / 100,
                stock_quantity=2,
            )
        )
    billing.db.session.commit()
    schema = {
        name: tuple(c["name"] for c in inspect(billing.db.engine).get_columns(name))
        for name in inspect(billing.db.engine).get_table_names()
    }
    contexts = []

    def record(sender, template, context, **extra):
        contexts.append(context)

    with template_rendered.connected_to(record, billing.app):
        assert client.get("/products").status_code == 200
        first = {p.id for p in contexts[-1]["products"]}
        assert len(first) == 25 and contexts[-1]["pagination"]["total"] == 61
        client.get("/products?page=2")
        assert not first & {p.id for p in contexts[-1]["products"]}
        client.get("/products?min_weight=2.1&max_weight=2.2")
        assert contexts[-1]["pagination"]["total"] == 11
        assert all(2.1 <= p.weight_per_unit <= 2.2 for p in contexts[-1]["products"])
        client.get("/products?q=2.125g")
        assert contexts[-1]["pagination"]["total"] == 0
        client.get("/products?q=2.15+g")
        assert len(contexts[-1]["products"]) == 1
        client.get("/products?min_weight=3&max_weight=2")
        assert contexts[-1]["weight_error"] and not contexts[-1]["products"]
    assert billing.Product.query.count() == 61
    assert schema == {
        name: tuple(c["name"] for c in inspect(billing.db.engine).get_columns(name))
        for name in inspect(billing.db.engine).get_table_names()
    }


def test_whatsapp_contains_recipient_message_and_anonymous_expiring_pdf(shop):
    client, customer, _ = shop
    client.post("/invoices/create", data=sale(customer, description=["Ring <unclosed> & chain"]))
    invoice = billing.Invoice.query.first()
    text = unescape(client.get(f"/invoices/{invoice.id}").data.decode())
    assert "https://wa.me/919000000000?text=" in text
    shared = urlsplit(re.search(r"http://localhost/shared/bill/[^\s<]+\.pdf", text)[0]).path
    visitor = billing.app.test_client()
    assert visitor.get(f"/invoices/{invoice.id}/pdf").status_code == 302
    response = visitor.get(shared)
    assert response.status_code == 200 and response.data.startswith(b"%PDF")
    assert response.headers["Cache-Control"] == "no-store"
    assert visitor.get(shared.replace(".pdf", "x.pdf")).status_code == 410
    with patch("itsdangerous.timed.TimestampSigner.get_timestamp", return_value=1000):
        expired = share_token(billing.app, invoice)
    assert visitor.get("/shared/bill/" + expired + ".pdf").status_code == 410
    iid = invoice.id
    client.post(f"/invoices/{iid}/delete")
    client.post("/invoices/create", data=sale(customer))
    assert visitor.get(shared).status_code == 410


@pytest.mark.parametrize(
    "number,expected",
    [
        ("9000000000", "919000000000"),
        ("+91 90000-00000", "919000000000"),
        ("00919000000000", "919000000000"),
        ("09000000000", "919000000000"),
        ("+44 7700 900123", "447700900123"),
        ("123", ""),
    ],
)
def test_whatsapp_number(number, expected):
    assert whatsapp_number(number) == expected


def test_receipt_widths_share_saved_facts_and_private_access(shop):
    client, customer, _ = shop
    client.post("/invoices/create", data=sale(customer))
    inv = billing.Invoice.query.first()
    for width in (58, 80):
        response = client.get(f"/invoices/{inv.id}/receipt?width={width}")
        assert response.status_code == 200
        assert f"width:{width - 6}mm" in response.data.decode()
        assert f"{inv.total / 100:.2f}" in response.data.decode()
    assert client.get(f"/invoices/{inv.id}/receipt?width=500").status_code == 400
    assert billing.app.test_client().get(f"/invoices/{inv.id}/receipt").status_code == 302
    assert client.get("/printers").status_code == 200


def test_static_assets_do_not_query_database_and_are_cacheable(shop):
    client, _, _ = shop
    calls = []

    def sql(conn, cursor, statement, parameters, context, executemany):
        calls.append(statement)

    event.listen(billing.db.engine, "before_cursor_execute", sql)
    try:
        response = client.get("/static/js/camera-engine.js")
        assert response.status_code == 200
        assert not calls
        assert "public" in response.headers["Cache-Control"]
    finally:
        event.remove(billing.db.engine, "before_cursor_execute", sql)


def test_production_message_uses_https_for_the_customer_pdf(shop, monkeypatch):
    client, customer, _ = shop
    client.post("/invoices/create", data=sale(customer))
    inv = billing.Invoice.query.first()
    monkeypatch.setattr(billing, "_PRODUCTION", True)
    response = client.get(f"/invoices/{inv.id}")
    assert b"https://localhost/shared/bill/" in response.data
