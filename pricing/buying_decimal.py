"""Validate buying GBP amounts against Django DecimalField limits before SQLite persist."""

from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError as DjangoValidationError


def parse_optional_money(model, field_name, raw, instance=None):
    """
    Parse API/raw input into a Decimal that passes the model field's validators
    (max_digits, decimal_places, min value, etc.).

    None, '', or whitespace-only string -> None (clear field).
    Raises DjangoValidationError on bad format or out-of-range values.
    """
    if raw is None:
        return None
    if isinstance(raw, str) and raw.strip() == "":
        return None
    try:
        dec = Decimal(str(raw))
    except InvalidOperation as exc:
        raise DjangoValidationError([f"Invalid format for {field_name}"]) from exc
    field = model._meta.get_field(field_name)
    field.clean(dec, instance)
    return dec
