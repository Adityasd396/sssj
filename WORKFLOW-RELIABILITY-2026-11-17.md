# Workflow reliability update — 17 November 2026

## Existing shop data

This update changes code, templates and static assets only. It adds no database
models, columns, indexes or migrations. Existing inventory, bills, customers,
settings and credentials were not opened or modified during development. All tests
use isolated synthetic databases under temporary folders or `.cache`.

For an existing installation, replace the code/assets and reload the web app.
Keep the existing `.env`, `instance` directory and configured DATABASE_URL.
Do not run `init_db.py`, restore a different database, or replace the live data
with development/test data. Install no new runtime dependencies for this update;
itsdangerous is already supplied by Flask, and the camera uses the bundled codec.
The normal existing schema bootstrap remains part of the app; this patch does not
add any schema changes to it.

## Changes

- **Customer during checkout:** the dialog has an explicit POST form/CSRF token,
  readable errors, a timeout and a recoverable busy state. Stale CSRF tokens refresh
  once through the authenticated session endpoint without losing the unfinished
  bill. A changed account cannot silently take over an unfinished bill. Both form
  and JSON API requests work. Repeating the same customer/phone returns the same
  record, including common phone formatting; a conflicting name offers an explicit
  Use existing customer action. Existing customer phone values are not rewritten.
- **Inventory:** search name/tag or exact weight such as `2.125 g`. Weight-from and
  weight-to filters search grams per piece. Bulk goods sold by grams are excluded
  from weight-per-piece searches. Actual pagination limits each page to 25 records;
  totals are SQL aggregates instead of loading all inventory into memory. Products
  with no stock appear once in the out-of-stock section. Filters persist between
  pages. A stale edit shows current values with a review message, retaining the
  version protection. Customer instructions confirmed inventory actions already
  work; this update improves the workflow rather than changing stored stock rules.
- **Billing/server:** creation no longer fetches the whole inventory table. Document
  reads prefetch line/product data to avoid per-item database requests. Outstanding
  balances use a grouped payment query instead of one query per invoice. Preview
  requests debounce at 400 ms and ignore the customer-search textbox. The original
  calculation functions and valid-transaction results remain covered by tests.
- **WhatsApp:** the primary action opens the saved customer's international number
  with the bill summary, thank-you message and a 48-hour PDF link. The customer can
  open that signed link without a shop login; tampered, expired, deleted or reused
  bill identifiers are rejected. Whoever has the link can open that bill until it
  expires, so treat it as private customer correspondence. It uses no extra tables
  or files. Only the first ten items are included in the chat summary to keep links
  manageable; the PDF contains the complete bill. The message can be edited inline.
- **PDF attachment:** Prepare PDF attachment fetches only when requested and verifies
  that the server really returned a PDF. A second tap shares the prepared file and
  full message with a fresh user gesture, avoiding slow-network activation expiry.
  The OS share menu lets the user choose WhatsApp and the recipient. Web Share does
  not select a WhatsApp recipient automatically. Unsupported devices can download
  the PDF and attach it manually. Cancelling does not unexpectedly open another
  app/chat. There is no WhatsApp Cloud API integration or automatic message sending.
- **PDF robustness:** customer/product text is escaped before ReportLab's paragraph
  parser, so angle brackets/ampersands cannot break document generation.
- **Camera:** high-resolution capture and continuous autofocus are retained where
  supported; capture is limited to 12–15 fps to reduce heat/bandwidth. Cropped camera
  frames are decoded in a local worker. WebCodecs VideoFrame transfers let supported
  browsers move cropping/resizing into the worker too. Bounded crops, sequential
  attempts, adaptive pauses and cleanup reduce UI blocking. The older-browser
  fallback is throttled and bounded. Tiny-code detail uses native-resolution centre
  crops. Camera frames/photos are not uploaded or stored on the server.
- **Loading:** the 441 KB decoder is lazy-loaded for scanning, not parsed on every
  app page. Static requests bypass database/session lookups and are cacheable;
  authenticated business data remains no-store. CSS/JS versions were updated.
- **Interface:** removed decorative scanner copy, an extra bill-delete prompt, and
  unavailable owner-only actions from cashier bill views. Destructive confirmations
  and scanner product confirmation remain to prevent costly mistakes.

## Printers

Open **Printers** in the sidebar. The page links to the official Shreyans model
support pages for KP307, KP206-UB, CD410, CH421, PSF423 and PSF588, plus the full
manufacturer directory. Choose the model printed on the actual printer before
installing its driver/application. USB and Bluetooth were confirmed; exact model
numbers were not supplied. No printer driver was installed on the user's computer.

Bills now offer **Thermal receipt**, with 58 mm and 80 mm layouts using the same saved
bill facts. Existing tag sizes/designer/calibration are retained, and tag previews
link to printer setup. The browser uses the installed system printer/print service.
Bluetooth pairing alone is not sufficient if the OS/browser has no compatible print
service; the model's official app may be required. Set the matching paper/label size,
100% scale and disable browser headers/footers. Physical printing and tag alignment
still require the actual hardware; no physical printer was accessed by these tests.

## Verification

- Full Python regression suite: 109 passed, including original-calculation
  comparisons, stock/payment concurrency, access control and 14 new workflow cases.
- New tests cover form/JSON customer creation, safe retries, stale-token recovery,
  weight filtering and pagination, unchanged schema during record reads, public PDF
  validity/expiry/tampering/deleted-ID protection, receipt widths and cacheable
  static assets with zero database queries.
- Browser slow-device simulation: 6x CPU throttling, 100 ms network latency and
  250 KB/s download / 100 KB/s upload. Customer creation recovered a bad CSRF token,
  preserved its line item, saved the bill, generated the correct recipient link,
  opened the PDF in an unauthenticated customer context, and handled PDF file sharing
  and cancellation. No real WhatsApp message was sent.
- The slow-device camera used a synthetic 4K stream and a separate worker without
  loading the decoder into the main page. Its UI heartbeat p95 varied from 199 to 324 ms across
  the worker-enabled runs at 6x CPU throttling. These are synthetic test-run
  observations, not a real-phone benchmark or a guaranteed improvement percentage.
- Browser coverage includes 20 new responsive route/width combinations, existing
  125 responsive views, virtual camera lifecycle/permission/late-stream checks,
  automatic existing-QR reading and ten product layouts. Static checks pass.

## Deployment acceptance

Upload code/assets without replacing database or environment files, reload the
hosted app, then refresh the browser to load the updated assets. On PythonAnywhere,
serve `/static/` from this project's `static` directory using its Web-tab static
mapping if not already configured. Keep the existing HTTPS/passkey origin settings.
Test one real sale/customer, the actual client phones and each installed printer
before handover. Do not manufacture demo bills in the real shop merely to reproduce
these automated tests; use a separate staging database for further testing.

## Primary references

- [WhatsApp click-to-chat](https://faq.whatsapp.com/5913398998672934)
- [Web Share API and user activation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API)
- [WebKit explanation of sharing activation expiry](https://webkit.org/blog/13862/the-user-activation-api/)
- [Shreyans official drivers/model menu](https://www.shreyanspos.com/)
- [KP307 USB/Bluetooth setup](https://www.shreyanspos.com/pages/kp307)
- [KP206-UB setup](https://www.shreyanspos.com/pages/psfkp206-ub)
- [CD410 support](https://www.shreyanspos.com/pages/cd410)
