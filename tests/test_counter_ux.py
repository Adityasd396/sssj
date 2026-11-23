# ruff: noqa: F811
"""Presentation-only UX regressions against temporary shop records."""

from datetime import timedelta

from flask import template_rendered
from test_workflows import billing, shop  # noqa: F401


def test_history_pages_search_and_full_statement_preserve_totals(shop):
    client, customer, _ = shop
    for i in range(80):
        invoice = billing.Invoice(
            invoice_number=f"UX-BILL-{i:03}",
            client_id=customer.id,
            total=12345,
            subtotal=12345,
            status="pending",
            date_created=billing.utcnow() + timedelta(seconds=i),
        )
        billing.db.session.add(invoice)
        billing.db.session.flush()
        billing.db.session.add(
            billing.Payment(
                invoice_id=invoice.id,
                client_id=customer.id,
                amount=345,
                payment_method="cash",
                notes=f"Deposit {i}",
            )
        )
        billing.db.session.add(
            billing.InvoiceItem(
                invoice_id=invoice.id,
                description=f"Ring {i}",
                item_type="gold",
                quantity=1,
                weight=1,
                unit_price=12345,
                line_total=12345,
            )
        )
    customer.total_purchases = 80 * 12345
    customer.total_payments = 80 * 345
    customer.balance = 80 * 12000
    billing.db.session.commit()
    values = (customer.total_purchases, customer.total_payments, customer.balance)
    contexts = []

    def capture(sender, template, context, **kwargs):
        contexts.append(context)

    with template_rendered.connected_to(capture, billing.app):
        response = client.get("/clients/1")
        assert response.status_code == 200
        context = contexts[-1]
        assert len(context["invoices"]) == 80 and len(context["payments"]) == 80
        assert (
            len(context["history_invoices"])
            == len(context["history_payments"])
            == len(context["history_metal_lines"])
            == 25
        )
        first = {i.id for i in context["history_invoices"]}
        assert context["history_pages"]["bills"] == {"page": 1, "pages": 4, "total": 80}
        assert client.get("/clients/1?bills_page=2").status_code == 200
        assert not first & {i.id for i in contexts[-1]["history_invoices"]}
        assert client.get("/clients/1?history_q=UX-BILL-00").status_code == 200
        context = contexts[-1]
        assert context["history_pages"]["bills"]["total"] == 10
        assert context["history_pages"]["payments"]["total"] == 10
        assert context["history_pages"]["items"]["total"] == 10
        assert len(context["invoices"]) == 80
        assert client.get("/clients/1?bills_page=" + "9" * 100).status_code == 200
        assert contexts[-1]["history_pages"]["bills"]["page"] == 4
        statement = client.get("/clients/1/statement")
        assert (
            statement.status_code == 200
            and b"UX-BILL-000" in statement.data
            and b"UX-BILL-079" in statement.data
        )
    billing.db.session.expire_all()
    customer = billing.Client.query.get(1)
    assert values == (customer.total_purchases, customer.total_payments, customer.balance)


def test_inventory_filters_explicit_and_totals_still_present(shop):
    client, _, product = shop
    product.category = "Client category"
    billing.db.session.commit()
    response = client.get("/products")
    assert response.status_code == 200
    assert b'onchange="this.form.submit()"' not in response.data
    assert b'id="inventory-filters" >' in response.data
    assert b"compact-metrics" in response.data and b"Gold <b>1</b>" in response.data
    filtered = client.get("/products?cat=Client+category&sort=recent")
    assert b'id="inventory-filters" open' in filtered.data and b"Client category" in filtered.data


def test_customer_financial_labels_show_exact_balance_and_owner_actions(shop):
    client, customer, _ = shop
    customer.total_purchases = 12345
    customer.balance = 12345
    billing.db.session.commit()
    response = client.get("/clients/1")
    assert b"123.45" in response.data and b"Account balance" in response.data
    owner = billing.User.query.first()
    owner.is_admin = False
    billing.db.session.commit()
    assert b'action="/clients/1/delete"' not in client.get("/clients/1").data


def test_bill_rates_collapsible_and_account_scope_explicit(shop):
    client, _, _ = shop
    response = client.get("/invoices/create")
    assert response.status_code == 200
    assert b'<details class="bill-rate-controls" id="bill-rates">' in response.data
    assert b"Existing account balance" in response.data
    assert "This bill’s balance after payment" in response.get_data(as_text=True)
    assert b'type="submit"' in response.data
