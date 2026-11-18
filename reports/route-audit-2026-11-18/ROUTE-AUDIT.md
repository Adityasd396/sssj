# Route audit — 18 November 2026

> Historical audit. These findings are addressed in the [follow-up release report](../route-fixes-2026-11-18/RELEASE-REPORT.md).

## Result

The application has **65 registered URL patterns: 64 application routes and one static-file route**. The ordinary route/access checks passed, but targeted edge cases revealed reliability and workflow problems. This is a report-only review: no application fixes, database changes or V1 pricing changes were made.

The most important issue is that an owner can label an unpaid invoice **paid** without recording a payment. The remaining confirmed failures concern tag-design lookup, large numeric parameters, report-date overflow, malformed passkey input and customer editing. Report query volume also needs attention for low-end servers.

## Scope and protection of existing records

Tests imported the existing isolated shop fixture, which sets a new temporary SQLite database before importing the application. Database restore/download probes used a temporary instance directory. Production data and environment settings were not modified. Requests used synthetic records; no physical camera, biometric device, WhatsApp recipient or printer was used. The normal configuration loader may read local environment defaults, while the test fixture explicitly overrides the database and session settings. Application/security/recovery/passkey/sharing modules, requirements and the frozen original calculation fixture matched the hashes recorded before the earlier mobile update. This audit wrote reports and scratch test files only.

The live deployment at sssj.pythonanywhere.com was not tested. Findings apply to this workspace's code. No claim is made that every possible input, deployment setting or hardware combination has been tested.

## Verification performed

| Check | Result |
|---|---|
| Registered route inventory | All 65 URL patterns enumerated, including dynamically installed passkey and replacement recovery handlers |
| Explicit application GET/POST baseline | 75 method/route combinations × anonymous, cashier and owner = 225 requests; all returned expected non-500 responses |
| Owner access boundaries | All 24 owner-only URL patterns rejected cashier requests with 403 in the tested methods |
| CSRF protection | All 29 explicit POST routes rejected requests without a valid form token when CSRF was enabled |
| Automatic protocol methods | 112 HEAD/OPTIONS requests completed without server exceptions; HEAD bodies were empty |
| Static delivery | Public favicon returned 200; attempted traversal to app.py returned 404 |
| Missing records and input edges | 38 probes: 24 missing-record method checks passed; 14 targeted input/workflow probes documented below |
| Existing regression suite | Initial full run: 108 passed, one startup probe could not reach its local server under execution restrictions. Both startup tests passed on a localhost-enabled rerun; no application fix was required |
| Low-end server query check | /reports returned 200 but executed 314 SQL statements for 100 synthetic invoices |

A baseline POST generally used an empty form to check guards and error handling; this is not equivalent to a successful full business operation on every POST route. Successful checkout, payment/retry, concurrent stock/payment/cancellation, customer creation, exports, passkey challenge and backup/restore behavior are additionally covered by the existing regression suite. Browser/device UI tests were not rerun for this report-only audit.

## Confirmed findings, ranked

### R1 — High: paid status can disagree with actual money received

**Route:** POST `/invoices/<int:invoice_id>/update_status` — `app.py:3415`.

**Reproduction:** Create an unpaid sample bill for ₹108.15, then submit `status=paid` as the owner. The request redirects successfully, invoice status becomes `paid`, payments remain ₹0 and the customer's balance remains ₹108.15. The reverse pending transition is also not derived from payment totals in this branch.

**Impact:** Staff can trust a paid badge and release goods or miss a collection even though the ledger still shows debt. This is an owner-authorized workflow consistency defect, not an anonymous bypass.

**Recommended correction:** Derive paid/pending status from posted payments. Keep cancellation as its own controlled transition. Reject manual paid status when a balance remains. This does not require changing V1 price calculations.

### R2 — Medium: staff can change customer credit limits

**Route:** GET/POST `/clients/<int:client_id>/edit` — `app.py:2386`.

