# ruff: noqa: F811
"""Inventory/rate regressions; fixtures never open production data."""

import pytest
from flask import template_rendered
from sqlalchemy import inspect
from test_workflows import billing, sale, shop  # noqa: F401


def add_product(name, code, metal="gold", unit="pcs", stock=0, weight=1):
    product = billing.Product(
        name=name,
        sku="SKU-" + name,
        barcode=code,
        item_type=metal,
        unit=unit,
        stock_quantity=stock if unit == "pcs" else 0,
        stock_weight=stock if unit == "g" else 0,
        weight_per_unit=weight,
        category="Saved category",
    )
    billing.db.session.add(product)
    return product


def test_inventory_zero_stock_global_summaries_and_read_only(shop):
    client, _, _ = shop
    add_product("Gold empty", "JWL-000010", weight=2)
    add_product("Silver grams", "SILVER-1", "silver", "g", 4.321)
    add_product("Silver empty", "SILVER-0", "silver", "g", 0)
    billing.db.session.commit()
    before = {
        p.id: tuple(getattr(p, c.name) for c in billing.Product.__table__.columns)
        for p in billing.Product.query.all()
    }
    schema = {
        t: tuple(c["name"] for c in inspect(billing.db.engine).get_columns(t))
        for t in inspect(billing.db.engine).get_table_names()
    }
    contexts = []

    def capture(sender, template, context, **kwargs):
        contexts.append(context)

    with template_rendered.connected_to(capture, billing.app):
        response = client.get("/products?stock=out")
        assert response.status_code == 200
        assert {p.name for p in contexts[-1]["products"]} == {"Gold empty", "Silver empty"}
        assert contexts[-1]["gold_stats"] == {"count": 2, "pieces": 5, "weight": 5.0}
        assert contexts[-1]["silver_stats"] == {"count": 2, "pieces": 0, "weight": 4.321}
        assert b"Gold empty" in response.data and b"Silver empty" in response.data
        client.get("/products?stock=in&cat=Saved+category")
        assert [p.name for p in contexts[-1]["products"]] == ["Silver grams"]
        assert contexts[-1]["all_stats"]["count"] == 4
        client.get("/products?q=not-present")
        assert contexts[-1]["pagination"]["total"] == 0 and contexts[-1]["all_stats"]["count"] == 4
    assert before == {
        p.id: tuple(getattr(p, c.name) for c in billing.Product.__table__.columns)
        for p in billing.Product.query.all()
    }
    assert schema == {
        t: tuple(c["name"] for c in inspect(billing.db.engine).get_columns(t))
        for t in inspect(billing.db.engine).get_table_names()
    }


def test_zero_stock_filter_before_pagination_and_links(shop):
    client, _, _ = shop
    for i in range(30):
        add_product(f"Empty {i:02}", f"JWL-{i + 100:06}", stock=0)
    billing.db.session.commit()
    contexts = []

    def capture(sender, template, context, **kwargs):
        contexts.append(context)

    with template_rendered.connected_to(capture, billing.app):
        response = client.get(
            "/products?stock=out&code=generated&sort=generated_first&cat=Saved+category"
        )
        assert contexts[-1]["pagination"]["total"] == 30 and len(contexts[-1]["products"]) == 25
        text = response.get_data(as_text=True)
        assert "stock=out" in text and "code=generated" in text and "sort=generated_first" in text
        client.get("/products?stock=out&code=generated&sort=generated_first&page=2")
        assert len(contexts[-1]["products"]) == 5


