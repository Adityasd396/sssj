# Counter UI and mobile usability release — 23 November 2026

## Changes

- Larger readable form text, clearer secondary text, stronger focus states and touch targets. Tablet layouts retain tables; narrow phones use record cards.
- Inventory keeps search and stock availability visible. Category, code style, sorting and weight ranges sit under More filters, with one explicit Search action. Gold, silver and overall product counts remain visible; expanded totals retain their complete stock/weight figures.
- Collapsed bill items still show weight, applied metal rate, making charge and line total from the existing server preview. Pending and failed previews show their state rather than presenting old figures as current.
- Bill-rate editing is collapsible and restored with a draft. Existing account balance is shown separately from receiving/due for this bill. No extra balance calculation was introduced.
- Mobile billing uses one bottom payment dock. The step navigation scrolls with the page, and the main navigation remains available through the header menu. Existing keyboard clearance and Back handling remain.
- A scanned item receives a brief outline and keyboard/screen-reader focus. Scanning stays automatic and inline, without a confirmation dialog.
- Customer history displays 25 records per section, with independent paging and search. Account summaries still use all records, and the full statement remains available. Currency now displays exact cents on customer summary cards.
- Sharing messages distinguish opening WhatsApp, starting a PDF download and completing the device share action. They do not claim confirmed customer delivery.

## Database and V1 calculations

The existing shop database was not opened for testing or changed. No tables, columns, indexes, migrations or data conversions were added. All 23 protected model/calculation definitions match the pre-update structural snapshot. The original V1 pricing comparisons pass. Displayed item figures come from the existing authoritative server preview; save validation, stock changes and monetary formulas retain their existing behavior.

The customer history change bounds rendered rows, not the entire server workload: existing full-history loading and summary arithmetic are intentionally retained. Full printable statements still grow with record count.

## Verification

- **443 Python tests passed**, including all existing route/security/concurrency/backup/pricing cases and four new counter-UX tests.
- New synthetic 80-record history checks cover pagination, filtering, clamped page numbers, unchanged all-record totals and complete printable statements. Staff controls and exact-cents displays are covered.
- Chromium and WebKit mobile checks passed inventory filter behavior, visible gold/silver counts, tablet tables, searchable paged history, server-approved item figures, separate account/current-bill amounts and the single mobile payment dock. No horizontal overflow at tested widths from 320 to 1440 pixels.
- Full browser regression passed checkout/customer creation, draft and validation recovery, mobile cards/navigation, print rendering, 125 responsive screen checks and touch interactions.
- Chromium and WebKit passed guided billing, keyboard clearance, Back handling, tab-loss recovery, duplicate-save protection, blocked-storage fallback, permanent anonymous bill links and PDF downloads. Inventory/rate checks include zero-stock products, totals, categories, filters, draft rate recovery, preview/save agreement and unchanged master rates.
- A 6× CPU/constrained-network simulation passed quick-customer creation, mobile save, PDF/WhatsApp preparation, native share/cancel, 20 responsive views and camera worker responsiveness (heartbeat p95 215 ms). This is a simulation, not a physical-device performance guarantee.
- Virtual-camera tests passed small QR within a 4K frame, 1D capture, requested autofocus/exposure controls, automatic add, Back/Escape, permission denial, unknown-code cooldown, late-stream cleanup and manual fallback. Both engines passed photo decoding, offline failure/retry and zero preview traffic for empty bills.
- Narrow iPhone filter overflow discovered during regression was fixed with single-column filters below 400 pixels and constrained native field sizes. Hidden mobile table headers also avoid intrinsic table overflow while remaining in the document.
- Virtual-authenticator passkey registration, signed login, replay rejection and removal passed. Remote customer search, Enter selection and recovery beyond the initial list passed in Chromium and WebKit on a fresh synthetic shop.
- Python lint, modified JavaScript syntax and whitespace checks passed. Bundled styles and all 25 compressed assets are rebuilt and checked during packaging.

Testing uses isolated synthetic shops. Browser emulation and virtual cameras/authenticators do not certify physical Android/iPhone cameras or USB/Bluetooth printers. No live customer messages were sent. Device lens, focus range, lighting and browser support still determine minimum readable tag size.

## Updating the existing shop

Upload code, templates and static assets, keep the existing database, instance directory, .env, SECRET_KEY and DATABASE_URL, then reload the application and refresh open tabs. **Do not run init_db.py or a migration for this update.** The archive excludes live data, secrets, development caches and environments.

For later source edits, rebuild styles before compressed assets:

```sh
python scripts/build_styles.py
python scripts/build_assets.py
```

## Shreyans CD410 setup addition

Added a dedicated CD410 section on Printers, with separate label/receipt driver guidance, USB/Bluetooth setup, official Android/iOS app links, label-gap calibration and exact-size instructions. Tag previews and receipt setup link directly to it. Existing tag dimensions, receipt layouts, database and all pricing code are unchanged.

Official source checked on 23 November 2026: https://www.shreyanspos.com/pages/driver-for-thermal-label-printer-cd410 . Manufacturer installers remain on the official site rather than being redistributed.

Chromium and WebKit checks passed four responsive widths (320, 390, 768, 1440), the tag setup link and exclusion of controls from print output. Physical CD410 output has not been tested. This is driver/print-dialog setup support, not a raw USB/Bluetooth integration. Mobile direct printing requires a compatible print service; manufacturer app file import and device support must be checked on the actual phone.

CD410 follow-up: all 18 focused workflow/counter-UX tests passed after the setup edits. The broader route sweep is unchanged by this template-only addition.
