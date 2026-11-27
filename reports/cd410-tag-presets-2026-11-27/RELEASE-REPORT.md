# CD410 tag presets and printer alignment

Open **Print tag** to load a rectangular or tail stock preset. Presets apply the actual shape and dimensions. Short presets start with tighter text and barcode spacing. You can change body width and height, full length, tail length, tail height, tail position, hole size, design padding, line spacing, font sizes, QR size and barcode height in the preview. Use **Tag Studio → New design** to save a reusable custom layout through the existing design workflow.

Use **Printer padding, alignment and saved profiles** on single tags, roll batches or test labels. The four padding fields fit the artwork inside the label without changing the paper size. X and Y shift it across the roll and along the feed direction. Labels might clip if the shift is too large. Align one test label before a batch, then scan an actual tag. Save a named profile to reuse rotation, padding, offsets and the driver gap in that browser on that device. Profiles are applied when selected and loaded.

The two paper dimensions in the preview describe the entire label, including the tail. Apply those dimensions in the CD410 label driver, set the gap and run gap calibration for die-cut media. Enter the gap separately from label height. Set the driver to 100% scale with no extra rotation or browser headers/footers. See [official CD410 setup](https://www.shreyanspos.com/pages/driver-for-thermal-label-printer-cd410).

Roll batches offer a separate group for incompatible stock shapes, even when their outer dimensions are equal. A tail-shaped test label marks both body and tail. A4 sheet output keeps the existing ordering and its existing print behavior.

All print changes are confined to tag design/preview and printing. No database migration, pricing change, or data conversion is required. Upload code and assets including the new tag_print_settings.py module, preserve your database and configuration, and reload the app.

Browser tests check presets, saved printer profiles, orientation, batches, A4 and tail-shaped calibration. Chromium-generated pages were measured, and the adjusted 56 × 15 mm tag was reviewed at 203 dpi. Physical CD410 stock, media sensing, and printer-specific rendering still need a one-label check on the device.
