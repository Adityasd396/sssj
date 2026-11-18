"""Financial workflow regressions; every test uses an isolated temporary database."""

import atexit
import os
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest

_temp = tempfile.TemporaryDirectory(prefix="billing-tests-")
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(_temp.name, "test.db").replace("\\", "/")
os.environ["SECRET_KEY"] = "isolated-test-key-only"
os.environ["TRUST_PROXY"] = "0"
os.environ["FLASK_ENV"] = "development"

import app as billing


def cleanup():
    with billing.app.app_context():
        billing.db.session.remove()
        billing.db.engine.dispose()
    _temp.cleanup()


atexit.register(cleanup)


@pytest.fixture()
def shop():
    billing.app.config.update(TESTING=True, WTF_CSRF_ENABLED=False)
    with billing.app.app_context():
        billing.db.drop_all()
        billing.db.create_all()
        billing._SCHEMA_OK = True
        user = billing.User(username="owner", email="owner@example.invalid", is_admin=True)
        user.set_password("test-password")
        customer = billing.Client(name="Sample customer", phone="9000000000")
        product = billing.Product(
            name='Ring "Classic"',
            sku="TEST",
            barcode="TEST-CODE",
            item_type="gold",
            unit="pcs",
            weight_per_unit=1,
            stock_quantity=5,
            cost_price=5000,
        )
        billing.db.session.add_all(
            [user, customer, product, billing.Settings(gold_manual_price=10000)]
        )
        billing.db.session.commit()
        client = billing.app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = user.id
            session["username"] = user.username
            session["is_admin"] = True
        yield client, customer, product
        billing.db.session.remove()


def sale(customer, **overrides):
    data = {
        "client_id": str(customer.id),
        "description": ["Ring"],
        "quantity": ["1"],
        "item_type": ["gold"],
        "weight": ["1"],
        "unit_price": ["100"],
        "making_charges": ["0"],
        "making_mode": ["percent"],
        "product_code": ["TEST-CODE"],
        "payment_type": "full",
        "payment_method": "cash",
        "submission_key": uuid.uuid4().hex,
    }
    data.update(overrides)
    return data


def test_checkout_and_retry_create_one_bill(shop):
    client, customer, product = shop
    data = sale(customer)
    first = client.post("/invoices/create", data=data)
    second = client.post("/invoices/create", data=data)
    assert first.status_code == second.status_code == 302
    assert first.location == second.location
    assert billing.Invoice.query.count() == 1
    assert billing.Payment.query.count() == 1
    assert billing.db.session.get(billing.Product, product.id).stock_quantity == 4
    assert billing.Invoice.query.first().total == 10815


def test_duplicate_lines_cannot_oversell(shop):
    client, customer, product = shop
    product.stock_quantity = 1
    billing.db.session.commit()
    data = sale(
        customer,
        description=["Ring", "Same ring"],
        quantity=["1", "1"],
        item_type=["gold", "gold"],
        weight=["1", "1"],
        unit_price=["100", "100"],
        making_charges=["0", "0"],
        making_mode=["percent", "percent"],
        product_code=["TEST-CODE", "TEST-CODE"],
    )
    response = client.post("/invoices/create", data=data)
    assert response.status_code == 422
    assert b"Insufficient stock" in response.data
    assert billing.Invoice.query.count() == billing.Payment.query.count() == 0
    assert billing.db.session.get(billing.Product, product.id).stock_quantity == 1


@pytest.mark.parametrize(
    "payment,partial,expected", [("full", "0", 422), ("partial", "100", 422), ("partial", "0", 422)]
)
def test_credit_limit_preserves_original_pre_payment_check(shop, payment, partial, expected):
    client, customer, _product = shop
    customer.credit_limit = 1000
    billing.db.session.commit()
    response = client.post(
        "/invoices/create", data=sale(customer, payment_type=payment, partial_amount=partial)
    )
    assert response.status_code == expected


def test_zero_making_and_blank_use_original_default(shop):
    client, customer, _product = shop
    assert client.post("/invoices/create", data=sale(customer)).status_code == 302
    assert (
        client.post("/invoices/create", data=sale(customer, making_charges=[""])).status_code == 302
    )
    bills = billing.Invoice.query.order_by(billing.Invoice.id).all()
    assert [bill.subtotal for bill in bills] == [10500, 10500]


