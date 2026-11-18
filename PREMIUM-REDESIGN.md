# Premium workspace redesign — 31 October 2026

## Calculation baseline

The client clarified that “V1” means this project's original code before the previous changes: Git commit `007cfc1`. It does **not** mean the adjacent “Billing by workbuddy V1” folder.

The original calculation functions are restored: line pricing, metal rates, making basis/defaults, money conversion/validation, discounts and exchange. The original credit-limit timing and invoice status decisions are retained. In particular, a zero making charge once again selects the original default, just as a blank value does. No new tax policy was introduced.

Browser-side monetary calculations have been removed. A read-only preview endpoint uses the original checkout parsing and calculation sequence, and returns integer-paise totals for display on every device. On save, the original checkout calculations run again. Preview does not create an invoice, collect a payment or reserve inventory. Existing retry identity and transactional stock/ledger protections are separate from pricing policy.

Tests run a frozen copy of the original application in its own in-memory database and compare its saved transaction with the current preview and checkout. Twenty scenarios cover gold/silver modes, blank/zero/custom making, general and fractional items, weighed stock, multiple lines, both discount types, direct/weight-based exchange, full/partial/no payment, GST disabled and rounding. Nine original calculation/validation functions also have semantic source-preservation checks.

## Shared visual system

- Deep green navigation, warm ivory workspace, restrained gold actions and locally served Manrope/Cormorant typography.
- Desktop sidebar grouped around the shop's daily work; tablet/phone drawer with a close control, backdrop, Escape support and keyboard focus containment.
- Phone bottom navigation for overview, customers, new bill, bills and collections.
- Organised overview: collections, outstanding balances, inventory and customers first; recent bills, trends, rates and shortcuts below.
- Consistent cards, labelled forms, tables, badges, validation, empty states, typography and spacing across the application.
- Billing sequence: customer → items → payment. A desktop side summary and compact small-screen save bar keep the total and direct Save bill action accessible.
- Touch-friendly scanner, mobile record cards, recoverable drafts, customer creation during checkout and explicit submission feedback.
- Screen-only styling around printed documents preserves their physical print geometry.

The shared stylesheet is generated from ordered sources:

```text
static/css/components.css
static/css/responsive.css
static/css/premium.css
static/css/scanner.css
        ↓ python scripts/build_styles.py
static/css/app.css
```

Edit the source styles and rebuild. The generated bundle is committed alongside the sources so running the shop does not require a CSS build tool. Document-specific print styles remain owned by their templates. Page behaviour is separated into `app-shell.js`, `billing.js`, `invoice-pricing.js`, `bill-draft.js` and `tag-scanner.js`.

## Tag scanning

One Scan tag entry point is available from the header and billing screen:

1. **Camera:** explicit start, rear-camera preference, sharp video request, conditional autofocus/torch/zoom, camera switch and clear permission/device errors.
2. **Photo:** locally decode QR or 1D tags from JPG/PNG/WebP, with size limits and orientation retries.
3. **Code:** type or use a USB scanner, then press Enter.
4. **Confirm:** display the matched inventory item, metal, weight, available stock and code before adding it. Unknown tags do not add a row. Outside checkout, the action starts a bill with the recognised product.

Tags identify products; printed prices are never trusted as the selling-price source. Repeated scans retain the original add-row behaviour. Camera streams are stopped on close, method switch, page hide and late permission completion. Stale lookups/decodes cannot replace a newer scan result.

ZXing Browser **0.2.1** is bundled locally, with its downloaded package verified against npm's SHA-512 integrity value. Native detection is used when it supports both QR and Code128; the local decoder is the fallback. No scanner engine is fetched from a CDN. Product lookup and pricing still require the shop server; this is not offline billing.

## Verification

- **65 Python tests passed:** 20 original/current transaction comparisons, nine preserved-function checks, workflow regressions, isolated migration/concurrency checks, a read-only-preview test and bundle/source agreement.
- **125 responsive screen checks passed:** 25 screens at 320, 390, 768, 1024 and 1440 pixels, plus desktop/mobile screenshots and touch interactions.
- Browser workflows passed for draft recovery, quick customer creation, retained input after server rejection, preview/saved-total agreement, navigation and print rendering.
- Actual QR and Code128 image fixtures decoded successfully, and manual lookup/confirmation were exercised.
- Virtual-camera checks passed for start, release on close, denied permission, late-stream cancellation and confirmed scan-to-bill.
- Python formatting/lint and first-party JavaScript syntax checks passed.

These checks used synthetic databases and Chromium. They do not constitute a guarantee for all hardware, all browsers or every possible transaction.

## Reproduce locally

```text
python scripts/build_styles.py
python -m pytest
ruff check .
ruff format --check app.py tests scripts/build_styles.py
```

For browser checks, install Playwright in a development environment. Start `python tests/serve_preview.py`; it binds only to `127.0.0.1:56837` and creates a fresh synthetic database under `.cache/`. Its fixture login is `ui-owner` / `preview-password`. It never opens the shop database. `BILLING_PREVIEW_PORT` can select another unused port.

