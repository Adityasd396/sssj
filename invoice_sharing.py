"""Read-only, expiring invoice sharing; no additional database tables or fields."""

import re

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer


def whatsapp_number(value):
    digits = re.sub(r"[^0-9]", "", value or "")
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) == 10:
        digits = "91" + digits
    return digits if 8 <= len(digits) <= 15 and not digits.startswith("0") else ""


def invoice_identity(invoice):
    return {
        "id": invoice.id,
        "number": invoice.invoice_number,
        "client": invoice.client_id,
        "created": invoice.date_created.isoformat() if invoice.date_created else None,
    }


def share_token(app, invoice):
    return URLSafeTimedSerializer(app.config["SECRET_KEY"], salt="invoice-pdf-share-v1").dumps(
        invoice_identity(invoice)
    )


def read_share_token(app, token):
    try:
        return URLSafeTimedSerializer(app.config["SECRET_KEY"], salt="invoice-pdf-share-v1").loads(
            token, max_age=48 * 3600
        )
    except (BadSignature, SignatureExpired):
        return None