@pytest.mark.parametrize(
    "field",
    ["quantity", "weight", "making_charges", "discount_value", "exchange_amount", "partial_amount"],
)
def test_preview_rejects_non_finite_values(shop, field):
    client, customer, _product = shop
    data = sale(customer)
    data[field] = ["nan"] if field in ("quantity", "weight", "making_charges") else "nan"
    if field == "partial_amount":
        data["payment_type"] = "partial"
    if field == "discount_value":
        data["discount_type"] = "percent"
    if field == "exchange_amount":
        data["exchange_metal"] = "gold"
    response = client.post("/api/invoices/preview", data=data)
    assert response.status_code == 422
    assert response.json["success"] is False
    assert billing.Invoice.query.count() == 0


def test_manual_item_reports_and_document_routes(shop):
    client, customer, _product = shop
    response = client.post(
        "/invoices/create",
        data=sale(
            customer,
            description=["Repair service"],
            item_type=["general"],
            weight=[""],
            product_code=[""],
            unit_price=["50"],
        ),
    )
    assert response.status_code == 302
    invoice = billing.Invoice.query.first()
    for path in [
        response.location,
        "/reports",
        "/reports.csv",
        "/reports/products.csv",
        f"/invoices/{invoice.id}/pdf",
        f"/clients/{customer.id}/statement",
    ]:
        assert client.get(path).status_code == 200, path


def test_payment_retry_does_not_collect_twice(shop):
    client, customer, _product = shop
    client.post("/invoices/create", data=sale(customer, payment_type="partial", partial_amount="0"))
    invoice = billing.Invoice.query.first()
    data = {"amount": "20", "payment_method": "UPI", "submission_key": uuid.uuid4().hex}
    for _ in range(2):
        assert client.post(f"/invoices/{invoice.id}/payment", data=data).status_code == 302
    assert billing.invoice_paid_total(invoice.id) == 2000
    assert billing.db.session.get(billing.Client, customer.id).balance == 8815


def test_collection_retry_and_cancel_delete_reversal(shop):
    client, customer, product = shop
    client.post("/invoices/create", data=sale(customer, payment_type="partial", partial_amount="0"))
    invoice = billing.Invoice.query.first()
    data = {"amount": "20", "payment_method": "cash", "submission_key": uuid.uuid4().hex}
    for _ in range(2):
        client.post(f"/clients/{customer.id}/pay-remaining", data=data)
    assert billing.invoice_paid_total(invoice.id) == 2000
    response = client.post(f"/invoices/{invoice.id}/update_status", data={"status": "paid"})
    assert response.status_code == 422
    assert billing.db.session.get(billing.Invoice, invoice.id).status == "pending"
    client.post(f"/invoices/{invoice.id}/update_status", data={"status": "cancelled"})
    client.post(f"/invoices/{invoice.id}/delete")
    assert billing.db.session.get(billing.Product, product.id).stock_quantity == 5
    assert billing.db.session.get(billing.Client, customer.id).balance == 0


def test_overpayment_preserves_form(shop):
    client, customer, _product = shop
    client.post("/invoices/create", data=sale(customer, payment_type="partial", partial_amount="0"))
    invoice = billing.Invoice.query.first()
    response = client.post(
        f"/invoices/{invoice.id}/payment", data={"amount": "999", "notes": "Keep my note"}
    )
    assert response.status_code == 422
    assert b"Keep my note" in response.data
    assert billing.invoice_paid_total(invoice.id) == 0


def test_quick_customer_and_csrf(shop):
    client, _customer, _product = shop
    response = client.post("/clients/quick", data={"name": "New customer", "phone": "9000000001"})
    assert response.status_code == 201
    assert (
        client.post("/clients/quick", data={"name": "Duplicate", "phone": "9000000001"}).status_code
        == 409
    )
    billing.app.config["WTF_CSRF_ENABLED"] = True
    assert (
        client.post("/clients/quick", data={"name": "Blocked", "phone": "9000000002"}).status_code
        == 400
    )
    assert client.post("/logout").status_code == 400
    assert client.get("/logout").status_code == 405