Run `python tests/make_scanner_fixtures.py` to generate the QR/Code128 fixtures under `.cache/`, then run `node tests/ui_smoke.cjs`; the tests expect code `GOLD-01`. Then run `node tests/scanner_camera.cjs`. `PLAYWRIGHT_PATH` and `CHROME_PATH` can select existing local installations. Screenshots and a print PDF are written under `.cache/ui-verification/`.

## Design and browser references

The interaction choices were checked against primary documentation on 31 October 2026:

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/): readable interaction, target sizing, keyboard access and keeping focused controls visible. This is a design reference, not an accessibility certification.
- [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia): camera permissions and secure-context requirements.
- [MDN Barcode Detection API](https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API): native detection has limited browser availability, so it cannot be the only decoder.
- [ZXing Browser documentation](https://github.com/zxing-js/browser): image/video decoding and scanner stop controls.

## Bundled assets and acceptance

Sources, versions and SHA-256 hashes are recorded in `static/asset-notices.json`. Scanner notices are in `static/js/vendor/`; font OFL notices are in `static/fonts/`. The decoder/fonts are distributed locally with these notices.

Before handing the shop over, check the client's actual iOS/Android browsers, camera focus on their smallest tags, HTTPS/LAN setup, USB scanner input, invoice printer, tag printer, paper size and scale. No physical camera or printer was used by the automated tests. The application remains local and has not been deployed.


## Save-button correction

The fixed bottom control now submits the invoice form directly instead of navigating
to the payment section. Both Save bill buttons share validation, busy feedback and
submission protection. The mobile browser workflow exercises the bottom button and
verifies that saving opens the created invoice with matching totals. Calculation rules
are unchanged by this correction.

## Existing QR labels and record tables

Add product now accepts an optional QR image (JPG/PNG/WebP, up to 15 MB).
The bundled decoder reads the image locally; only its linked identifier is saved,
using the existing unique product barcode field. No image storage or database
migration is needed. Leaving it blank keeps automatic code generation. Duplicate
codes are rejected with entered product details retained; simultaneous inserts also
receive a recoverable message. URL-shaped codes are supported by the scan route.
As with the existing scanner, legacy pipe-separated tag metadata is ignored after
the identifier. Codes are limited to 100 printable characters.

Shared record tables now have clearer headers, alternating rows, hover contrast,
more spacing and aligned numeric values. Stock rows include the product code and
explicit pieces/grams. Phones retain labelled record cards.

Validation: 69 Python tests, QR image decoding through saving and lookup in a real
browser, invalid-image recovery, 10 targeted responsive checks, and the existing
125 responsive screen checks plus checkout/touch workflows passed. Calculations
are unchanged. `tests/product_qr.cjs` uses the isolated preview and fixtures from
`tests/make_scanner_fixtures.py`.

## Small QR camera scanning

The camera now requests up to 3840 x 2160 with optional native capture and 30 fps;
browsers choose the actual supported resolution. Existing continuous autofocus,
hardware zoom and torch controls remain capability-dependent. Actual resolution
is shown in the scan status. Decoding alternates full-frame and centre crops,
with nearest-neighbour enlargement for small crops and local fallback even when
the native detector misses. Work is sequential and yields between attempts.

A synthetic 74-pixel QR in a 3840 x 2160 stream was recognised in Chromium.
Automatic startup, permission refusal, late-stream cleanup and scan-to-bill passed.
This is not a minimum physical label size guarantee: check real client cameras,
lighting, focus distance and label print quality before handover.
Camera constraints follow https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints.

## Existing QR photo capture — 4 November 2026

Add product now offers Take photo alongside QR image upload. On secure connections,
it opens an in-page rear-camera preview with optional continuous focus and captures
one frame to memory. QR decoding remains local. The linked code is saved only when
the product is saved; photo controls have no form field names, so photos are never
submitted to the server. Image object URLs are revoked, file selections cleared and
working canvases released after processing. Camera tracks stop on capture, cancel,
close, page hiding and late permission completion.

If browser camera access is unavailable, the native capture input offers the device
camera/file picker. The app discards its reference after reading, but cannot delete
an original gallery photo or a separate copy retained by the operating system.

Verified with a synthetic camera: capture and decoding, no File in submitted form
data, empty image selections after decoding, camera shutdown, permission-denial
recovery, upload/save/lookup, and 10 responsive checks passed. Physical camera quality
and the native mobile capture picker still require real-device acceptance.

## Automatic existing-QR reading — 4 November 2026

The existing-QR camera now reads continuously without pressing Capture. Both this
camera and Scan tag request the selected camera's maximum reported width/height,
with the initial working stream retained if that optional request fails. Focus,
zoom and torch adjustments preserve the resolution constraints. Browser/hardware
negotiation determines the actual usable resolution, which is shown in scan status.
Full-frame and centre-crop decoding retain detail while bounding working canvas
sizes; attempts run sequentially with a pause for responsive controls. Detection
closes the product camera, stops tracks and retains only the validated QR identifier.
Photo upload/manual capture remain available as fallbacks. Synthetic browser checks
cover automatic reading, maximum-resolution requests, image disposal, camera cleanup,
permission refusal, saved-code lookup and 10 responsive layouts.
