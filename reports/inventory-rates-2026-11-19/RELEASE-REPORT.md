# Inventory and bill-rate update — 19 November 2026

## Implemented

- Inventory uses one paginated table, with visible zero-stock records and All/In stock/Out of stock filters. Stock filtering happens before pagination, so empty products are not hidden on an unrelated page.
- Gold, silver and whole-inventory cards show product counts separately from available pieces and stock weight. These totals include zero-stock products and are clearly labelled as global totals, unaffected by list filters. Weight displays three decimal places.
- Add/edit product forms suggest saved category names through a shared picker, while still allowing new categories. Saved values and historical records are not rewritten.
- Tag filters cover generated-style, other and missing codes. Sorting can place generated-style codes first; name, lowest-stock and newest ordering are also available. All filters and ordering survive pagination and list-return navigation.
- Owner-only gold/silver rate controls apply to the current bill, with positive finite-value validation. Defaults come from the shop's current rates; leaving a field empty falls back to the current shop rate. The applied rates are saved in the existing Invoice.gold_rate and Invoice.silver_rate fields.
- Preview and save pass the same request-local rate inputs through the existing V1 formulas. The actual Settings row is not modified by rate overrides, and master product prices and previous bills are unchanged. Creating a bill still performs its normal stock/payment/ledger updates and advances the existing invoice counter.
- Drafts recover custom rates. Rate labels and item hints follow the server-approved preview. Background/navigation/logout cancels pending preview work to avoid needless mobile requests.

## QR history limitation

There is no stored flag that proves whether a QR was scanned while a historical product was added. This release deliberately adds no database field and does not invent that history. “Generated-style” means the existing code is JWL- followed by at least six ASCII digits; it is a format-based review aid, not evidence that a QR was never scanned. An externally scanned code can have the same format. The distinction is stated in the interface whenever these filters/sorts are used.

## Existing database and V1 protection

No production database was used for tests or replaced, reset, migrated or bulk-updated. No model columns or tables were added. Model definitions, existing schema-migration helpers, the read-only preview calculation and V1 monetary functions were compared structurally with the pre-update source: unchanged. The rate adapter copies settings into a request-local object rather than editing the database settings object. Existing backups, customer records and historical bills were not modified by this task.

No dependencies or deployment configuration changes are needed. All tests use temporary synthetic databases; the frozen original reference runs in memory. The existing configuration loader may read environment defaults, but tests override the database and signing settings before importing the app. The shop's .env is neither edited nor included in the ZIP.

## Validation

- **421 Python tests passed**, including all existing financial/security/concurrency/backup regressions and the complete registered-route checks.
- Route inventory remains **66 patterns**, with **231 GET/POST method/role probes**, missing-token checks on **30 POST routes**, and **114 HEAD/OPTIONS requests**. Baseline empty-form probes check guards and errors; successful business flows are covered separately.
- Thirteen new inventory/rate tests cover zero-stock filtering before pagination, global summary scope, saved categories and error forms, explicit QR-style classification, malformed/unauthorized rates, frozen per-bill rates, unchanged master settings/prices and read-only preview.
- Five additional comparisons run custom-rate gold/silver percent/flat and weighed-goods bills through the frozen pre-change application, including discount, GST, exchange and partial collection. Preview and saved-bill results agree with that reference.
- Chromium and WebKit passed both the existing mobile suite and the new inventory/rates suite: zero-stock rows, global summary scope, saved categories, code-style filtering, 320/390/768/1024px layouts, custom-rate draft recovery, saved totals and unchanged master rates.
- Final mobile lifecycle checks passed after pending previews were cancelled when hidden, navigating away or logging out. An initial WebKit navigation check reported a cancelled-request error during development; the final clean run passed without page errors.
- Existing smoke suite passed checkout/draft/customer/validation recovery, touch navigation, print flows and **125 responsive layouts**. Screenshots of the new inventory and billing layouts were visually inspected.
- The 6× CPU slowdown/constrained-network suite passed checkout, customer creation, PDF/WhatsApp preparation, share cancellation and 20 responsive views. Camera heartbeat p95 was 241 ms in that simulation; this is not a hardware guarantee.
- Virtual camera/QR checks passed automatic start, tiny QR decoding, permission refusal, stream cancellation, upload/photo decoding and local image cleanup; product QR views passed ten responsive checks.
- Virtual-authenticator passkey registration, signature verification, login, replay rejection and removal passed.
- Ruff, JavaScript syntax, bundled-style consistency and whitespace checks passed.

These are automated browser-engine/device simulations. They do not certify physical Android/iPhone camera performance, keyboard behavior or printer output. No real customer messages or printing were performed, and the hosted PythonAnywhere deployment was not changed.

## Deployment

Deploy updated source/templates/static assets over the existing installation. Keep the existing database, instance directory and .env. **Do not run init_db.py, replace the database or run a migration for this update.** Reload the hosted web app and refresh open browser tabs so they load the new asset versions.

After deployment, check the stock filters, category suggestions and an unsaved sample bill's rate preview on the customer's devices. Rate overrides are available to the owner; ordinary staff retain the configured shop rates. Do not complete a real sale merely to test deployment.

Evidence: route-inventory.csv, inventory.json, matrix.json, protocol.json and preservation.json. Previous reports are historical release records; this document describes the current update.
