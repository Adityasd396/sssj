"""Render thermal-roll tags as PDF pages at the measured stock size."""

from base64 import b64decode
from io import BytesIO
from pathlib import Path
from threading import Lock

from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas

_render_lock = Lock()


def _font():
    name = "TagManrope"
    if name not in pdfmetrics.getRegisteredFontNames():
        path = Path(__file__).parent / "static" / "fonts" / "manrope-variable.ttf"
        pdfmetrics.registerFont(TTFont(name, str(path)))
    return name


def _image(data):
    return ImageReader(BytesIO(b64decode(data.split(",", 1)[1]))) if data else None


def _tag_rows(design, product, firm, format_price):
    rows = []
    if design.show_firm and firm:
        rows.append(("firm", firm))
    if design.show_name and product.name:
        rows.append(("name", product.name))
    per_gram = product.unit == "g"
    details = [
        product.category if design.show_category else "",
        (product.item_type or "").capitalize() if design.show_metal else "",
    ]
    if any(details):
        rows.append(("detail", " · ".join(filter(None, details))))
    if design.show_weight and not per_gram and product.weight_per_unit:
        rows.append(("weight", f"{product.weight_per_unit:g} g"))
    if design.show_price:
        unit = "/g" if per_gram else ""
        rows.append(("price", f"₹{format_price(product.unit_price)}{unit}"))
    if design.show_code and product.barcode:
        rows.append(("code", product.barcode))
    if design.show_sku and product.sku:
        rows.append(("sku", product.sku))
    if design.note:
        rows.append(("note", design.note))
    return [(kind, " ".join(text.split())) for kind, text in rows if text.strip()]


def _outline(canvas, border, x, y, width, height):
    if border == "none":
        return
    canvas.saveState()
    line = min(0.35 * mm, width / 4, height / 4)
    canvas.setLineWidth(line)
    if border == "dashed":
        canvas.setDash(0.9 * mm, 0.65 * mm)
    canvas.rect(x + line / 2, y + line / 2, width - line, height - line)
    inset = 0.65 * mm
    if border == "double" and min(width, height) > 2 * inset + line:
        canvas.rect(x + inset, y + inset, width - 2 * inset, height - 2 * inset)
    canvas.restoreState()


