from decimal import Decimal, ROUND_HALF_UP


def round_offer_price(value):
    """Nearest £5 if above £50, else nearest £2."""
    amount = Decimal(str(value or 0))
    if amount > Decimal("50"):
        return float(
            ((amount / Decimal("5")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            * Decimal("5")
        )
    return float(
        ((amount / Decimal("2")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        * Decimal("2")
    )


def round_sale_price(value):
    """Nearest £5 if above £50, else nearest £2."""
    amount = Decimal(str(value or 0))
    if amount > Decimal("50"):
        return float(
            ((amount / Decimal("5")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            * Decimal("5")
        )
    return float(
        ((amount / Decimal("2")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        * Decimal("2")
    )


def calculate_margin_percentage(offer_price, sale_price):
    if sale_price <= 0:
        return 0
    margin_amount = sale_price - offer_price
    return round((margin_amount / sale_price) * 100, 1)


def generate_offer_set(
    *,
    cex_reference_buy_price,
    prefix,
    cex_sale_price,
    our_sale_price,
    first_offer_pct=None,
    second_offer_pct=None,
):
    offer_3 = cex_reference_buy_price
    if first_offer_pct is not None:
        offer_1 = max(cex_reference_buy_price * (first_offer_pct / 100.0), 0)
    else:
        cex_abs_margin = cex_sale_price - cex_reference_buy_price
        offer_1 = max(our_sale_price - cex_abs_margin, 0)
    rounded_offer_1 = round_offer_price(offer_1)
    rounded_offer_3 = float(offer_3)
    if second_offer_pct is not None:
        rounded_offer_2 = round_offer_price(
            max(cex_reference_buy_price * (second_offer_pct / 100.0), 0)
        )
        if rounded_offer_2 == rounded_offer_1:
            rounded_offer_2 = round((rounded_offer_1 + rounded_offer_3) / 2)
    else:
        rounded_offer_2 = round((rounded_offer_1 + rounded_offer_3) / 2)
    return [
        {
            "id": f"{prefix}_1",
            "title": "First Offer",
            "price": rounded_offer_1,
            "margin": calculate_margin_percentage(rounded_offer_1, our_sale_price),
        },
        {
            "id": f"{prefix}_2",
            "title": "Second Offer",
            "price": rounded_offer_2,
            "margin": calculate_margin_percentage(rounded_offer_2, our_sale_price),
        },
        {
            "id": f"{prefix}_3",
            "title": "Third Offer",
            "price": rounded_offer_3,
            "margin": calculate_margin_percentage(rounded_offer_3, our_sale_price),
            "isHighlighted": True,
        },
    ]

