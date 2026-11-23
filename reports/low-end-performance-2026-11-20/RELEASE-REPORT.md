# Low-end mobile/server performance update — 22 November 2026

## Database and calculation protection

The production database was not used for implementation or tests. No tables, columns, indexes, migrations or bulk data repairs were introduced. Model definitions, existing migration helpers, V1 calculation functions and the original preview parser were compared structurally with the pre-update source and remain unchanged. Frozen-original pricing cases passed. Normal user-initiated saves still perform their existing stock/payment/ledger operations.

This update improves reading, delivery and camera/UI scheduling. It does not add an offline billing queue or cache financial results across devices. Save still performs a fresh server preview and server validation.

## Measured server improvements

Same synthetic dataset before and after: 100 invoices across 61 customers. These are SQL statement counts, not a guarantee of production response time.

| Page | Before | After |
|---|---:|---:|
| Collections | 248 | 4 |
| Bill list | 30 | 5 |
| Customer history | 46 | 6 |
| Customer statement | 46 | 6 |
| Overview | 21 | 14 |

Collections now obtains invoice dues with one grouped payment join instead of querying each customer separately. Lists preload customer relationships and batch payment totals. Customer history/statements reuse payment records already fetched. Dashboard month totals are grouped once and outstanding amounts are aggregated in SQL. The calculations and reporting definitions are unchanged; query-budget tests separately assert collection totals, outstanding counts, history amounts and absence of data-writing SQL in these GET flows.

Full printable histories and all-time reports can still grow with the shop's data. This release does not truncate those records or claim that every report is constant-memory.

## Download and phone work

- Public JS/CSS/SVG variants are precompressed at build time. The decoder asset is **110,767 bytes instead of 441,121 bytes** over the tested gzip path, approximately 75% less transfer data.
- The handler checks both original and compressed asset hashes, negotiates gzip, varies caches by encoding and supports conditional requests. Missing/stale/corrupt variants fall back to original files. Private HTML, CSRF tokens and bill data are not compressed or newly cached by this module.
- First-use compression happens at build time, avoiding repeated compression work on a small server. The first request verifies hashes; verification is reused until file/manifest stamps change.
- Hosting that serves /static directly bypasses Flask's asset handler and must use its own compression configuration. The Flask path was tested; hosting-specific response times were not benchmarked.
- Empty bills do not send pricing-preview requests. Meaningful populated-bill changes still obtain authoritative totals, and save revalidates against the server.

## Simple automatic scanning

- The camera appears inline in the page, replacing the app's camera dialog. Opening Scan tag automatically requests the rear camera. There are no Start, Switch, Zoom, Light, result-confirmation or Scan-again buttons.
- On a bill, a recognised tag is checked against current inventory and added once; no bill is automatically saved. Elsewhere, a recognised tag opens its product details. Product entry's camera fills the existing code field and saves no image.
- Close remains available. Photo/code entry is tucked into one optional fallback section. Back and Escape close the camera, including rapid reopening. System camera-permission prompts are controlled by the browser/OS and cannot be removed by the site.
- Unknown/out-of-stock tags retain the live camera and show an inline message, with repeated automatic lookups bounded by a cooldown. Explicit/manual retry is immediate after reconnection.
- Camera streams request 3840×2160, then the device's reported maximum resolution where accepted, at a bounded 15 fps. Continuous focus, exposure and white balance are requested only if reported; tap-to-focus is applied when the browser supports points of interest. Optional hardware adjustments run alongside recognition instead of blocking it.
- Workers receive transferable frames or bounded bitmaps. Native detection runs in the worker when available; the bundled decoder supplies missing formats. The UI thread no longer performs full-frame native detection on the worker path.
- Scanning starts with a central high-detail crop, alternates through wider views, and includes rotated 1D decoding. Buffers/readers are reused, frames are processed one at a time, repeated stale-frame work is limited and scheduling adapts to actual decode cost. Old browsers retain a slower bounded main-thread fallback.
- Photo decoding also runs through the worker path where supported and tries full/central/corner regions. Replacing/clearing a photo cancels stale work. Images, URLs, frames and camera tracks are released on completion, close, backgrounding and navigation. A stream that starts after closing is stopped; a stream that never produces a frame times out.

Browser/device support varies. Highest resolution alone does not guarantee readability: autofocus range, lens, lighting, print contrast and module size matter. Physical devices were not certified. The capability-based approach follows the [W3C image-capture controls](https://www.w3.org/TR/image-capture/); unsupported controls fall back to the browser's own camera behavior.

## Verification

- **439 Python tests passed**, including all registered routes, financial/V1 comparisons, security, concurrency, backup/restore, sharing, inventory/rate and new performance cases.
- Route coverage: **68 patterns**, **237 GET/POST method/role probes**, CSRF checks on **30 POST routes**, and **118 HEAD/OPTIONS requests**.
- New performance tests assert query budgets and expected money/history values, read-only GET operations, compressed delivery/304 responses, explicit gzip rejection, stale/corrupt fallback and path-traversal rejection.
- Virtual-camera checks passed small QR in a 4K frame, 1D barcode, continuous-focus/exposure requests, auto-add without confirmation, Back/Escape, denial, late-stream cleanup, unknown-tag throttling and manual fallback. These test control requests, not real lens autofocus accuracy.
- Final browser checks passed in Chromium and WebKit: guided checkout, keyboard clearance, Back behavior, duplicate-save protection, tab-loss recovery, blocked-storage fallback, inventory filters/categories/rates, anonymous permanent customer links and actual PDF downloads.
- Photo/code fallback passed QR and 1D decoding without camera dialogs in both engines. Empty bills sent no preview requests. Offline lookup left existing items unchanged; reconnecting and retrying added the item once.
- Existing smoke coverage passed **125 responsive screen checks**, customer/validation recovery, mobile record cards, navigation, touch and print flows. Product QR creation/upload/disposal checks and ten responsive layouts passed.
- A 6× CPU-throttled/constrained-network workflow passed customer creation, save, PDF/WhatsApp preparation, native share/cancel, twenty responsive views and worker responsiveness. Camera heartbeat p95 was 187 ms in that simulation; this is not a physical-device guarantee.
- Passkey registration, real signature verification, resident-key login, replay rejection and removal passed with a virtual authenticator. Bounded remote customer search and recovery outside the initial list passed in both engines.
- Ruff, JavaScript syntax, bundled-style consistency and whitespace checks passed. All 25 compressed assets were verified against their source hashes and decompressed contents before packaging.

No live customer messages or physical printer actions were performed. Browser simulations are not physical Android/iPhone or printer certification.

## Deploying safely

Upload code, templates and static assets while preserving the existing database, instance directory and .env/SECRET_KEY. **Do not run init_db.py or a database migration.** Reload the hosted application and refresh open browser tabs. The ZIP includes the new asset_delivery.py module, precompressed assets and manifest.

The ZIP's assets are already built. If editing source or using a Git checkout that changes line endings, rebuild both in this order:

```text
python scripts/build_styles.py
python scripts/build_assets.py
```

The asset handler safely falls back to originals if hashes no longer match. Keep the current public domain, key and bill records so existing permanent customer links remain valid.

Evidence files: query-counts.json, route-inventory.csv, inventory.json, matrix.json, protocol.json and preservation.json.
