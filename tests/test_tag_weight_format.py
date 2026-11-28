from types import SimpleNamespace

import pytest

from tag_pdf import _tag_rows, format_tag_weight


@pytest.mark.parametrize(
    ("grams", "expected"),
    [
        (5.1, "5/100"),
        (5.01, "5/010"),
        (5.001, "5/001"),
        (5, "5/000"),
        (0.5, "0/500"),
        (5.1236, "5/124"),
    ],
)
def test_jeweller_weight_notation(grams, expected):
    assert format_tag_weight(grams) == expected


def test_tag_pdf_uses_notation_without_touching_product_weight():
    product = SimpleNamespace(
        name="Ring",
        unit="pcs",
        weight_per_unit=5.1,
        category="",
        item_type="gold",
        unit_price=100,
        barcode="",
        sku="",
    )
    design = SimpleNamespace(
        show_firm=False,
        show_name=False,
        show_category=False,
        show_metal=False,
        show_weight=True,
        show_price=False,
        show_code=False,
        show_sku=False,
        note="",
    )

    assert _tag_rows(design, product, "", lambda value: value) == [("weight", "5/100")]
    assert product.weight_per_unit == 5.1
