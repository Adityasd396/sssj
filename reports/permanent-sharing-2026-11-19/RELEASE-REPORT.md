# Short permanent bill sharing — 19 November 2026

## Delivered

- New WhatsApp bill messages use a compact `/b/<code>` URL, replacing the long serialized invoice link. The code consists of a base-36 record identifier and a 128-bit HMAC-SHA256 signature. The signature binds the bill number, customer, creation time and record ID, so guessing another invoice ID does not authorize it and reused IDs do not revive deleted-bill links.
- The short link opens a standalone, responsive customer bill page without shop login or navigation. Values come from the existing `bill_facts` function. No additional calculation implementation was introduced.
- A **Download bill (PDF)** button appears beneath the customer bill. It downloads the existing PDF renderer's output with an attachment response and the bill-number filename. The signed-in shop bill also has a bottom download action.
- New links have no timestamp or automatic expiry. Legacy `/shared/bill/<token>.pdf` URLs remain supported; their previous 48-hour age limit has also been removed.
- Shared pages, downloads and invalid-link responses use no-store caching, no-referrer policy and noindex/nofollow/noarchive directives. Public routes bypass account/password-change redirects but require a valid signed link. Private invoice/PDF routes continue to require shop authentication.
- The customer page uses local CSS, system fonts and no JavaScript, avoiding extra work on low-end phones. It uses a table on larger screens and item cards on phones.

## What permanent means

There is no time-based expiry. Continued access depends on retaining the bill, keeping the public domain reachable and preserving the same SECRET_KEY. Deleting the bill, restoring a different record at its ID, changing the domain or rotating the signing key can invalidate access. Existing long-link signatures also depend on that key. Keep the deployment's current .env; do not generate a new key simply when uploading this ZIP.

Anyone possessing the signed link can view/download that bill. Shop credentials are not required and are not embedded in the URL. No third-party shortening service is used, and no mapping table, column, database replacement or migration is needed.

## Preservation and deployment

The existing database was not used for tests or modified during implementation. All model definitions, schema helpers, V1 calculation functions and the original preview parser remain structurally identical to the pre-update versions. Testing uses temporary synthetic databases and an in-memory frozen reference.

Deploy source, templates and static assets only. Preserve the existing database, instance folder and .env, especially SECRET_KEY. Do not run init_db.py or a migration. Reload the PythonAnywhere web application afterward. This task does not publish or alter the hosted deployment.

## Validation

- Focused sharing/workflow suite: **23 passed**. Checks include stable compact tokens, future-time access, ancient legacy tokens, tampering, other/reused invoice IDs, deleted records, private-route protection, attachment headers, data escaping and access from an account with a required password change.
- Chromium and WebKit mobile simulations passed opening the customer link anonymously, checking 320/390/768/1440px layouts, downloading a real PDF through the bottom button, rejecting altered links and retaining private PDF protection. The new page screenshots were visually inspected.
- Full regression suite: **436 passed**. Route coverage includes **68 URL patterns**, **237 GET/POST method/role probes**, missing-token protection on **30 POST routes**, and **118 HEAD/OPTIONS requests**. Financial/V1, inventory, security, concurrency and backup regressions passed.
- The slowed-device suite passed with 6× CPU throttling and constrained network, including short-link customer PDF retrieval, recipient/message preparation, native PDF share/cancel and 20 responsive views. Camera-worker heartbeat p95 was 297 ms in that simulation.
- Ruff, JavaScript syntax and whitespace checks passed. The release archive was checked for file integrity and excludes databases, environment secrets and caches.

Route and preservation evidence is included in inventory.json, matrix.json, protocol.json and preservation.json.

Browser simulation does not certify physical Android/iPhone behavior. No real WhatsApp message was sent and no live customer data was opened. Existing historical release reports describe earlier behavior; this report supersedes their statements about 48-hour bill-link expiry.
