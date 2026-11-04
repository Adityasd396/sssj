# ruff: noqa: F811
"""Security and recovery regressions. Every database contains synthetic data only."""

import io
import re
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import portalocker
import pytest
from test_workflows import billing, sale, shop  # noqa: F401 - shared isolated fixture


@pytest.fixture(autouse=True)
def isolated_backups(tmp_path, monkeypatch):
    monkeypatch.setattr(billing.app, "instance_path", str(tmp_path))


def test_password_reset_revokes_old_sessions_and_passkeys(shop):
    client, _, _ = shop
    user = billing.User.query.first()
    billing.db.session.add(
        billing.Passkey(
            user_id=user.id,
            credential_id="fake",
            public_key=b"fake",
            user_handle=b"handle",
            sign_count=0,
            name="Lost device",
        )
    )
    billing.db.session.commit()
    old = billing.app.test_client()
    with old.session_transaction() as session:
        session["user_id"] = user.id
    assert (
        client.post(
            f"/users/{user.id}/reset-password", data={"new_password": "replacement-password"}
        ).status_code
        == 302
    )
    assert old.get("/products").location.endswith("/login")
    assert billing.Passkey.query.count() == 0


@pytest.mark.parametrize(
    "path",
    [
        "/settings",
        "/prices/quick",
        "/products/add",
        "/products/1/edit",
        "/products/1/delete",
        "/invoices/1/delete",
        "/invoices/1/update_status",
        "/backup/restore",
    ],
)
def test_cashier_cannot_perform_owner_actions(shop, path):
    client, _, _ = shop
    user = billing.User.query.first()
    user.is_admin = False
    billing.db.session.commit()
    assert client.post(path, data={"status": "cancelled"}).status_code == 403
    assert client.get("/invoices/create").status_code == 200


def test_non_finite_stock_and_direct_checkout_rejected(shop):
    client, customer, _ = shop
    for value in ["nan", "inf", "1e309", "1000000001"]:
        assert (
            client.post(
                "/products/add", data={"name": "Invalid", "stock_weight": value}
            ).status_code
            == 422
        )
        assert (
            client.post("/invoices/create", data=sale(customer, quantity=[value])).status_code
            == 422
        )
    assert billing.Product.query.count() == 1
    assert billing.Invoice.query.count() == 0


def test_csv_formula_export_is_text(shop):
    client, customer, _ = shop
    customer.name = "=1+1"
    billing.db.session.commit()
    client.post("/invoices/create", data=sale(customer))
    output = client.get("/export/invoices.csv").data.decode()
    assert "'=1+1" in output


def test_stale_stock_edit_cannot_overwrite_sale(shop):
    client, customer, product = shop
    pid = product.id
    page = client.get(f"/products/{pid}/edit").data.decode()
    version = re.search(r'name="stock_version" value="(\d+)"', page)[1]
    client.post("/invoices/create", data=sale(customer))
    response = client.post(
        f"/products/{pid}/edit",
        data={
            "stock_version": version,
            "name": "Stale",
            "stock_quantity": "5",
            "weight_per_unit": "1",
        },
    )
    assert response.status_code == 409
    assert billing.db.session.get(billing.Product, pid).stock_quantity == 4


def test_backup_is_valid_and_restore_revokes_sessions(shop):
    client, customer, _ = shop
    cid = customer.id
    backup = client.get("/backup/download")
    assert backup.status_code == 200 and backup.data.startswith(b"SQLite format 3")
    customer = billing.db.session.get(billing.Client, cid)
    customer.name = "Changed"
    billing.db.session.commit()
    restored = client.post(
        "/backup/restore",
        data={"password": "test-password", "backup_file": (io.BytesIO(backup.data), "backup.db")},
    )
    assert restored.status_code == 302 and restored.location.endswith("/login")
    assert billing.db.session.get(billing.Client, cid).name == "Sample customer"
    assert client.get("/products").location.endswith("/login")


def test_corrupt_restore_leaves_database_intact(shop):
    client, customer, _ = shop
    cid = customer.id
    client.post(
        "/backup/restore",
        data={"password": "test-password", "backup_file": (io.BytesIO(b"not sqlite"), "bad.db")},
    )
    assert billing.db.session.get(billing.Client, cid).name == "Sample customer"
    assert billing.User.query.count() == 1


def test_restore_failure_after_copy_rolls_back(shop, monkeypatch):
    client, customer, _ = shop
    cid = customer.id
    backup = client.get("/backup/download").data
    customer = billing.db.session.get(billing.Client, cid)
    customer.name = "Latest data"
    billing.db.session.commit()
    engine = billing.db.engine
    actual = engine.dispose
    calls = []

    def fail_once():
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("Synthetic failure after copy")
        actual()

    monkeypatch.setattr(engine, "dispose", fail_once)
    client.post(
        "/backup/restore",
        data={"password": "test-password", "backup_file": (io.BytesIO(backup), "backup.db")},
    )
    assert billing.db.session.get(billing.Client, cid).name == "Latest data"


def test_active_request_lock_blocks_restore(shop):
    client, _, _ = shop
    lock_path = billing.db.engine.url.database + ".maintenance.lock"
    with open(lock_path, "a+b") as handle:
        portalocker.lock(handle, portalocker.LOCK_SH | portalocker.LOCK_NB)
        try:
            response = client.post("/backup/restore", data={"password": "test-password"})
            assert response.status_code == 503
        finally:
            portalocker.unlock(handle)


def test_cancel_and_payment_race_keeps_ledger_consistent(shop):
    client, customer, product = shop
    cid, pid = customer.id, product.id
    client.post("/invoices/create", data=sale(customer, payment_type="partial", partial_amount="0"))
    iid = billing.Invoice.query.first().id
    barrier = Barrier(2)

    def post(kind):
        with billing.app.test_client() as device:
            with device.session_transaction() as session:
                session["user_id"] = 1
            barrier.wait(timeout=5)
            return device.post(
                f"/invoices/{iid}/" + ("update_status" if kind == "cancel" else "payment"),
                data={"status": "cancelled"}
                if kind == "cancel"
                else {"amount": "1", "payment_method": "cash"},
            ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(post, ["cancel", "payment"]))
    assert all(s in (302, 422) for s in statuses)
    billing.db.session.expire_all()
    assert billing.db.session.get(billing.Invoice, iid).status == "cancelled"
    assert billing.Payment.query.count() == 0
    assert billing.db.session.get(billing.Product, pid).stock_quantity == 5
    assert billing.db.session.get(billing.Client, cid).balance == 0


def test_passkey_configuration_and_current_password_required(shop, monkeypatch):
    client, _, _ = shop
    monkeypatch.setenv("PASSKEY_ORIGIN", "https://shop.example")
    monkeypatch.setenv("PASSKEY_RP_ID", "shop.example")
    assert (
        client.post("/passkeys/register/options", json={"password": "test-password"}).status_code
        == 400
    )
    response = client.post(
        "/passkeys/register/options", base_url="https://shop.example", json={"password": "wrong"}
    )
    # Cookies are host-specific: a new origin has no existing account session.
    assert response.status_code in (302, 403)
    monkeypatch.delenv("PASSKEY_ORIGIN")
    monkeypatch.delenv("PASSKEY_RP_ID")
    with client.session_transaction() as session:
        session["user_id"] = 1
    response = client.post(
        "/passkeys/register/options", base_url="http://localhost", json={"password": "wrong"}
    )
    assert response.status_code == 403


def test_passkey_challenge_requires_same_session_and_is_one_use(shop):
    client, _, _ = shop
    response = client.post("/passkeys/login/options", base_url="http://localhost", json={})
    assert response.status_code == 200
    assert billing.PasskeyChallenge.query.count() == 1
    other = billing.app.test_client()
    assert (
        other.post("/passkeys/login/verify", base_url="http://localhost", json={}).status_code
        == 400
    )
    assert billing.PasskeyChallenge.query.count() == 1
    assert (
        client.post("/passkeys/login/verify", base_url="http://localhost", json={}).status_code
        == 400
    )
    assert billing.PasskeyChallenge.query.count() == 0
    assert (
        client.post("/passkeys/login/verify", base_url="http://localhost", json={}).status_code
        == 400
    )


def test_passkey_csrf_is_enforced(shop):
    client, _, _ = shop
    billing.app.config["WTF_CSRF_ENABLED"] = True
    try:
        assert client.post("/passkeys/login/options", json={}).status_code == 400
        assert billing.PasskeyChallenge.query.count() == 0
    finally:
        billing.app.config["WTF_CSRF_ENABLED"] = False


def test_default_password_requires_replacement(shop):
    client, _, _ = shop
    user = billing.User.query.first()
    user.password_hash = billing.generate_password_hash("admin123456")
    billing.db.session.commit()
    client.post("/logout")
    client.post("/login", data={"username": "owner", "password": "admin123456"})
    assert client.get("/products").location.endswith("/account/password")
    response = client.post(
        "/account/password",
        data={"new_password": "unique-long-password", "confirm_password": "unique-long-password"},
    )
    assert response.location.endswith("/account/passkeys")
    assert client.get("/products").status_code == 200


def test_passkey_challenge_expires(shop):
    from datetime import timedelta

    client, _, _ = shop
    assert (
        client.post("/passkeys/login/options", base_url="http://localhost", json={}).status_code
        == 200
    )
    row = billing.PasskeyChallenge.query.one()
    row.expires = billing.utcnow() - timedelta(seconds=1)
    billing.db.session.commit()
    assert (
        client.post("/passkeys/login/verify", base_url="http://localhost", json={}).status_code
        == 400
    )


def test_new_security_columns_migrate_without_changing_money(shop):
    client, customer, product = shop
    pid = product.id
    client.post("/invoices/create", data=sale(customer))
    before_total = billing.Invoice.query.first().total
    billing.db.session.remove()
    with billing.db.engine.begin() as con:
        con.execute(billing.db.text("ALTER TABLE user DROP COLUMN auth_version"))
        con.execute(billing.db.text("ALTER TABLE user DROP COLUMN must_change_password"))
        con.execute(billing.db.text("ALTER TABLE product DROP COLUMN stock_version"))
    billing._SCHEMA_OK = False
    billing.ensure_schema()
    user = billing.User.query.first()
    assert user.auth_version == 0 and not user.must_change_password
    assert billing.db.session.get(billing.Product, pid).stock_version == 1
    assert billing.Settings.query.first().gold_manual_price == 10000
    assert billing.Invoice.query.first().total == before_total
    assert billing.db.session.execute(billing.db.text("PRAGMA foreign_key_check")).all() == []


def test_large_calculated_amount_cannot_overflow_database(shop):
    client, customer, product = shop
    before = product.stock_quantity
    response = client.post(
        "/invoices/create",
        data=sale(customer, quantity=["1000000000"], weight=["1000000000"], product_code=[""]),
    )
    assert response.status_code == 422
    assert billing.Invoice.query.count() == 0
    assert billing.Payment.query.count() == 0
    assert billing.db.session.get(billing.Product, product.id).stock_quantity == before