def test_deleted_user_session_is_rejected(shop):
    client, _customer, _product = shop
    billing.User.query.delete()
    billing.db.session.commit()
    response = client.get("/invoices/create")
    assert response.status_code == 302 and response.location.endswith("/login")


@pytest.mark.parametrize(
    "path",
    [
        "/",
        "/clients",
        "/products",
        "/invoices",
        "/collect",
        "/reports",
        "/settings",
        "/tags",
        "/tags/calibrate",
        "/users",
        "/audit-logs",
        "/deleted-bills",
        "/invoices/create",
    ],
)
def test_main_screens_render(shop, path):
    client, _customer, _product = shop
    response = client.get(path)
    assert response.status_code == 200, path
    assert b"app.css" in response.data or b"paper-screen.css" in response.data


def test_additive_submission_key_migration(shop):
    _client, _customer, _product = shop
    # Simulate the previous schema without rebuilding any live business table.
    with billing.db.engine.begin() as connection:
        for table in ("invoice", "payment"):
            connection.execute(billing.db.text(f"DROP TABLE {table}"))
        connection.execute(
            billing.db.text(
                "CREATE TABLE invoice (id INTEGER PRIMARY KEY, invoice_number VARCHAR(20) NOT NULL UNIQUE, client_id INTEGER NOT NULL, date_created DATETIME, date_due DATETIME, status VARCHAR(20), subtotal INTEGER, gst_rate FLOAT, gst_amount INTEGER, total INTEGER, gold_rate INTEGER, silver_rate INTEGER, discount_type VARCHAR(20), discount_value FLOAT, discount_amount INTEGER, client_gstin VARCHAR(20), exchange_metal VARCHAR(20), exchange_weight FLOAT, exchange_rate FLOAT, exchange_amount INTEGER)"
            )
        )
        connection.execute(
            billing.db.text(
                "CREATE TABLE payment (id INTEGER PRIMARY KEY, invoice_id INTEGER, client_id INTEGER, amount INTEGER NOT NULL, payment_date DATETIME, payment_method VARCHAR(50), notes TEXT)"
            )
        )
        connection.execute(
            billing.db.text(
                "INSERT INTO invoice (id, invoice_number, client_id, total) VALUES (1, 'INV-0001', 1, 10300)"
            )
        )
    billing._SCHEMA_OK = False
    billing.ensure_schema()
    assert billing.Invoice.query.first().total == 10300
    assert billing.Invoice.query.first().submission_key is None
    assert billing.Payment.query.count() == 0


def simultaneous_posts(path, payloads):
    """Separate sessions model two devices submitting at the same time."""
    barrier = Barrier(2)

    def submit(data):
        with billing.app.test_client() as client:
            with client.session_transaction() as session:
                session["user_id"] = 1
            barrier.wait(timeout=5)
            return client.post(path, data=data).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        return sorted(pool.map(submit, payloads))


def test_two_devices_cannot_sell_the_last_piece_twice(shop):
    _client, customer, product = shop
    product.stock_quantity = 1
    billing.db.session.commit()
    assert simultaneous_posts("/invoices/create", [sale(customer), sale(customer)]) == [302, 422]
    billing.db.session.expire_all()
    assert billing.Invoice.query.count() == 1
    assert billing.db.session.get(billing.Product, product.id).stock_quantity == 0


def test_two_devices_cannot_overcollect(shop):
    client, customer, _product = shop
    client.post("/invoices/create", data=sale(customer, payment_type="partial", partial_amount="0"))
    invoice = billing.Invoice.query.first()
    payloads = [
        {"amount": "70", "payment_method": "cash", "submission_key": uuid.uuid4().hex}
        for _ in range(2)
    ]
    assert simultaneous_posts(f"/invoices/{invoice.id}/payment", payloads) == [302, 422]
    billing.db.session.expire_all()
    assert billing.invoice_paid_total(invoice.id) == 7000
    assert billing.db.session.get(billing.Client, customer.id).balance == 3815


# Every accepted original transaction is compared with both the new preview and checkout.
# The reference is the frozen original app at commit 007cfc1, not the nearby V1 folder.
_REFERENCE = None