The route requires login but not owner permission. A cashier successfully changed the sample customer's credit limit to ₹99,999. Credit limits affect whether a bill can be accepted, so this can bypass the shop owner's intended lending policy.

**Recommended correction:** Let staff edit ordinary contact details if intended, but restrict credit-limit changes to the owner on the server. Confirm the shop's policy before changing permissions.

### R3 — Medium: customer edit permits duplicate phone numbers

**Route:** POST `/clients/<int:client_id>/edit` — `app.py:2386`.

Customer creation checks for an existing phone number, while customer editing does not perform the equivalent check. Editing one customer to another's phone succeeded and left two records with the same number.

**Impact:** Searching or sharing bills by phone becomes ambiguous; staff may select the wrong account. Existing phone formatting differences are a related risk, but not all normalization cases were tested here.

**Recommended correction:** Reject conflicting phone changes with a clear message and preserve entered values. Do not merge existing customers automatically. Concurrent duplicate prevention needs a separate review before any database constraint is introduced.

### R4 — Medium: a missing tag design crashes saving

**Route:** POST `/tags/save` — `app.py:4280`.

Submitting `tpl_id=999999` raised `AttributeError` because the lookup returned None and `apply_tag_form` tried to edit it. A stale open design page can encounter this after another owner deletes the design.

**Recommended correction:** Return a controlled 404 or a message explaining that the design was removed, with a way to save it as a new design.

### R5 — Medium: large page numbers and identifiers cause server errors

**Routes reproduced:** GET `/clients`, `/products`, `/invoices` with a very large `page`; GET `/products/<int:product_id>` with a very large ID; GET `/tags/print` with a very large ID in `ids`.

The inputs reached SQLite as integers outside its supported range, raising `OverflowError`. Shared pagination is at `app.py:1376`; tag batch parsing is at `app.py:4314`.

**Recommended correction:** Bound pagination before computing the SQL offset and validate numeric record identifiers before database binding. Use a consistent 400/404 response for invalid identifiers. Other routes using the same helpers may share this weakness; only the cases above were reproduced.

### R6 — Medium: the maximum report end date crashes reports

**Routes:** GET `/reports`, `/reports.csv`, `/reports/products.csv` share `_report_query` at `app.py:4375`.

`/reports?to=9999-12-31` raised `OverflowError` when the filter added one day. The report page was tested directly; the export exposure follows from their shared filter helper. Ordinary malformed date text was safely ignored in the probe.

**Recommended correction:** Validate the date range, handle overflow and show a clear invalid-range message consistently across screen and exports.

### R7 — Medium: malformed passkey registration JSON causes a server error

**Route:** POST `/passkeys/register/options` — `passkeys.py:113`.

With a valid localhost passkey configuration and an authenticated session, sending a JSON array instead of an object raised `AttributeError` from `.get`. The normal valid passkey flows remain covered by existing tests. The quick-customer endpoint correctly rejected the equivalent malformed JSON with 400.

**Recommended correction:** Validate that the payload is an object and password is a bounded string before inspecting it. Return structured 400 responses. Apply the same shape/type policy consistently to JSON endpoints.

### R8 — Medium: reports and some selectors do not scale well

**Routes:** `/reports` (`app.py:4421`), `/invoices/create` (`app.py:2742`), `/tags` (`app.py:4238`), `/tags/print` (`app.py:4314`).

Measured: `/reports` made **314 SQL statements for 100 synthetic invoices**, including repeated per-invoice payment-total queries. Source review also found full customer loading in billing, full product loading in the tag designer and unrestricted all-product tag batches. The inventory list itself is paginated.

**Impact:** As records grow, report requests can tie up a small server and large selectors/batches can burden mobile browsers. This was a query-count check, not a production load or latency benchmark.

**Recommended correction:** Aggregate payment totals in grouped queries, use bounded customer/product search and limit tag batches. Preserve current financial definitions and verify resulting report totals against existing fixtures.

### R9 — Low: filtered deleted-bill totals mix scopes

