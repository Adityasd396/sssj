# Gold & Silver Billing — improved build

Flask billing app for a jewellery shop. Integer-paise money model, GST on metal lines,
live metal rates, product/stock, client ledger, reports and audit log.

## Updating an existing shop

Latest release: [Counter UI and mobile usability — 23 November 2026](reports/counter-ux-2026-11-23/RELEASE-REPORT.md). Includes larger readable forms, compact inventory filters, clear bill verification, and searchable customer histories. Existing database and V1 calculations are preserved.

For the 17 November workflow update, replace code/assets only and reload the app.
Keep your existing `.env`, `instance` directory and DATABASE_URL. Do not initialize,
restore or replace the shop database. This update adds no schema changes.
See [WORKFLOW-RELIABILITY-2026-11-17.md](WORKFLOW-RELIABILITY-2026-11-17.md)
for changes, test results, WhatsApp behavior and printer setup.

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

## Android and iPhone browser experience

The 17 November mobile update adds guided billing, compact item details, keyboard
clearance, recoverable device drafts, list-position restoration and device-specific
receipt paper preferences. See [MOBILE-EXPERIENCE-2026-11-17.md](MOBILE-EXPERIENCE-2026-11-17.md)
for behavior, storage/privacy limits, verification and device acceptance checks.

For an existing shop, deploy code and assets only: preserve the current database,
instance folder and environment settings. Do not run `init_db.py` for this update.
Reload the hosted application and refresh browser assets after deployment.


## Route reliability fixes — 18 November 2026

See [the release verification report](reports/route-fixes-2026-11-18/RELEASE-REPORT.md)
for the audit resolutions, route coverage and preserved database/V1 pricing rules.
Deploy source and assets over the existing shop while keeping its database,
instance folder and environment settings. No database initializer or migration is
needed. Reload the hosted application and refresh browser tabs.

Customer lookup and tag selection now use bounded searches/pages. New retained
server backups use a protected POST action and keep the latest five snapshots;
ordinary downloads leave no retained copy, and recovery/legacy copies are preserved.


## Inventory and per-bill rates — 19 November 2026

See [the latest release report](reports/inventory-rates-2026-11-19/RELEASE-REPORT.md).
This update adds stock-level filters, whole-inventory metal totals, saved category
suggestions and owner-only bill-specific rates using existing invoice fields.
QR review sorting is based on code format because historical scan provenance is
not stored. No schema change or migration is required; preserve the current
database, instance folder and .env, then reload the app and refresh browser tabs.


## Short permanent customer bill links — 19 November 2026

New WhatsApp messages use short signed `/b/<code>` links. They open a responsive
customer bill page with a **Download bill (PDF)** button at the bottom. The shop's
own bill page also has a bottom download action. Existing long PDF links remain
supported and no longer have a 48-hour limit.

Links have no time-based expiry. Preserve the same public domain, SECRET_KEY and
bill records for continued access. Deleting a bill or changing the signing key
makes its link unavailable. No URL-shortening service, new database field or
migration is required. See [the sharing release report](reports/permanent-sharing-2026-11-19/RELEASE-REPORT.md).


## Low-end phone/server update — 22 November 2026

See [the performance release report](reports/low-end-performance-2026-11-20/RELEASE-REPORT.md).
Collections, bill lists and customer histories use batched queries. Scanning is
inline and automatic, with worker decoding and supported autofocus controls;
photo/code fallbacks remain available. Empty bills avoid preview traffic.

Public assets include prebuilt gzip variants verified by asset_delivery.py. Deploy
all source/assets, keep the existing database, instance folder and .env, and reload
the web app. No database initialization or migration is required. After editing
assets or checking out with changed line endings, rebuild styles with
`python scripts/build_styles.py`, then run `python scripts/build_assets.py`.
