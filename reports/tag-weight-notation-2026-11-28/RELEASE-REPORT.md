# Tag weight notation — 28 November 2026

## Change

Weights printed on tag layouts now use jeweller notation: grams before the decimal, a slash, then three fractional digits. For example, `5.1 g` prints as `5/100`; `5.01 g` as `5/010`; and `5.001 g` as `5/001`.

The formatting is limited to tag printing and Tag Studio's tag preview. Inventory, product details, bills, saved product weights, and all pricing or billing calculations retain their existing representations and values.

Bulk roll PDFs contain one exact-stock-size page per tag, in order, without software-added spacer pages or page margins. The physical gap between stickers remains a printer/stock setting.

## Verification

- Formatting cases including rounding, whole grams, and sub-gram values: passed.
- PDF tag-row formatting: passed; the product's stored weight remained unchanged.
- Three-tag bulk PDF: passed at three consecutive 38 × 15 mm pages, with no extra spacer page.
- Full project Python suite: passed.
- Tag Studio, single-tag and batch routes, and exact-size tag PDF smoke checks: passed.
- Browser visual automation was not run because the browser could not reach the local synthetic test server.

No database tables, columns, or migrations were changed.