def _draw_tag(canvas, tag, firm, format_price, font):
    design, geo = tag["tpl"], tag["geo"]
    width, height, tail = geo["body"] * mm, geo["height"] * mm, geo["tail"] * mm
    border = design.border or "solid"
    compact = design.style == "compact"
    _outline(canvas, border, 0, 0, width, height)
    if tail and design.style != "minimal":
        tail_height = min(height, design.tail_h_mm * mm if design.tail_h_mm else height * 0.4)
        tail_y = {"top": height - tail_height, "bottom": 0}.get(
            design.tail_pos, (height - tail_height) / 2
        )
        _outline(canvas, border, width, tail_y, tail, tail_height)
        hole = min((design.tail_hole_mm or 0) * mm, tail_height * 0.8, tail * 0.5)
        if hole > 0:
            canvas.setLineWidth(min(0.3 * mm, hole / 4))
            canvas.circle(
                width + tail - min(2 * mm, tail * 0.2) - hole / 2,
                tail_y + tail_height / 2,
                hole / 2,
            )

    pad_x = (design.pad_h_mm if design.pad_h_mm is not None else 2) * mm
    pad_y = (design.pad_mm if design.pad_mm is not None else 1.4) * mm
    edge = ({"none": 0, "double": 0.85}.get(border, 0.4)) * mm
    pad_x = min(edge + pad_x * (0.7 if compact else 1), width / 3)
    pad_y = min(edge + pad_y * (0.6 if compact else 1), height / 3)
    usable_w, usable_h = width - 2 * pad_x, height - 2 * pad_y
    gap = (design.gap_mm if design.gap_mm is not None else 0.5) * mm
    rows = _tag_rows(design, tag["product"], firm, format_price)
    qr, barcode = _image(tag["qr"]), _image(tag["bc"])
    qr_size = min(
        (design.qr_mm * mm if design.qr_mm else height * 0.55),
        usable_h,
        usable_w * (0.55 if rows or barcode else 1),
    )
    text_w = usable_w - (
        qr_size + min(gap, usable_w * 0.1) if qr and (rows or barcode) else qr_size if qr else 0
    )
    valign = getattr(design, "print_valign", "middle")
    if qr:
        qr_x = width - pad_x - qr_size if rows or barcode else (width - qr_size) / 2
        qr_y = {
            "top": height - pad_y - qr_size,
            "bottom": pad_y,
        }.get(valign, (height - qr_size) / 2)
        canvas.drawImage(qr, qr_x, qr_y, qr_size, qr_size)

    name_size, detail_size = design.font_name or 10, design.font_detail or 8
    sizes = [
        name_size * (0.82 if compact else 1) if kind == "name" else detail_size for kind, _ in rows
    ]
    barcode_w = barcode_h = 0
    if barcode:
        native_w, native_h = barcode.getSize()
        barcode_h = design.bc_h_mm * mm if design.bc_h_mm else height * 0.28
        barcode_h = min(barcode_h * (0.8 if compact else 1), usable_h, text_w * native_h / native_w)
        barcode_w = min(barcode_h * native_w / native_h, text_w * (design.bc_w_pct or 100) / 100)
        barcode_h = barcode_w * native_h / native_w
    intervals = max(0, len(rows) + int(barcode is not None) - 1)
    text_height = sum(sizes) * 1.18
    natural_h = text_height + intervals * gap + barcode_h
    fit = min(1, usable_h / natural_h) if natural_h else 1
    y = {
        "top": height - pad_y,
        "bottom": pad_y + natural_h * fit,
    }.get(valign, (height + natural_h * fit) / 2)
    for index, ((kind, text), size) in enumerate(zip(rows, sizes, strict=True)):
        if design.style == "modern" and kind == "name":
            text = text.upper()
        target = size * fit
        text_width = pdfmetrics.stringWidth(text, font, target)
        canvas.setFont(font, min(target, target * text_w / text_width) if text_width else target)
        # Manrope's embedded default is light. A small stroke keeps text clear
        # on 203 dpi thermal stock without changing its layout or the codes.
        bold = getattr(design, "font_bold", "normal") == "bold"
        weight_bold = getattr(design, "weight_bold", "bold") == "bold"
        should_bold = bold or (kind == "weight" and weight_bold)
        canvas.setLineWidth(
            min(target * (0.055 if should_bold else 0.018), 0.26 if should_bold else 0.08)
        )
        if design.style == "minimal":
            canvas.drawCentredString(pad_x + text_w / 2, y - target, text, mode=2 if should_bold else 0)
        else:
            canvas.drawString(pad_x, y - target, text, mode=2 if should_bold else 0)
        has_next = index < len(rows) - 1 or barcode is not None
        y -= (size * 1.18 + (gap if has_next else 0)) * fit
    if barcode and barcode_w > 0:
        actual_w, actual_h = barcode_w * fit, barcode_h * fit
        canvas.drawImage(barcode, pad_x + (text_w - actual_w) / 2, y - actual_h, actual_w, actual_h)


def thermal_tag_pdf(tags, roll, firm, format_price):
    # Registered TrueType fonts manage document-specific subsets during rendering.
    with _render_lock:
        return _render(tags, roll, firm, format_price)


def _render(tags, roll, firm, format_price):
    output = BytesIO()
    canvas = Canvas(output, pagesize=(roll["across"] * mm, roll["feed"] * mm), pageCompression=1)
    canvas.setTitle("Product tags")
    canvas.setViewerPreference("PrintScaling", "None")
    font = _font()
    for tag in tags:
        geo = tag["geo"]
        canvas.translate(
            (roll["across"] / 2 + roll["centre_x"]) * mm, (roll["feed"] / 2 - roll["centre_y"]) * mm
        )
        canvas.rotate(-roll["rotation"])
        canvas.scale(roll["scale"], roll["scale"])
        canvas.translate(-geo["total"] * mm / 2, -geo["height"] * mm / 2)
        _draw_tag(canvas, tag, firm, format_price, font)
        canvas.showPage()
    canvas.save()
    return output.getvalue()
