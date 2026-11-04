# Billing Software — Improvement Review

> Reviewed build: `billing-software-IMPROVED-v4.zip`
> Scope: `app.py` (3,446 lines), `config.py`, `tests.py` (1,358 lines), 39 templates,
> Dockerfile, docs (`README/FIXES/REVIEW`).
>
> **Headline:** This is a genuinely well-engineered single-shop jewellery billing app.
> Integer-paise money, audit logging on every mutation, CSRF, login throttling,
> atomic invoice creation, monotonic invoice numbers, schema self-migration, and a
> hermetic test suite. The "obvious" bugs are already fixed. The improvements below
> are about taking it from "solid for one shop" to "safe to scale and maintain".

---

## 1. Security — good, with three real gaps

### 1.1 `logout` is a GET route (CSRF)
```python
@app.route("/logout")
def logout(): ...
```
A logged-in user viewing `<img src="/logout">` gets silently logged out. Every
other state-changing route is correctly POST + CSRF — this one slipped through.
**Fix:** make it `POST` with a CSRF token (a small form / fetch in the header).

### 1.2 No Content-Security-Policy
`_headers()` sets `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` — but no CSP.
Templates are full of inline `<script>` blocks, so a single unescaped input becomes
full XSS. A **nonce-based CSP** (`script-src 'self' 'nonce-...'`) plus Jinja's
autoescaping closes the biggest remaining web hole. While there, switch
`X-Frame-Options: DENY` to `Content-Security-Policy: frame-ancestors 'none'`
(XFO is deprecated).

### 1.3 Login throttle is in-process memory
```python
_LOGIN_ATTEMPTS: dict = {}     # module-level
```
This resets on every worker restart and is **per-worker** — the moment you move to
Postgres and raise `GUNICORN_WORKERS`, an attacker gets N× the attempts. It also
can't survive a deploy/restart. Move to a shared store (a `login_attempt` table or
Redis). The throttling *logic* (per-IP + per-account, windowed) is otherwise good.

### Smaller security items
- `.env.example` ships `SESSION_COOKIE_SECURE=false` next to `FLASK_ENV=production`. New
  operators copy it verbatim and ship insecure cookies over HTTP-to-prod. Add a
  prominent warning or default it to `true` and override down locally.
- `backup/restore` only checks that `invoice/client/product` tables exist. A crafted
  `.db` can inject a `user` row with a known password hash, then the admin logs in as
  that account. Consider re-hashing / forcing password reset on restored users, or at
  least logging it loudly.
- No HSTS header (`Strict-Transport-Security`). One line in `_headers()`.

---

## 2. Architecture — one 3,446-line file is the ceiling

`app.py` holds **models, pricing logic, schema migration, tag geometry/rendering,
every route, security plumbing, and template filters** in one file. It's well
commented, but it has crossed the size where onboarding and merge-conflicts hurt.

**Proposed split (no behaviour change):**
```
billing/
  __init__.py        # create_app() factory
  config.py
  models.py         # Settings, User, Client, Product, Invoice, ...
  extensions.py      # db = SQLAlchemy(), csrf = CSRFProtect()
  services/
    pricing.py       # calc_line_total, metal_unit_paise, making_basis, ...
    ledger.py        # invoice_paid_total, invoices_with_due, allocate_invoice_number
    schema.py        # ensure_schema(), paise rebuild, migration
    tags.py          # resolved_tag_geometry, TAG_STYLES, presets
  routes/
    auth.py  billing.py  products.py  reports.py  tags.py  admin.py
  security.py        # login_required, admin_required, throttle, headers
```
A side benefit: `services/` becomes unit-testable without going through the Flask
request cycle — the current tests have to drive a test client to exercise pricing.

### 2.1 No service layer
Pricing, stock moves, and ledger reversal are inline inside `create_invoice`. The
delete path re-implements the *reverse* of that logic by hand. When (not if) the
making-charge rules change, two places must move together. Extract a
`services/billing.py` with `price_line()`, `commit_sale()`, `reverse_sale()` and have
both routes call it.

---

## 3. Correctness & compliance

