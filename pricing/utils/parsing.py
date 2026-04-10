"""Shared parsing helpers for the pricing app."""

from decimal import Decimal, InvalidOperation


def parse_decimal(value, field_name=None, default=None):
    """Parse a value to Decimal, returning *default* for None/blank.

    Raises ValueError with a message including *field_name* on bad input.
    """
    if value in (None, ""):
        return default
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError):
        label = field_name or "value"
        raise ValueError(f"Invalid format for {label}")


def coerce_bool(val, default=False):
    if val is None:
        return default
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return bool(val) and val != 0
    s = str(val).strip().lower()
    if s in ("1", "true", "yes", "on"):
        return True
    if s in ("0", "false", "no", "off", ""):
        return False
    return default
