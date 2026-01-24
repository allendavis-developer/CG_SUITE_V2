from django.http import JsonResponse
from django.utils import timezone

from pricing.models import MarketItem, CompetitorListing, InventoryItem
from .competitor_utils import calculate_competitor_count, get_competitor_data


def parse_price_from_response(price_response):
    """Extract decimal price from AI response"""
    match = re.search(r"(.*)FINAL:\s*£\s*(\d+(?:\.\d+)?)", price_response, re.DOTALL)
    if match:
        price_str = match.group(2)
        return float(price_str)
    # Fallback: try to extract any number if the pattern doesn't match
    match_fallback = re.search(r"£?\s*(\d+(?:\.\d+)?)", price_response)
    if match_fallback:
        return float(match_fallback.group(1))
    return 0.0  # Default fallback


def save_analysis_to_db(item_name, description, reasoning, suggested_price, competitor_data, cost_price=None):
    """Save analysis results to database"""
    # Parse price from AI response
    decimal_price = parse_price_from_response(suggested_price)

    # Get or create inventory item
    inventory_item, _ = InventoryItem.objects.get_or_create(
        title=item_name,
        defaults={"description": description}
    )

    # Calculate competitor count
    competitor_count = calculate_competitor_count(competitor_data)

    # Build defaults dict
    defaults = {
        "reasoning": reasoning,
        "suggested_price": decimal_price,
        "created_at": timezone.now()
    }

    # Include cost_price if provided
    if cost_price is not None:
        defaults["cost_price"] = cost_price


    # Save analysis
    analysis, created = PriceAnalysis.objects.update_or_create(
        item=inventory_item,
        defaults=defaults
    )

    return {
        "competitor_count": competitor_count,
        "analysis_id": analysis.id
    }
