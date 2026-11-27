"""Label stock presets and printer-only adjustments. No persisted shop data."""

from math import isfinite

LABEL_PRESETS = {
    "rect-40x25": ("Rectangle · 40 × 25 mm", 40, 25, 0),
    "rect-50x20": ("Rectangle · 50 × 20 mm", 50, 20, 0),
    "rect-50x25": ("Rectangle · 50 × 25 mm", 50, 25, 0),
    "rect-58x40": ("Rectangle · 58 × 40 mm", 58, 40, 0),
    "rect-80x50": ("Rectangle · 80 × 50 mm", 80, 50, 0),
    "tail-44x12": ("Tail · 30 + 14 × 12 mm", 30, 12, 14),
    "tail-56x15": ("Tail · 40 + 16 × 15 mm", 40, 15, 16),
    "tail-70x20": ("Tail · 50 + 20 × 20 mm", 50, 20, 20),
    "rect-1-5x0-5": ("Rectangle · 1.5 × 0.5 in", 38.1, 12.7, 0),
    "rect-2x1": ("Rectangle · 2 × 1 in", 50.8, 25.4, 0),
    "rect-2-5x1-25": ("Rectangle · 2.5 × 1.25 in", 63.5, 31.75, 0),
    "rect-3x2": ("Rectangle · 3 × 2 in", 76.2, 50.8, 0),
}

STOCK_SPACING = {
    "narrow": {
        "font_name": 6,
        "font_detail": 4,
        "pad_mm": 0.45,
        "pad_h_mm": 1,
        "gap_mm": 0.15,
        "bc_h_mm": 1.8,
    },
    "small": {
        "font_name": 7,
        "font_detail": 5,
        "pad_mm": 0.55,
        "pad_h_mm": 1,
        "gap_mm": 0.2,
        "bc_h_mm": 2.3,
    },
}


def preset_spacing(height):
    if height <= 13:
        return STOCK_SPACING["narrow"]
    if height <= 20:
        return STOCK_SPACING["small"]
    return {}


def millimetres(args, name, default, low, high):
    value = args.get(name, type=float)
    if value is None or not isfinite(value):
        return default
    return round(max(low, min(high, value)), 3)


def roll_page(args, width, height):
    """Keep the paper size independent of artwork padding and alignment."""
    rotation = args.get("rotate", 0, type=int)
    if rotation not in (0, 90, 180, 270):
        rotation = 0
    across, feed = (height, width) if rotation in (90, 270) else (width, height)
    across, feed = round(across, 3), round(feed, 3)
    # Reserve at least half the paper for artwork, even with a very small tag.
    insets = {
        side: millimetres(args, side, 0, 0, min(5, axis / 4))
        for side, axis in (("left", across), ("right", across), ("top", feed), ("bottom", feed))
    }
    horizontal = across - insets["left"] - insets["right"]
    vertical = feed - insets["top"] - insets["bottom"]
    x = millimetres(args, "x", 0, -5, 5)
    y = millimetres(args, "y", 0, -5, 5)
    gap = millimetres(args, "gap", None, 0, 20)
    scale = min(1, horizontal / across, vertical / feed)
    centre_x = (insets["left"] - insets["right"]) / 2 + x
    centre_y = (insets["top"] - insets["bottom"]) / 2 + y
    query = {"rotate": rotation, **insets, "x": x, "y": y}
    if gap is not None:
        query["gap"] = gap
    return {
        "across": across,
        "feed": feed,
        "rotation": rotation,
        **insets,
        "x": x,
        "y": y,
        "gap": gap,
        "scale": round(scale, 6),
        "centre_x": round(centre_x, 3),
        "centre_y": round(centre_y, 3),
        "may_clip": abs(centre_x) + across * scale / 2 > across / 2 + 0.001
        or abs(centre_y) + feed * scale / 2 > feed / 2 + 0.001,
        "query": query,
    }
