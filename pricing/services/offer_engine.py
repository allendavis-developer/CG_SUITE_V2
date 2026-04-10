from decimal import Decimal, ROUND_HALF_UP


def round_price(value):
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


round_offer_price = round_price
round_sale_price = round_price


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
    third_offer_pct=None,
):
    """
    Generate CeX offer tiers.
    - Match CeX (last tier) always equals the raw CeX trade-in reference price.
    - Offer 3 = third_offer_pct% of reference. If not specified, the 3rd tier is omitted.
    - Offer 2 = second_offer_pct% of reference, or midpoint of 1 and 3 (or 1 and Match CeX).
    - Offer 1 = first_offer_pct% of reference, or same absolute margin as CeX.
    """
    match_cex_price = float(cex_reference_buy_price)

    # 3rd offer is only included when explicitly configured in the rule.
    has_third = third_offer_pct is not None
    if has_third:
        rounded_offer_3 = round_offer_price(
            max(cex_reference_buy_price * (third_offer_pct / 100.0), 0)
        )
    else:
        rounded_offer_3 = None

    if first_offer_pct is not None:
        offer_1 = max(cex_reference_buy_price * (first_offer_pct / 100.0), 0)
    else:
        cex_abs_margin = cex_sale_price - cex_reference_buy_price
        offer_1 = max(our_sale_price - cex_abs_margin, 0)
    rounded_offer_1 = round_offer_price(offer_1)

    # Midpoint fallback anchors to 3rd offer when present, else to Match CeX.
    midpoint_anchor = rounded_offer_3 if has_third else match_cex_price
    if second_offer_pct is not None:
        rounded_offer_2 = round_offer_price(
            max(cex_reference_buy_price * (second_offer_pct / 100.0), 0)
        )
        if rounded_offer_2 == rounded_offer_1:
            rounded_offer_2 = round((rounded_offer_1 + midpoint_anchor) / 2)
    else:
        rounded_offer_2 = round((rounded_offer_1 + midpoint_anchor) / 2)

    tiers = [
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
    ]
    if has_third:
        tiers.append({
            "id": f"{prefix}_3",
            "title": "Third Offer",
            "price": rounded_offer_3,
            "margin": calculate_margin_percentage(rounded_offer_3, our_sale_price),
            "isHighlighted": True,
        })
    tiers.append({
        "id": f"{prefix}_4",
        "title": "Match CeX",
        "price": match_cex_price,
        "margin": calculate_margin_percentage(match_cex_price, our_sale_price),
        "isMatchCex": True,
    })
    return tiers

