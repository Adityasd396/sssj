"""Local UI test server with synthetic data. Never opens the shop database."""

import os
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
cache = ROOT / ".cache"
cache.mkdir(exist_ok=True)
os.environ["DATABASE_URL"] = "sqlite:///" + (cache / ("ui-" + uuid.uuid4().hex + ".db")).as_posix()
os.environ["SECRET_KEY"] = "local-ui-preview-only-not-a-production-secret"
os.environ["TRUST_PROXY"] = "0"
os.environ["FLASK_ENV"] = "development"
os.environ["SESSION_COOKIE_SECURE"] = "false"

import app as billing

billing.app.config["TEMPLATES_AUTO_RELOAD"] = True
billing.app.jinja_env.auto_reload = True

with billing.app.app_context():
    billing.db.create_all()
    owner = billing.User(username="ui-owner", email="ui@example.invalid", is_admin=True)
    owner.set_password("preview-password")
    billing.db.session.add(owner)
    billing.db.session.add(
        billing.Settings(
            firm_name="Sona Jewellery", gold_manual_price=725000, silver_manual_price=9500
        )
    )
    billing.db.session.add(
        billing.Client(name="Meera Sharma", phone="9000000000", gstin="27ABCDE1234F1Z5")
    )
    billing.db.session.add(billing.Client(name="Arjun Patel", phone="9000000001"))
    billing.db.session.add(
        billing.Product(
            name='Classic "Heritage" Ring',
            sku="GOLD-01",
            barcode="GOLD-01",
            category="Rings",
            item_type="gold",
            unit="pcs",
            weight_per_unit=2.125,
            unit_price=1540625,
            cost_price=1200000,
            stock_quantity=12,
        )
    )
    billing.db.session.add(
        billing.Product(
            name="Silver chain",
            sku="SILVER-01",
            barcode="SILVER-01",
            category="Chains",
            item_type="silver",
            unit="g",
            weight_per_unit=1,
            unit_price=9500,
            stock_weight=500,
            cost_price=7000,
        )
    )
    billing.db.session.commit()

if __name__ == "__main__":
    billing.app.run(
        host="127.0.0.1",
        port=int(os.environ.get("BILLING_PREVIEW_PORT", "56837")),
        debug=False,
        use_reloader=False,
    )
