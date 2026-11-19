# ruff: noqa: F811
"""Permanent short customer links use synthetic invoices, never production data."""

import re
from unittest.mock import patch

import pytest
from test_workflows import billing, sale, shop  # noqa: F401

from invoice_sharing import share_token, short_share_token


def test_short_link_stable_private_and_non_expiring(shop):
    client, customer, _ = shop
    client.post("/invoices/create", data=sale(customer))
    invoice = billing.Invoice.query.first()
    token = short_share_token(billing.app, invoice)
    assert re.fullmatch(r"[0-9a-z]+\.[A-Za-z0-9_-]{22}", token) and len(token) < 40
    assert invoice.invoice_number not in token and customer.phone not in token
    with patch("time.time", return_value=10_000_000_000):
        assert short_share_token(billing.app, invoice) == token
        visitor = billing.app.test_client()
        response = visitor.get("/b/" + token)
        assert response.status_code == 200 and b"Download bill (PDF)" in response.data
    assert b"48 hours" not in client.get(f"/invoices/{invoice.id}").data
    assert visitor.get(f"/invoices/{invoice.id}/pdf").status_code == 302
    for path in ["/b/" + token, "/b/" + token + "/pdf"]:
        r = visitor.get(path)
        assert r.status_code == 200
        assert r.headers["Cache-Control"] == "no-store"
        assert r.headers["Referrer-Policy"] == "no-referrer"
        assert "noindex" in r.headers["X-Robots-Tag"]


@pytest.mark.parametrize(
    "token",
    ["invalid", "1." + "A" * 22, "z" * 13 + "." + "A" * 22, "1." + "A" * 1000, "0." + "A" * 22],
)
def test_short_link_rejects_invalid_tokens_without_login(shop, token):
    visitor = billing.app.test_client()
    for path in ["/b/" + token, "/b/" + token + "/pdf"]:
        response = visitor.get(path)
        assert response.status_code == 410 and response.headers["Cache-Control"] == "no-store"


def test_short_link_cannot_open_another_or_reused_invoice(shop):
    client, customer, _ = shop
    client.post("/invoices/create", data=sale(customer))
    first = billing.Invoice.query.first()
    token = short_share_token(billing.app, first)
    client.post("/invoices/create", data=sale(customer))
    second = billing.Invoice.query.order_by(billing.Invoice.id.desc()).first()
    forged = str(second.id) + "." + token.split(".")[1]
    visitor = billing.app.test_client()
    assert visitor.get("/b/" + forged).status_code == 410
    client.post(f"/invoices/{first.id}/delete")
    assert visitor.get("/b/" + token).status_code == 410
    assert visitor.get("/b/" + token + "/pdf").status_code == 410


def test_old_long_links_no_longer_expire_and_downloads_match(shop):
    client, customer, _ = shop
    client.post("/invoices/create", data=sale(customer))
    invoice = billing.Invoice.query.first()
    with patch("itsdangerous.timed.TimestampSigner.get_timestamp", return_value=1000):
        legacy = share_token(billing.app, invoice)
    visitor = billing.app.test_client()
    old = visitor.get("/shared/bill/" + legacy + ".pdf")
    assert old.status_code == 200 and old.data.startswith(b"%PDF")
    token = short_share_token(billing.app, invoice)
    pdf = visitor.get("/b/" + token + "/pdf")
    assert pdf.status_code == 200 and pdf.data.startswith(b"%PDF")
    assert (
        pdf.headers["Content-Disposition"] == f'attachment; filename="{invoice.invoice_number}.pdf"'
    )
    assert (
        client.get(f"/invoices/{invoice.id}/pdf?download=1")
        .headers["Content-Disposition"]
        .startswith("attachment;")
    )
    with patch.dict(billing.app.config, SECRET_KEY="different-key-for-test"):
        assert billing.app.test_client().get("/b/" + token).status_code == 410


def test_shared_page_escapes_data_and_ignores_account_session_requirement(shop):
    client, customer, _ = shop
    client.post("/invoices/create", data=sale(customer, description=["<script>alert(1)</script>"]))
    invoice = billing.Invoice.query.first()
    token = short_share_token(billing.app, invoice)
    user = billing.User.query.first()
    user.must_change_password = True
    billing.db.session.commit()
    response = client.get("/b/" + token)
    assert response.status_code == 200
    assert b"<script>alert(1)</script>" not in response.data and b"&lt;script&gt;" in response.data
    assert b"/logout" not in response.data