def test_qr_code_style_filter_is_explicit_not_scan_history(shop):
    client, _, _ = shop
    add_product("Z generated", "JWL-000123", stock=1)
    add_product("External", "JWL-notdigits", stock=1)
    add_product("No code", None, stock=1)
    billing.db.session.commit()
    contexts = []

    def capture(sender, template, context, **kwargs):
        contexts.append(context)

    with template_rendered.connected_to(capture, billing.app):
        response = client.get("/products?sort=generated_first")
        assert contexts[-1]["products"][0].name == "Z generated"
        assert b"Scan history is not recorded" in response.data
        client.get("/products?code=generated")
        assert [p.name for p in contexts[-1]["products"]] == ["Z generated"]
        client.get("/products?code=missing")
        assert [p.name for p in contexts[-1]["products"]] == ["No code"]
        client.get("/products?code=other")
        assert {p.name for p in contexts[-1]["products"]} == {"External", 'Ring "Classic"'}


def test_saved_categories_in_add_edit_and_error_forms(shop):
    client, _, product = shop
    product.category = "Client Special <Ring>"
    billing.db.session.commit()
    for response in [
        client.get("/products/add"),
        client.get("/products/1/edit"),
        client.post("/products/add", data={"name": "", "item_type": "wrong"}),
    ]:
        assert b"Client Special &lt;Ring&gt;" in response.data
        assert b'list="cat-list"' in response.data
    assert billing.Product.query.count() == 1


@pytest.mark.parametrize("rate", ["0", "-1", "abc", "nan", "inf", "1e309", "1000000001"])
def test_invalid_bill_rates_do_not_save_or_change_settings(shop, rate):
    client, customer, _ = shop
    data = sale(customer, bill_gold_rate=rate)
    assert client.post("/api/invoices/preview", data=data).status_code == 422
    assert client.post("/invoices/create", data=data).status_code == 422
    assert billing.Invoice.query.count() == 0
    assert billing.Settings.query.first().gold_manual_price == 10000


def test_cashier_cannot_override_bill_rates(shop):
    client, customer, _ = shop
    user = billing.User.query.first()
    user.is_admin = False
    billing.db.session.commit()
    assert b'name="bill_gold_rate"' not in client.get("/invoices/create").data
    data = sale(customer, bill_gold_rate="1.00")
    assert client.post("/api/invoices/preview", data=data).status_code == 422
    assert client.post("/invoices/create", data=data).status_code == 422
    assert billing.Invoice.query.count() == 0
    assert billing.Settings.query.first().gold_manual_price == 10000


def test_override_frozen_per_bill_preview_read_only_and_master_prices_unchanged(shop):
    client, customer, product = shop
    client.post("/invoices/create", data=sale(customer))
    old = billing.Invoice.query.first()
    old_values = (old.total, old.gold_rate, old.silver_rate)
    master = billing.Settings.query.first()
    settings_before = {
        c.key: getattr(master, c.key)
        for c in billing.Settings.__table__.columns
        if c.key != "invoice_seq"
    }
    price_before = product.unit_price
    data = sale(customer, bill_gold_rate="123.45", bill_silver_rate="71.23")
    preview = client.post("/api/invoices/preview", data=data)
    assert (
        preview.status_code == 200
        and preview.json["gold_rate"] == 12345
        and preview.json["silver_rate"] == 7123
    )
    assert billing.Invoice.query.count() == 1
    assert client.post("/invoices/create", data=data).status_code == 302
    latest = billing.Invoice.query.order_by(billing.Invoice.id.desc()).first()
    assert (
        latest.total == preview.json["total"]
        and latest.gold_rate == 12345
        and latest.silver_rate == 7123
    )
    assert (old.total, old.gold_rate, old.silver_rate) == old_values
    billing.db.session.expire_all()
    master = billing.Settings.query.first()
    assert settings_before == {
        c.key: getattr(master, c.key)
        for c in billing.Settings.__table__.columns
        if c.key != "invoice_seq"
    }
    assert billing.Product.query.first().unit_price == price_before
    master.gold_manual_price = 99999
    billing.db.session.commit()
    assert billing.bill_facts(latest)["gold_rate_paise"] == 12345
    for url in [
        f"/invoices/{latest.id}",
        f"/invoices/{latest.id}/receipt",
        f"/invoices/{latest.id}/pdf",
    ]:
        assert client.get(url).status_code == 200
