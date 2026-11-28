# Tag Studio print controls — 28 November 2026

## Changes

- Added top, middle, and bottom positioning for tag text and QR artwork.
- Added regular or bold controls for tag text and a separate regular or bold setting for product weight.
- Kept the existing top/bottom and side tag padding controls, and added roll width, feed height, paper margins, rotation, driver gap, and shifts to Tag Studio.
- Added named printer presets saved in the current browser, so different label stocks and printer setups can be recalled without adding database fields.
- Added live readouts for the tag’s physical area, the printable area after padding and borders, and the preview’s content bounding box.
- Passed Tag Studio settings into individual tag and batch print requests. PDF pages retain the measured stock size.

## Data and calculation boundaries

No database tables, columns, records, or migrations were changed. Printer presets and print-only position/font settings are stored in browser local storage. Existing tag-design fields continue using their current database columns. V1 billing and metal-rate calculations were not changed.

The content footprint is a bounding box around visible text, barcode, and QR layout elements. It estimates used layout space and is not a measurement of black-ink coverage. A shaped tail contributes its actual tail-strip area, not the empty rectangular space around it.

## Verification

- Full Python suite: `python -m pytest -q` — passed.
- Synthetic Flask client: Tag Studio page, individual tag page, batch tag page, and adjusted PDF — passed.
- Exact-size PDF check: one page at 38 × 15 mm — passed.
- Rendered Tag Studio inline JavaScript and browser test source syntax checks — passed.

Browser-driven visual automation was not completed in this run because the browser process could not reach the local synthetic test server. The route and PDF checks above used an isolated synthetic database; they did not access the shop database.