@pytest.mark.parametrize(
    "case",
    [
        "gold-default",
        "gold-zero",
        "gold-custom",
        "gold-flat",
        "silver-flat",
        "silver-percent",
        "general",
        "fractional-general",
        "weighted",
        "multiple",
        "percent-discount",
        "flat-discount",
        "exchange",
        "legacy-exchange",
        "partial-payment",
        "credit-sale",
        "no-gst",
        "rounding",
        "zero-discount",
        "full-discount",
    ],
)
def test_original_checkout_and_server_preview_agree(shop, case):
    global _REFERENCE
    if _REFERENCE is None:
        from original_reference import load_reference

        _REFERENCE = load_reference()
    reference = _REFERENCE
    client, customer, product = shop
    settings = billing.Settings.query.first()
    settings.silver_manual_price = 9300
    data = sale(customer)
    if case == "gold-default":
        data["making_charges"] = [""]
    if case == "gold-custom":
        data["making_charges"] = ["7.25"]
    if case == "gold-flat":
        data.update(making_mode=["flat"], making_charges=["2.35"])
    if case.startswith("silver"):
        product.item_type = "silver"
        data.update(
            item_type=["silver"],
            making_mode=["percent" if case.endswith("percent") else "flat"],
            making_charges=["6.5" if case.endswith("percent") else "12.5"],
        )
    if case in ("general", "fractional-general"):
        data.update(
            item_type=["general"],
            product_code=[""],
            unit_price=["1.06"],
            quantity=["0.25" if case.startswith("fractional") else "2"],
        )
    if case == "weighted":
        product.unit = "g"
        product.stock_weight = 50
        data.update(quantity=["2.375"], weight=["1"])
    if case == "multiple":
        for key in [
            "description",
            "quantity",
            "item_type",
            "weight",
            "unit_price",
            "making_charges",
            "making_mode",
            "product_code",
        ]:
            data[key] = data[key] * 2
    if case == "percent-discount":
        data.update(discount_type="percent", discount_value="7.25")
    if case == "flat-discount":
        data.update(discount_type="flat", discount_value="8.73")
    if case == "exchange":
        data.update(exchange_metal="gold", exchange_amount="15.31")
    if case == "legacy-exchange":
        data.update(exchange_metal="silver", exchange_weight="0.5", exchange_rate="9.3")
    if case == "partial-payment":
        data.update(payment_type="partial", partial_amount="20.17")
    if case == "credit-sale":
        data.update(payment_type="partial", partial_amount="0")
    if case == "no-gst":
        settings.gst_enabled = False
    if case == "rounding":
        data.update(weight=["1.005"], making_charges=["2.5"])
    if case == "zero-discount":
        data.update(discount_type="percent", discount_value="0")
    if case == "full-discount":
        data.update(discount_type="percent", discount_value="100")
    billing.db.session.commit()
    customer_values = {"id": customer.id, "name": customer.name, "phone": customer.phone}
    product_values = {
        column.name: getattr(product, column.name) for column in reference.Product.__table__.columns
    }
    setting_values = {
        column.name: getattr(settings, column.name)
        for column in reference.Settings.__table__.columns
    }
    with reference.app.app_context():
        reference.db.session.remove()
        reference.db.drop_all()
        reference.db.create_all()
        reference._SCHEMA_OK = True
        owner = reference.User(username="ref", email="ref@example.invalid", is_admin=True)
        owner.set_password("test-password")
        ref_customer = reference.Client(**customer_values)
        ref_product = reference.Product(**product_values)
        ref_settings = reference.Settings(**setting_values)
        reference.db.session.add_all([owner, ref_customer, ref_product, ref_settings])
        reference.db.session.commit()
        baseline_client = reference.app.test_client()
        with baseline_client.session_transaction() as session:
            session["user_id"] = owner.id
        assert baseline_client.post("/invoices/create", data=data).status_code == 302
        baseline = reference.Invoice.query.first()
        assert baseline is not None
        expected = {
            name: getattr(baseline, name)
            for name in [
                "subtotal",
                "gst_amount",
                "discount_amount",
                "exchange_amount",
                "total",
                "status",
            ]
        }
        expected_items = [
            (line.line_total, line.making_charges, line.unit_price) for line in baseline.items
        ]
        expected_balance = ref_customer.balance
    preview = client.post("/api/invoices/preview", data=data)
    assert preview.status_code == 200, preview.data
    assert preview.json["total"] == expected["total"]
    assert preview.json["subtotal"] == expected["subtotal"]
    assert preview.json["gst"] == expected["gst_amount"]
    assert preview.json["discount"] == expected["discount_amount"]
    assert preview.json["exchange"] == expected["exchange_amount"]
    assert [
        (line["total"], line["making_used"], line["unit_price"]) for line in preview.json["lines"]
    ] == expected_items
    assert client.post("/invoices/create", data=data).status_code == 302
    actual = billing.Invoice.query.first()
    assert {name: getattr(actual, name) for name in expected} == expected
    assert billing.db.session.get(billing.Client, customer.id).balance == expected_balance
    assert [
        (line.line_total, line.making_charges, line.unit_price) for line in actual.items
    ] == expected_items


