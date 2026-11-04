# Gold & Silver Billing — improved build

Flask billing app for a jewellery shop. Integer-paise money model, GST on metal lines,
live metal rates, product/stock, client ledger, reports and audit log.

## Run it

```bash
pip install -r requirements.txt
cp .env.example .env          # set SECRET_KEY, DATABASE_URL, SHOP_TZ
python init_db.py             # creates tables + first admin (safe: refuses to wipe data)
python app.py                 # http://127.0.0.1:5000
```

`python app.py` starts a local server on `127.0.0.1` only. Open
`http://localhost:5000` (also suitable for local passkey testing). It uses HTTP
cookies and a unique persisted local signing key when the configured key is weak.
It does not edit `.env`. Production runs through a WSGI server and keeps strict
secret/HTTPS checks. The direct local server is not exposed to other devices.

Docker:

```bash
docker build -t billing .
docker run -p 5000:5000 -e SECRET_KEY=... -v billing_data:/app/instance billing
```

## Environment

| Variable | Default | Notes |
|---|---|---|
| `SECRET_KEY` | dev default | **Required in production** — boot fails if left at the dev value |
| `DATABASE_URL` | `sqlite:///billing.db` | Stored in Flask's instance folder; Postgres works too |
| `SHOP_TZ` | `Asia/Kolkata` | All timestamps stored in shop-local time |
| `FLASK_ENV` | unset | Production WSGI startup enforces strong secrets and HTTPS cookies |
| `TRUST_PROXY` | `0` | Set `1` only behind a trusted reverse proxy |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_SECONDS` | `10` / `900` | Login throttling |

`.env` is loaded automatically (real env vars win).

## What changed in this build

* **Bug fixes** — cancel-then-delete no longer reverses stock twice; client credit limit is
  stored in paise, not rupees; timestamps are shop-local instead of UTC; cancelled bills can't
  collect payments; invoice numbers are monotonic (never reused after a delete).
* **Reports** — cancelled bills excluded from sales/profit; gross and net profit shown
  separately with margin %.
* **UI** — one design system in `templates/base.html`: sticky header, stat cards, badges,
  toasts, mobile nav, print-friendly bills. Cancel/Delete actions are now reachable from the
  bills, client and product pages with confirm guards.
* **Ops** — no more Flask-Migrate (unused), `.dockerignore`, non-root container, single gunicorn
  worker (SQLite), health check at `/healthz`, `init_db.py` refuses to wipe a live database.
* **Security** — production refuses the default `SECRET_KEY`, per-IP **and** per-account login
  throttling, CSRF on every POST.

GST rules and metal-rate pricing are untouched.

## Tests

```bash
python -m pytest    # isolated tests, including frozen-original calculation comparisons
```

The responsive update adapts billing, record lists, forms and document controls for
PC, tablet and phone. It adds recoverable checkout drafts, customer creation during
billing, clearer payment summaries and retry protection. See [RESPONSIVE-UX.md](RESPONSIVE-UX.md)
for the changes, browser checks and the real-device acceptance checklist.


## Premium interface and original calculations

The 31 October redesign restores the pre-change project calculation rules from
commit `007cfc1`. Bill previews now use those server rules across all devices.
Shared screen styles are bundled locally; fonts and the QR/barcode decoder are
served with the application. Rebuild styles after editing them:

```bash
python scripts/build_styles.py
```

See [PREMIUM-REDESIGN.md](PREMIUM-REDESIGN.md) for scope, scanner behaviour,
verification evidence, asset notices and real-device acceptance checks.

## Passkeys and security update

See [SECURITY-IMPLEMENTATION.md](SECURITY-IMPLEMENTATION.md) for passkey setup,
owner/cashier permissions, safe SQLite recovery, security settings and verification.
Passkeys require a stable trusted HTTPS hostname on customer devices. Local
`http://localhost` works for development. Install the updated requirements before
restarting; Windows shared database locks require the portalocker win32 extra.