**Route:** GET `/deleted-bills` — `app.py:4790`.

Source review: search filters apply to displayed rows and count, while value/paid sums query the complete archive. A filtered view can therefore show a matching count beside global monetary totals without a clear distinction. This observation was not separately asserted against rendered totals.

**Recommended correction:** Use the same filter for all totals or explicitly label them as all-time archive totals.

### R10 — Low: backup GET/HEAD has storage side effects

**Routes:** `/backup/download`, `/backup/database`; active handlers in `database_recovery.py`.

Source review and protocol execution confirm that requesting a backup creates a retained snapshot; HEAD executes the GET handler too. No automatic retention cleanup is implemented in this module. Repeated owner requests can accumulate database copies on a server with limited storage. No disk-exhaustion test was performed.

**Recommended correction:** Separate a deliberate POST snapshot action from downloading an existing snapshot and introduce an explicit retention policy while preserving recovery copies.

## Controls that held in this audit

- Private application routes required authentication. Public surfaces were login, health, passkey login, logout (POST with CSRF), static assets and signed customer PDF links. Invalid shared PDF tokens returned 410.
- Owner-only routes denied cashier access, including settings/prices, product modifications, bill deletion/cancellation, user management, exports/backups, audit and deleted-bill records.
- All explicit POST routes had effective CSRF protection in the negative-token checks.
- Normal missing numeric records returned controlled 404 responses; passkey deletion required password confirmation first (403).
- Existing regressions passed for payment retries, stock oversell protection, overcollection prevention, cancellation/payment races, stale-stock updates, restore coordination/rollback, session revocation, CSV formula handling and frozen-original price comparisons.

These successes do not remove the findings above. In particular, price calculation correctness and a misleading manually assigned paid status are separate concerns.

## Recommended order of work

1. Fix paid/pending consistency and define owner-only credit changes.
2. Prevent duplicate customer edits and handle missing tag designs.
3. Add shared bounds/type/date validation for the reproduced exceptions.
4. Reduce report query volume and bound selectors/print batches.
5. Clarify archive totals and backup retention behavior.

## Complete route inventory

The table includes every registered pattern. Methods shown below omit automatic HEAD/OPTIONS for readability; those are recorded separately in `protocol.json`. Access is the server handler requirement, not simply whether a menu link is visible. Baseline results are recorded in `matrix.json` and `route-inventory.csv`. The static route is public and was checked separately. HEAD/OPTIONS may be available even where the main method is protected; that does not grant access to private records.