@pytest.mark.parametrize(
    "name",
    [
        "calc_line_total",
        "metal_unit_paise",
        "effective_metal_price",
        "making_basis",
        "default_making",
        "calc_discount",
        "calc_exchange",
        "validate_rs",
        "validate_positive",
    ],
)
def test_original_calculation_functions_are_preserved(name):
    import ast
    import inspect
    from pathlib import Path

    frozen = (Path(__file__).parent / "fixtures" / "original_app.py.txt").read_text(
        encoding="utf-8"
    )
    original = next(
        node
        for node in ast.parse(frozen).body
        if isinstance(node, ast.FunctionDef) and node.name == name
    )
    current = ast.parse(inspect.getsource(getattr(billing, name))).body[0]
    assert ast.dump(current, include_attributes=False) == ast.dump(
        original, include_attributes=False
    )


def test_preview_does_not_write_a_transaction(shop):
    client, customer, product = shop
    assert client.post("/api/invoices/preview", data=sale(customer)).status_code == 200
    assert billing.Invoice.query.count() == billing.Payment.query.count() == 0
    assert billing.db.session.get(billing.Product, product.id).stock_quantity == 5
    assert billing.db.session.get(billing.Client, customer.id).balance == 0


def test_style_bundle_matches_sources():
    from pathlib import Path

    folder = Path(__file__).resolve().parents[1] / "static" / "css"
    expected = "/* Generated by scripts/build_styles.py. Edit source styles, then rebuild. */\n"
    for name in ["components.css", "responsive.css", "premium.css", "scanner.css"]:
        expected += f"\n/* ===== {name} ===== */\n" + (folder / name).read_text(encoding="utf-8")
    assert (folder / "app.css").read_text(encoding="utf-8") == expected


@pytest.mark.parametrize("code", ["SUPPLIER-QR-104", "https://supplier.example/item/104"])
def test_existing_product_qr_can_be_scanned(shop, code):
    client, _, _ = shop
    response = client.post(
        "/products/add",
        data={
            "name": "Supplier ring",
            "item_type": "gold",
            "unit": "pcs",
            "weight_per_unit": "2",
            "stock_quantity": "3",
            "existing_code": code,
        },
    )
    assert response.status_code == 302
    product = billing.Product.query.filter_by(barcode=code).one()
    result = client.get("/products/scan/" + code).get_json()
    assert result["success"]
    assert result["product"]["id"] == product.id


def test_duplicate_existing_qr_keeps_form_values(shop):
    client, _, product = shop
    response = client.post(
        "/products/add",
        data={
            "name": "Keep my details",
            "item_type": "gold",
            "unit": "pcs",
            "weight_per_unit": "2",
            "existing_code": product.barcode,
        },
    )
    assert response.status_code == 400
    assert b"already belongs to another product" in response.data
    assert b"Keep my details" in response.data
    assert billing.Product.query.count() == 1


def test_product_without_existing_qr_gets_generated_code(shop):
    client, _, _ = shop
    response = client.post(
        "/products/add",
        data={
            "name": "New label ring",
            "item_type": "gold",
            "unit": "pcs",
            "weight_per_unit": "2",
        },
    )
    assert response.status_code == 302
    assert billing.Product.query.filter_by(name="New label ring").one().barcode.startswith("JWL-")
