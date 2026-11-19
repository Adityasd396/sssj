"""Signed invoice links without time-based expiry; no database mapping needed."""

import base64
import hashlib
import hmac
import json
import re

from itsdangerous import BadSignature, URLSafeTimedSerializer


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
    """Legacy long PDF tokens remain compatible, including previously issued links."""
    return URLSafeTimedSerializer(app.config["SECRET_KEY"], salt="invoice-pdf-share-v1").dumps(
        invoice_identity(invoice)
    )


def read_share_token(app, token):
    try:
        # No max_age: existing long links also cease to expire automatically.
        return URLSafeTimedSerializer(app.config["SECRET_KEY"], salt="invoice-pdf-share-v1").loads(
            token
        )
    except BadSignature:
        return None


def short_share_token(app, invoice):
    number, encoded = invoice.id, ""
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    while number:
        number, remainder = divmod(number, 36)
        encoded = alphabet[remainder] + encoded
    payload = json.dumps(invoice_identity(invoice), sort_keys=True, separators=(",", ":")).encode()
    digest = hmac.new(
        app.config["SECRET_KEY"].encode(), b"invoice-short-share-v2\0" + payload, hashlib.sha256
    ).digest()[:16]
    signature = base64.urlsafe_b64encode(digest).decode().rstrip("=")
    return encoded + "." + signature


def short_share_id(token):
    if not re.fullmatch(r"[0-9a-z]{1,13}\.[A-Za-z0-9_-]{22}", token):
        return None
    value = int(token.split(".")[0], 36)
    return value if 0 < value <= 9223372036854775807 else None


def valid_short_share(app, invoice, token):
    return hmac.compare_digest(short_share_token(app, invoice), token)