### 3.1 GSTR-1 export is not actually GSTR-1
`export_gstr1()` produces a **B2C summary by rate** — one row per tax rate. A real
GSTR-1 needs:
- **B2B** section with each customer's **GSTIN** (you already capture `client_gstin`
  but don't use it in the export),
- **B2CS / B2CL** split (large vs small invoice value),
- **HSN/SAC summary** — products have no HSN column at all,
- **place of supply** (inter vs intra-state, which changes CGST/SGST vs IGST).

Right now you only bill a flat 3% GST with no CGST/SGST split, which isn't how
Indian jewellery GST is filed. Either label the export "GST rate-wise summary"
honestly, or build the real B2B/B2C + HSN + IGST/CGST/SGST breakdown. Add an `hsn`
column to `Product`.

### 3.2 Credit limit only checked at creation
`create_invoice` enforces `client.balance + total <= credit_limit`, but a later
`/invoices/<id>/payment` that *reduces* balance is fine; however an **edit** path
(doesn't exist yet) or a back-dated bill would bypass it. Flag for the roadmap.

### 3.3 Naive datetimes everywhere
All timestamps are stored naive shop-local. Fine for India (no DST), but the moment
`SHOP_TZ` is set to anything with DST (you ship a fallback table that includes
`America/New_York`, `Europe/London`, `Australia/Perth`), day-boundary reports drift.
Storing **UTC-aware** and converting to shop-tz only at display is the robust fix;
your `snapshot_invoice` already emits ISO strings, so a migration is mostly mechanical.

### 3.4 `allocate_invoice_number` race on SQLite
`with_for_update()` is a **no-op on SQLite** (no real row locks). You mitigate it by
pinning `GUNICORN_WORKERS=1`, but nothing *enforces* that — if someone sets
`DATABASE_URL=postgresql://...` and bumps workers, the counter races. Either guard the
counter with a unique constraint + retry, or assert `workers==1` when on SQLite at boot.

### 3.5 No migration tool
Flask-Migrate was removed and `ensure_schema()` hand-rolls `ALTER TABLE` + a custom
paise-rebuild. It's clever and tested, but every new column must be added to the
`wanted_tables` dict **and** the paise map, and the rebuild does `CREATE TABLE … AS
SELECT` with no automatic pre-flight backup (unlike `backup_restore`, which does take
a pre-restore copy). A production DB corrupted mid-rebuild has no safety net. Adopt
**Alembic**; keep `ensure_schema()` only for the legacy paise one-shot.

### 3.6 Stock adjustments leave no audit trail
Flagged in `REVIEW.md` and still true — a manual stock correction changes the number
with no `AuditLog` row. For a business where stock = gold, that's a gap.

---

## 4. Performance — N+1 queries in the report paths

### 4.1 `reports()` and `invoices_with_due()` do per-invoice payment sums
```python
collected = sum(invoice_paid_total(i.id) for i in invoices)   # one query per bill
```
With a few thousand bills this is O(N) round-trips. Replace with one
`GROUP BY invoice_id` aggregate, or better, denormalize a `paid_amount` column on
`Invoice` kept in sync by the payment write path (it already updates
`client.total_payments` — do the same for the invoice).

### 4.2 `index()` runs 6 monthly revenue queries in a loop
Replace with one `GROUP BY` over `Invoice.date_created` (truncated to month) for the
last 6 months. Same for the recent-invoices list.

### 4.3 Missing indexes
PK and `unique=True` are indexed; the join/filter columns are not. Add:
- `Invoice.client_id`, `Invoice.status`, `Invoice.date_created`
- `InvoiceItem.invoice_id`, `Payment.invoice_id`, `Payment.client_id`

These are exactly the columns the report/ledger queries filter on.

### 4.4 SQLite file-copy backup is not crash-consistent
`shutil.copy2` on a live WAL-mode SQLite file can produce a torn copy. Use
`VACUUM INTO 'backup.db'` or the SQLite Backup API for a consistent snapshot. Also:
`backup_database` writes `backup_*.db` to the **CWD**, which inside the container is
`/app` — not the mounted volume, so the backup is lost on container recreation. Write
to a configured `BACKUP_DIR`.

---

## 5. Testing & CI

- **CSRF is never tested with CSRF on.** `TestConfig` sets `WTF_CSRF_ENABLED = False`
  globally. The "unauthenticated POST denied" test checks auth, not CSRF. Add a
  second test client with CSRF on and assert a token-less POST → 400.
- **No CI workflow** (`.github/workflows/`). Tests are manual (`python tests.py`).
  Add a `pytest` job + ruff + mypy stage.
- **Tests share one process-global `app`/`db`** because Flask-SQLAlchemy freezes the
  engine at import. The workaround pins `DATABASE_URL` before import — clever, but it
  means tests can't run in parallel and can't use a fresh app per test. An
  `app_factory()` would fix this and is a prerequisite for the §2 split anyway.
- **No coverage report.** Add `pytest-cov` and gate CI on a floor.
- **No type checking config** despite `from __future__ import annotations` everywhere.
  Add `mypy` + a few `py.typed` markers; the code is already mostly annotated.

---

## 6. Front-end & asset hygiene

- **Scratch files are committed:** `verify_camera.js`, `verify_camera.py`,
  `verify_tags_v4.py`, `TAG-CHANGES.md`, `TEST_REPORT.md`, and a duplicated
  `verify_tags_v4.py` at the zip root. These are verification/dev artifacts, not
  shipped code. Move to a `scripts/` or `tools/` dir, or delete.
- **No JS tooling at all** — inline `<script>` in 7 templates, one vendored
  `jsqr.min.js`. That's fine for size, but it means no linting/bundling and the camera
  code is duplicated across files. At minimum, move inline page-specific JS into
  `static/js/<page>.js` modules so a CSP nonce can cover them.
- **Dashboard chart is CSS bars** (acknowledged). For a billing product, a real chart
  (Chart.js, one file) would materially improve the reports/dashboard UX for low cost.
- No static-asset cache-busting (`?v=...` on `jsqr.min.js`) — fine since it never
  changes, but worth noting if you ever version it.

---

## 7. Observability

- `logging.basicConfig(level=INFO)` only — no structured logging, no request IDs, no
  error tracking. Add `structlog` (or at least a `request_id` filter) and an optional
  Sentry hook; the 500 handler already calls `log.exception`.
- `/healthz` returns `{"ok": True}` without touching the DB. A deep check that does
  `SELECT 1` catches DB-down states that the current probe misses. Split into
  `/healthz` (liveness) and `/readyz` (DB ping).
- No metrics endpoint. A `/metrics` (Prometheus) exposing invoice count, p95 request
  time, and DB pool stats would help once multi-worker lands.

---

## Priority matrix

| # | Improvement | Effort | Impact |
|---|-------------|--------|--------|
| 1.1 | `logout` → POST + CSRF | XS | High (easy CSRF fix) |
| 1.2 | Nonce-based CSP | S | High (XSS surface) |
| 1.3 | Throttle → shared store | S | Medium (needed to scale) |
| 4.1 | Kill N+1 in reports/`invoices_with_due` | S | High (scale) |
| 4.4 | `VACUUM INTO` backup + `BACKUP_DIR` | S | High (data safety) |
| 3.1 | Real GSTR-1 (B2B/B2C, HSN, IGST/CGST/SGST) | M | High (compliance) |
| 3.5 | Alembic migrations | M | High (long-term) |
| 2 | Split `app.py` into a package + `create_app()` | M | High (maintainability) |
| 2.1 | Extract `services/billing.py` (price/commit/reverse) | M | Medium |
| 5 | CI (pytest + ruff + mypy + cov) | S | Medium |
| 4.3 | Add the 6 indexes | XS | Medium |
| 3.3 | UTC-aware timestamps | M | Medium (future-proof) |
| 6 | Remove scratch files; externalise JS | XS | Low |
| 7 | Structured logging + `/readyz` | S | Medium |

**Do first:** the four XS/S security + data-safety items (1.1, 1.2, 4.4, 4.3) — small,
high-impact, and they unblock safe scaling. The package split (§2) and Alembic (§3.5)
are the medium-term enablers; do them before the feature roadmap in `REVIEW.md`
(edit-bill, returns), because every new feature will otherwise land in an
already-too-big `app.py`.
