# Security and reliability review

> Implementation update — 4 November 2026: the requested seven fixes and passkey login are documented in [SECURITY-IMPLEMENTATION.md](SECURITY-IMPLEMENTATION.md). This report retains the original audit findings as historical evidence; consult the implementation notes for current behavior and remaining deployment checks.

Date: 3 November 2026
Project: single-branch jewellery billing workspace

## Verdict

Core billing protections are present, and all 69 existing Python tests pass. The application is not yet ready for an unconditional security/reliability sign-off. Fix the high-priority findings below before client handover, especially if more than one device will operate at the same time.

This was a source review and isolated test review, not an external penetration test or a guarantee that no defects exist. No application logic, calculations, production settings, live database or customer data were changed during this review. Only this report and an ignored synthetic diagnostic script were written.

## Findings and priorities

| ID | Severity | Finding and evidence | Impact | Recommended action |
|---|---|---|---|---|
| S1 | High | `init_db.py:44` creates a fixed, publicly known initial administrator password. No first-login password-change gate was found. Actual client credentials were not inspected. | A fresh installation exposed before credential replacement can be taken over. | Generate a unique initial secret or require owner-supplied credentials; block business access until onboarding is complete. |
| R1 | High | `app.py:1629–1696` streams the live SQLite file, copies it directly, and replaces it during restore. Restore uses one shared temporary filename, checks only three table names, and has no maintenance lock or automatic rollback after migration failure. | Active writes can produce inconsistent backups; concurrent restores/requests can lose or corrupt data. A failed restore can leave the replacement active. | Use SQLite's online backup API. Validate integrity, schema and relations in an isolated staging database; serialize restores, stop writes, retain a verified rollback snapshot and invalidate sessions. |
| R2 | High | `app.py:3159`, `update_invoice_status`, reads and reverses stock/payments/customer balances without the client/invoice locks used by payment and deletion routes. | Concurrent cancellation, collection or deletion can apply inconsistent stock and ledger changes. This is a source-confirmed race risk; the precise concurrent failure was not reproduced in this review. | Acquire the same locks in the same order, re-read status after locking, and make cancellation a conditional, idempotent transaction. Add cancellation-vs-payment and cancellation-vs-deletion tests on SQLite and PostgreSQL. |
| S2 | High when deployed incorrectly | `config.py` defaults to a published development signing key and non-Secure cookies. `app.py:50` blocks that exact key only when `FLASK_ENV=production`. Proxy headers are trusted by default. | A misconfigured deployment can permit forged sessions, expose cookies on HTTP, or let callers spoof addresses used by login throttling. | Enforce a strong unique key and HTTPS for client deployments; enable Secure cookies and configure proxy trust only behind the actual trusted proxy. Docker sets production mode, but real deployment settings were not verified. |
| S3 | Medium | `app.py:1458` resets the password but sessions are validated only against the existence of a user ID. An independently created old session still accessed `/products` with HTTP 200 after password reset in the isolated probe. | A previously stolen session remains usable after recovery. | Store a session version/authentication timestamp and revoke all existing sessions after reset. Require recent authentication for restore and account management. |
| S4 | Medium; role-dependent | Bill deletion/cancellation, metal-rate changes, inventory edits and settings use `login_required`, not owner/admin authorization. | Any signed-in employee can perform these sensitive business operations. This may match an owner-only shop, but becomes a permissions gap if staff accounts are intended. | Define owner/cashier permissions and enforce them on the server. Keep the current access only if all accounts are deliberately fully trusted. |
| S5 | Medium | CSV exports write customer/product/reason fields directly. A harmless customer name `=1+1` survived unchanged in `/export/invoices.csv` during the probe. | Spreadsheet software may treat untrusted exported text as a formula. | Neutralize formula-leading text consistently in all CSV exports; test quotes, newlines and leading whitespace. CSV quoting alone is insufficient. |
| R3 | Medium | `validate_positive` accepts `nan` and `inf` (reproduced). Product stock-weight parsing also checks only `< 0`. Global field-length, item-count and numeric upper limits are incomplete; preview validation does not protect all direct POST paths. | Malformed requests can cause server errors, non-finite stock values or oversized calculations. | Reject non-finite numbers before conversion, set sensible business bounds and validate direct submissions independently. Preserve V1 arithmetic for valid inputs. |
| S6 | Medium | Global `MAX_CONTENT_LENGTH` is unset; restore has no application-level file-size limit. Login attempts are stored in a process-local dictionary; stale entries are cleaned only when that key is revisited. | Oversized uploads can consume resources; throttling resets on restart and is not shared across workers. | Set request/file limits and timeouts, bound stored throttle keys, and use a shared limiter or trusted proxy protection. |
| R4 | Medium | `app.py:1300`, schema setup catches errors and continues serving; `/healthz` reports success without database readiness. Schema migration runs in request handling. | Monitoring can report healthy while billing is unavailable; concurrent startup migrations are harder to control. | Migrate once before serving; fail readiness when required schema/database checks fail. Keep a separate lightweight liveness endpoint. |
| S7 | Medium/defence in depth | No application CSP, HSTS or trusted-host allowlist was found. Only nosniff, frame denial and referrer policy are set. A request-derived host is used for an external invoice link. | Fewer browser protections and possible misleading generated links from untrusted Host headers. | Configure trusted shop hosts, HTTPS-only HSTS where appropriate, authenticated-response cache policy, and a nonce-based CSP after removing/authorizing inline scripts. Verify any equivalent reverse-proxy controls. |
| R5 | Medium | Stock edit writes an absolute quantity without a version/concurrency check; a sale from another device can occur while an older edit form remains open. | Saving stale stock values may overwrite the sale's stock reduction. | Use a stock adjustment ledger or optimistic version checks; reject stale edits and show the current quantity. |
| R6 | Low–Medium | Camera requests 4K as an ideal, not a guarantee. It retries a basic request only for `OverconstrainedError`. Local full-frame/crop decoding remains synchronous and there is no measured-load resolution downgrade. QR images have a 15 MB compressed-size check, but decode occurs before a decoded-pixel limit. | Older phones can heat up, stutter, or run out of memory on very large images. Some camera failures need manual retry. | Measure decode duration, reduce resolution/scan frequency on slow devices, add deliberate recoverable fallbacks and decoded-pixel bounds; test real phones. Never downgrade on permission denial by repeatedly prompting. |

