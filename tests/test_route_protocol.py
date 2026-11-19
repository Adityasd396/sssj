# ruff: noqa: F811
import inspect
import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path.cwd() / "tests"))
from test_workflows import billing, sale, shop  # noqa: F401


@pytest.fixture(autouse=True)
def backup_isolation(tmp_path, monkeypatch):
    monkeypatch.setattr(billing.app, "instance_path", str(tmp_path))


def test_inventory(shop):
    client, customer, _ = shop
    client.post("/invoices/create", data=sale(customer))
    rows = []
    checks = []
    for rule in sorted(billing.app.url_map.iter_rules(), key=lambda r: r.rule):
        view = billing.app.view_functions[rule.endpoint]
        original = inspect.unwrap(view)
        source = inspect.getsource(view)
        access = (
            "owner"
            if "@admin_required" in source
            else "signed-in"
            if "@login_required" in source
            else "public"
        )
        if rule.endpoint in billing.SHARED_INVOICE_ENDPOINTS:
            access = "signed token"
        rows.append(
            {
                "route": rule.rule,
                "endpoint": rule.endpoint,
                "methods": sorted(rule.methods),
                "access": access,
                "file": str(Path(inspect.getsourcefile(original)).name),
                "line": inspect.getsourcelines(original)[1],
            }
        )
        if rule.endpoint == "static":
            url = "/static/favicon.svg"
        else:
            url = re.sub(
                r"<(?:[^:>]+:)?([^>]+)>",
                lambda m: (
                    "invalid" if m[1] == "token" else ("TEST-CODE" if m[1] == "barcode" else "1")
                ),
                rule.rule,
            )
        for method in ["HEAD", "OPTIONS"]:
            if method not in rule.methods:
                continue
            r = client.open(url, method=method)
            checks.append({"route": rule.rule, "method": method, "status": r.status_code})
            assert r.status_code < 500, (url, method, r.status_code)
            if method == "HEAD":
                assert len(r.data) == 0
    Path(".cache/route-audit-fixed").mkdir(parents=True, exist_ok=True)
    Path(".cache/route-audit-fixed/inventory.json").write_text(json.dumps(rows, indent=2))
    Path(".cache/route-audit-fixed/protocol.json").write_text(json.dumps(checks, indent=2))
    anon = billing.app.test_client()
    assert anon.get("/static/favicon.svg").status_code == 200
    assert anon.get("/static/../app.py").status_code == 404
    protected = [r for r in rows if r["access"] == "owner"]
    for row in protected:
        view_user = billing.User.query.first()
        view_user.is_admin = False
        billing.db.session.commit()
        route = next(r for r in billing.app.url_map.iter_rules() if r.rule == row["route"])
        url = re.sub(r"<[^>]+>", "1", row["route"])
        method = "GET" if "GET" in route.methods else "POST"
        assert client.open(url, method=method).status_code == 403
