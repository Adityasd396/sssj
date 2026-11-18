# Route fixes and release verification — 18 November 2026

## Delivered

All ten findings from the route audit have been addressed in code. The shop's existing database was not opened for testing, replaced, migrated or repaired. Existing historical customer duplicates or manually assigned invoice statuses were not bulk-rewritten. All database model definitions, schema-migration helpers and the selected V1 calculation functions were compared structurally with their pre-fix versions and remain unchanged. Frozen-original pricing regression cases passed. Requirements and configuration files were not changed by this release.

| Finding | Resolution |
|---|---|
| R1: paid status without payment | Owner status changes that disagree with recorded payments return 422; cancellation remains supported. Checkout/payment paths continue to assign status from posted payments. |
| R2: staff credit changes | Server rejects cashier credit-limit changes and nonzero initial limits. Contact editing remains available. Owner-only credit fields are hidden from staff forms. |
| R3: duplicate customer phone edit | Customer add, quick creation and edit share serialized directory access and formatted-phone matching. New conflicts are rejected; edit values remain visible. Legacy duplicates are preserved rather than automatically merged. |
| R4: missing tag design | Saving a deleted or missing design returns controlled 404 instead of dereferencing a missing object. |
| R5: huge numeric parameters | Pagination clamps to the available last page before computing the offset. Numeric route IDs and relevant query/form IDs are bounded; tag ID batches reject invalid, oversized and non-ASCII numeric inputs. |
| R6: report date overflow | Screen and CSV routes share controlled 400 validation for invalid, reversed and overflowing date ranges. |
| R7: malformed passkey JSON | Passkey requests require object payloads and bounded string fields. Malformed requests return 400. |
| R8: excessive report queries and unbounded selectors | Payment totals are fetched in one grouped query and customer relationships are eagerly loaded. Customer search returns at most 30 matches; billing initially loads 50 customers plus any explicitly selected customer. Draft/recent-customer recovery can load missing selections by ID. Tag selection is paged at 50 products and printing is limited to 100 products, at most 10 copies each. |
| R9: mixed archive totals | Deleted-bill count, value and paid totals use the same search filter. |
| R10: backup storage side effects | HEAD creates no snapshot; normal downloads use a temporary snapshot that is removed. GET /backup/database redirects to settings. A deliberate CSRF-protected POST keeps a server snapshot; only the latest five new snapshot-* files are retained. Recovery-* and legacy billing-* copies are never automatically pruned. |

## Verification

- Full Python suite: **403 passed**, including route, authorization, CSRF, financial, concurrency, backup and focused hardening cases. One older assertion that expected an unpaid bill to become paid was updated to require rejection; V1 calculation fixtures were not altered.
- All registered patterns: **66** (65 application routes plus static), including the new signed-in customer lookup.
- GET/POST matrix: **77 route/method combinations × three roles = 231 requests**. Baseline form probes returned controlled responses; successful business flows are additionally exercised by the workflow regressions.
- CSRF checks: **all 30 explicit POST routes** rejected missing tokens when protection was enabled.
- Protocol coverage: **114 HEAD/OPTIONS requests**, plus public-static/traversal and owner-boundary checks.
- Report query count on the same 100-invoice synthetic dataset: **314 → 14 SQL statements**. Separate assertions verify billed, GST, collected and outstanding totals.
- Chromium and WebKit mobile browser checks passed guided billing, keyboard clearance simulation, Back behavior, tab-loss recovery, duplicate-save prevention and blocked-storage fallback.
- Both engines additionally passed remote customer search and draft restoration when the selected customer was outside the initial list; tag search was checked at 320, 390 and 768 pixels.
- Slowed-device workflow passed with 6× CPU throttling and constrained network: customer creation, save, PDF/WhatsApp preparation, native share/cancel and 20 responsive views. Camera heartbeat p95 in that simulation was 212 ms; this is not a physical-device guarantee.
- Virtual camera/QR checks passed automatic start, small QR decoding, permission refusal, stream cancellation and local photo disposal; product QR views passed ten responsive checks.
- Virtual-authenticator passkey registration, signature verification, login, replay rejection and removal passed.

**Final verification:** the route-only rerun passed all **262 tests** after the last backup change. The responsive smoke suite passed checkout, draft/customer/validation recovery, touch/navigation/print behavior and **125 screen-layout checks**. Additional backup/restore checks passed for legacy-copy preservation. JavaScript syntax, Ruff and whitespace checks passed. Tests use isolated temporary records and do not send customer messages or print physical receipts. Browser engine/device simulation is not physical Android/iPhone or printer certification. The live PythonAnywhere deployment was not changed.

## Deployment over an existing shop

1. Keep the shop's current database, instance folder, .env and deployment settings.
2. Upload updated source, templates and static assets from the ZIP. Do not replace existing data with sample files; no database files or secrets are included in the release.
3. **Do not run init_db.py or a database migration for this release.**
4. Reload the PythonAnywhere web application. Refresh open browser tabs to load the new customer-search and draft code.
5. Check a sample bill, customer lookup, tag print preview and backup download on the customer's real devices. Do not use a real sale merely as a deployment smoke test.

No bulk correction is made to historical data. If a pre-existing record has an incorrect manual status or duplicate phone, review it with the owner; do not merge or rewrite financial history blindly. Existing legacy backup copies are deliberately preserved and can be reviewed separately if disk space is limited.

## Evidence

The accompanying route-inventory.csv, inventory.json, matrix.json, protocol.json, performance.json and preservation.json document coverage and preservation checks. The original audit in ../route-audit-2026-11-18 is historical, before these fixes.
