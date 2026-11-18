# Mobile experience update — 17 November 2026

## Changes delivered

- Continuous Customer → Items → Payment guidance, without hiding required bill fields or changing what Save bill does.
- Compact scanned-product rows on phones; quantity stays visible, with weight, making and price available in an expandable section. Manual rows and desktop retain expanded fields.
- Keyboard-aware spacing, visible Done control, safe-area support and larger touch targets. Mobile blur effects are disabled to reduce rendering cost; reduced-motion preferences are respected.
- Back closes open dialogs and navigation. Returning from a record preserves inventory/customer/bill filters and list position.
- Recent customer shortcuts use current customer records and balances.
- Recoverable drafts survive closing a tab when browser storage is available. Drafts are account-scoped, expire after 24 hours and are limited to three per browser. Logout clears account drafts and recent customer shortcuts. Shared devices should always be logged out after use.
- Saved-bill confirmation, duplicate-save protection and cross-tab completion notices. Financial totals still come from the existing server calculation preview; no offline bill posting or automatic financial replay was added.
- Device-only 58/80 mm receipt preference and a sample print page that creates no invoice.
- Existing high-resolution camera capture and bounded worker decoding remain in place. The phone's hardware, focus, lighting and print quality still determine the smallest readable QR.

## Data and calculation protection

No production database or environment file was opened, replaced or migrated during this update. No database initializer was run. Backend, security, recovery, passkey and sharing modules, requirements and the frozen V1 fixture were compared with hashes captured before this mobile update: all remained byte-for-byte unchanged. Monetary values continue to use the existing V1-compatible server rules, not a new mobile calculation.

Drafts can include unsaved customer details and item information in browser storage. Storage is optional: blocked device storage falls back to tab recovery; if both stores are unavailable, recovery cannot be promised. Saving a bill requires a working connection and successful server validation.

## Verification

- 109 Python tests passed, including frozen-original pricing comparisons and database/security checks, using temporary test data.
- Existing responsive smoke checks passed across 125 layouts plus checkout, draft, customer, touch and print flows.
- Chromium and WebKit mobile browser checks cover guided billing, compact rows, simulated keyboard clearance, dialog/menu Back, tab-loss recovery, one-save behavior, cross-tab completion, filtered list return, logout clearing and blocked local storage.
- Layout checks cover 320, 390, 768 and 1024 pixel widths.
- A workflow run with 6× CPU slowdown and constrained network passed customer creation, checkout, PDF/WhatsApp preparation, share cancellation and 20 responsive views. Camera heartbeat p95 in that simulation was 282 ms; this is not a guarantee for physical devices.
- Virtual camera checks passed automatic start, small QR decoding in a 4K frame, denied permission and cancellation. QR photo capture/upload and cleanup passed 10 responsive checks. Virtual-authenticator passkey registration, login, replay rejection and removal passed.
- JavaScript syntax, style bundle consistency and whitespace checks passed.

Browser engine/device emulation is not physical Android or iPhone certification. Actual keyboard behavior, camera performance, biometric prompts and USB/Bluetooth printer output still need a short acceptance check on the customer's devices. Browser history and viewport behavior can vary by OS version.

## Deploying over the existing shop

Upload the source/assets from the release ZIP to the existing deployment. Keep the shop's current database, instance folder and environment settings. Do not run init_db.py, replace the database, or upload a test database. Reload the hosted application and refresh browser assets after deployment. The ZIP excludes databases, local environments, secrets, caches and Git history; it includes source, tests and deployment documentation for committing to a repository.