| Route | Explicit methods | Access | Endpoint |
|---|---|---|---|
| `/` | GET | signed-in | `index` |
| `/account/passkeys` | GET | signed-in | `passkeys` |
| `/account/passkeys/<int:key_id>/delete` | POST | signed-in | `passkey_delete` |
| `/account/password` | GET, POST | signed-in | `change_password` |
| `/api/invoices/preview` | POST | signed-in | `invoice_preview` |
| `/api/prices` | GET | signed-in | `get_prices` |
| `/api/session` | GET | signed-in | `current_session` |
| `/audit-logs` | GET | owner | `audit_logs` |
| `/backup/database` | GET | owner | `backup_database` |
| `/backup/download` | GET | owner | `backup_download` |
| `/backup/restore` | POST | owner | `backup_restore` |
| `/clients` | GET | signed-in | `clients` |
| `/clients/<int:client_id>` | GET | signed-in | `view_client` |
| `/clients/<int:client_id>/delete` | POST | owner | `delete_client` |
| `/clients/<int:client_id>/edit` | GET, POST | signed-in | `edit_client` |
| `/clients/<int:client_id>/pay-remaining` | GET, POST | signed-in | `pay_remaining` |
| `/clients/<int:client_id>/statement` | GET | signed-in | `client_statement` |
| `/clients/add` | GET, POST | signed-in | `add_client` |
| `/clients/quick` | POST | signed-in | `quick_client` |
| `/collect` | GET | signed-in | `collect` |
| `/deleted-bills` | GET | owner | `deleted_bills` |
| `/deleted-bills.csv` | GET | owner | `deleted_bills_csv` |
| `/deleted-bills/<int:row_id>` | GET | owner | `view_deleted_bill` |
| `/export/data` | GET | owner | `export_data` |
| `/export/gstr1.csv` | GET | owner | `export_gstr1` |
| `/export/invoices.csv` | GET | owner | `export_invoices_csv` |
| `/healthz` | GET | public | `healthz` |
| `/invoices` | GET | signed-in | `invoices` |
| `/invoices/<int:invoice_id>` | GET | signed-in | `view_invoice` |
| `/invoices/<int:invoice_id>/delete` | POST | owner | `delete_invoice` |
| `/invoices/<int:invoice_id>/payment` | GET, POST | signed-in | `add_payment` |
| `/invoices/<int:invoice_id>/pdf` | GET | signed-in | `invoice_pdf` |
| `/invoices/<int:invoice_id>/receipt` | GET | signed-in | `invoice_receipt` |
| `/invoices/<int:invoice_id>/update_status` | POST | owner | `update_invoice_status` |
| `/invoices/create` | GET, POST | signed-in | `create_invoice` |
| `/login` | GET, POST | public | `login` |
| `/logout` | POST | public | `logout` |
| `/passkeys/login/options` | POST | public | `passkey_login_options` |
| `/passkeys/login/verify` | POST | public | `passkey_login_verify` |
| `/passkeys/register/options` | POST | signed-in | `passkey_register_options` |
| `/passkeys/register/verify` | POST | signed-in | `passkey_register_verify` |
| `/prices/quick` | POST | owner | `quick_prices` |
| `/printers` | GET | signed-in | `printer_setup` |
| `/products` | GET | signed-in | `products` |
| `/products/<int:product_id>` | GET | signed-in | `view_product` |
| `/products/<int:product_id>/delete` | POST | owner | `delete_product` |
| `/products/<int:product_id>/edit` | GET, POST | owner | `edit_product` |
| `/products/<int:product_id>/tag` | GET | signed-in | `print_product_tag` |
| `/products/add` | GET, POST | owner | `add_product` |
| `/products/scan/<path:barcode>` | GET | signed-in | `scan_product` |
| `/register` | GET, POST | owner | `register` |
| `/reports` | GET | signed-in | `reports` |
| `/reports.csv` | GET | signed-in | `reports_csv` |
| `/reports/products.csv` | GET | signed-in | `reports_products_csv` |
| `/settings` | GET, POST | owner | `settings` |
| `/shared/bill/<token>.pdf` | GET | signed token | `shared_invoice_pdf` |
| `/static/<path:filename>` | GET | public | `static` |
| `/tags` | GET | signed-in | `tag_designer` |
| `/tags/<int:tpl_id>/delete` | POST | owner | `delete_tag_template` |
| `/tags/calibrate` | GET | signed-in | `tag_calibration` |
| `/tags/print` | GET | signed-in | `print_tags` |
| `/tags/save` | POST | owner | `save_tag_template` |
| `/users` | GET | owner | `users` |
| `/users/<int:user_id>/delete` | POST | owner | `delete_user` |
| `/users/<int:user_id>/reset-password` | POST | owner | `reset_password` |

## Evidence files

- `route-inventory.csv`: complete route list, permissions and baseline owner/staff status codes.
- `inventory.json`: registered rules and source locations (decorated handlers may report their decorator's first line).
- `matrix.json`: 225 baseline route/method/role responses.
- `edges.json`: 38 input/missing-record/workflow probes, including exceptions caught by the test harness. Under normal production exception handling these become HTTP 500 responses.
- `protocol.json`: 112 HEAD/OPTIONS results.
- `additional.json`: static traversal, duplicate-phone and staff-credit demonstrations.
- `performance.json`: report query-count evidence.

The report recommends fixes; it does not silently apply them. Existing data, monetary rules and application source remain unchanged.
