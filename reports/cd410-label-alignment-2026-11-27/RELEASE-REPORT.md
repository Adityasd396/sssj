# Shreyans CD410 label alignment

## Set up the roll

1. Measure one sticker face in millimetres, across the roll and then in the feed direction. Set those two dimensions as custom paper in the CD410 label driver. Enter the gap separately if prompted.
2. Use Gap media for die-cut labels and run the manufacturer's calibration. Feed should advance one sticker. See [official CD410 setup and drivers](https://www.shreyanspos.com/pages/driver-for-thermal-label-printer-cd410).
3. In **Print tag**, use **Tag orientation** and **Update preview**. Quarter-turns swap the requested paper dimensions. A half-turn corrects upside-down output while keeping the same paper dimensions. Match the requested size to the stock and keep additional rotation off.
4. In the driver or system print dialog, use one page per sheet, actual size (100%), no margins, and no headers or footers. Print **one test label**, then one product tag. Check the frame, arrow and QR scan before sending the batch.

On a phone, the device's print service or vendor app must offer the correct custom size. The app supplies the print layout and cannot change the CD410's sensor or driver preferences. Use the separate receipt test after loading continuous paper.

## Changes and verification

- The calibration preview emits a single page at the selected label size, with an inset frame and orientation arrow.
- Roll batches print a single size group at a time. Sheet printing keeps the existing ordering and includes all groups.
- Print buttons wait for edits to be applied to the preview. Print controls are hidden from the printed page.
- Chromium PDF checks covered exact page dimensions within Chromium's print rounding, a quarter-turn, a half-turn, a single test label, a three-copy rotated roll batch and an A4 sheet. WebKit checked orientation controls, size groups and print media. Physical USB/Bluetooth CD410 output still needs an on-device test.
- Only label printing and calibration functions changed in the application code. Existing invoices, stock records, saved tag designs, schema and V1 price formulas require no conversion or migration.