## Controls that are working

- Authentication guards cover business routes in the reviewed source. Anonymous probes of static GET routes returned 200 only for login and health; dynamic route authorization was assessed in source and existing tests, not exhaustively fuzzed.
- Admin-only account management, exports/backup controls and deleted-bill archive views are present.
- Passwords use Werkzeug hashes; login clears prior session data. HttpOnly and SameSite=Lax cookie defaults are present.
- Flask-WTF CSRF protection is enabled. Exempt endpoints identified in source are read-only GET endpoints.
- ORM parameterization is used for ordinary queries. Dynamic migration SQL inspected is based on internal schema definitions, rather than request values.
- Jinja autoescaping, JSON serialization and escaping of dynamic billing-row values provide baseline injection protection. No exploitable XSS was established; this is not exhaustive browser fuzzing.
- Original pricing functions and preview/save agreement have regression coverage. Server-side totals remain authoritative.
- Atomic stock reservations prevent overselling; existing retry keys prevent duplicate invoices/payments. Concurrent last-piece and overcollection tests pass.
- Existing QR codes are unique; scanning retrieves inventory data rather than accepting a price printed in a QR.
- Scanner processing is local, no microphone is requested, and camera cleanup covers close/tab switch/page hiding/late permission resolution. Zoom/focus/light depend on hardware capabilities.
- Docker runs as a non-root user and debug mode is disabled in the reviewed entry point.

## Verification performed

- Full Python suite: 69 passed in 46.04 seconds.
- Ruff static checks: passed.
- Isolated probes: old session survived password reset; formula-leading CSV text was retained; non-finite positive validation accepted NaN/infinity; no global body limit or trusted-host allowlist configured.
- Earlier scanner verification, not rerun as part of this audit: synthetic small-QR recognition, permission denial, late-stream cleanup and scan-to-bill passed. Earlier responsive checks also are not a replacement for this security review.
- No business arithmetic was changed. The old manual paid-status behavior is retained: a status label can disagree with the payment ledger. Reconcile by payment totals; any change to that legacy behavior needs an explicit product decision.

## Checks still required before sign-off

Actual HTTPS/proxy/firewall/backup storage settings, exact installed-package vulnerability audit (including transitive dependencies), PostgreSQL race tests, real restore-and-recover drill, power-loss recovery, long-running load tests, actual iOS/Android camera tests and physical printer acceptance were not completed. No live secret values or customer records were opened for this audit. Dependency pinning and license notices alone do not establish vulnerability-free dependencies.

Recommended sequence: safe backup/restore and cancellation locking; deployment secrets and initial credentials; session revocation and roles; input/resource limits and export safety; then device/load/recovery acceptance. Keep valid-input V1 financial results frozen throughout.

## Primary references

- Flask security/resource/host guidance: https://flask.palletsprojects.com/en/stable/web-security/
- SQLite online backup API: https://www.sqlite.org/backup.html
- OWASP formula injection: https://community.owasp.org/attacks/CSV_Injection
- Browser camera constraints: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints
