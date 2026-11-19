# ruff: noqa: F811
import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path.cwd() / "tests"))
from test_workflows import billing, sale, shop  # noqa: F401

rules = sorted(
    [r for r in billing.app.url_map.iter_rules() if r.endpoint != "static"], key=lambda r: r.rule
)
cases = [
    (r.rule, r.endpoint, m, role)
    for r in rules
    for m in sorted(r.methods - {"HEAD", "OPTIONS"})
    for role in ["anonymous", "cashier", "owner"]
]
results = []
public = {
    "login",
    "healthz",
    "shared_invoice_pdf",
    "shared_invoice_page",
    "shared_short_invoice_pdf",
    "passkey_login_options",
    "passkey_login_verify",
    "logout",
}


def path_for(rule, missing=False):
    return re.sub(
        r"<(?:[^:>]+:)?([^>]+)>",
        lambda m: (
            "invalid"
            if m[1] == "token"
            else ("TEST-CODE" if m[1] == "barcode" else ("999999" if missing else "1"))
        ),
        rule,
    )


@pytest.fixture(autouse=True)
def backup_isolation(tmp_path, monkeypatch):
    monkeypatch.setattr(billing.app, "instance_path", str(tmp_path))


@pytest.mark.parametrize("rule,endpoint,method,role", cases)
def test_routes(shop, rule, endpoint, method, role):
    owner, customer, _product = shop
    owner.post("/invoices/create", data=sale(customer, payment_type="partial", partial_amount="0"))
    # A valid archived row without deleting the active test invoice.
    bill = billing.Invoice.query.first()
    with billing.app.test_request_context("/"):
        billing.archive_deleted_invoice(
            bill, reason="Synthetic audit", stock_reversed=False, paid=0
        )
    billing.db.session.commit()
    client = owner
    if role == "anonymous":
        client = billing.app.test_client()
    elif role == "cashier":
        user = billing.User.query.first()
        user.is_admin = False
        billing.db.session.commit()
    url = path_for(rule)
    row = {"route": rule, "endpoint": endpoint, "method": method, "role": role, "url": url}
    try:
        response = client.open(url, method=method)
        row.update(status=response.status_code, location=response.location)
        if response.status_code >= 500:
            row["body"] = response.get_data(as_text=True)[:500]
    except Exception as exc:
        row.update(status=500, error=type(exc).__name__ + ": " + str(exc))
    results.append(row)
    Path(".cache/route-audit-fixed").mkdir(parents=True, exist_ok=True)
    Path(".cache/route-audit-fixed/matrix.json").write_text(json.dumps(results, indent=2))
    assert row["status"] < 500, row
    if role == "anonymous" and endpoint not in public:
        assert row["status"] in (302, 401, 403, 404), row
    if (
        role == "owner"
        and method == "GET"
        and endpoint
        not in {
            "shared_invoice_pdf",
            "shared_invoice_page",
            "shared_short_invoice_pdf",
            "scan_product",
        }
    ):
        assert row["status"] in (200, 302), row


@pytest.mark.parametrize(
    "rule,endpoint,method",
    [(r.rule, r.endpoint, m) for r in rules for m in r.methods - {"GET", "HEAD", "OPTIONS"}],
)
def test_csrf(shop, rule, endpoint, method):
    client, _, _ = shop
    billing.app.config["WTF_CSRF_ENABLED"] = True
    response = client.open(path_for(rule), method=method)
    assert response.status_code == 400, (rule, response.status_code)
