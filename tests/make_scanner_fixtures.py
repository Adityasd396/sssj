"""Generate synthetic QR and Code128 tags for the local browser checks."""

from pathlib import Path

import barcode
import qrcode
from barcode.writer import ImageWriter

folder = Path(__file__).resolve().parents[1] / ".cache"
folder.mkdir(exist_ok=True)
qrcode.make("GOLD-01|Classic Ring|2.125|15406.25").save(folder / "scanner-qr.png")
qrcode.make("SUPPLIER-NEW-104").save(folder / "product-existing-qr.png")
barcode.get("code128", "GOLD-01", writer=ImageWriter()).save(
    str(folder / "scanner-barcode"),
    {"module_width": 0.45, "module_height": 18, "quiet_zone": 6, "font_size": 12},
)
