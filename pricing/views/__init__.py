"""Re-export all view functions so pricing.views.X works from urls.py."""

from pricing.views.catalogue import (
    categories_list,
    all_categories_flat,
    products_list,
    product_variants,
    variant_market_stats,
)
from pricing.views.customers import customers_view, customer_detail
from pricing.views.market_research import (
    get_ebay_filters,
    get_cashconverters_filters,
    get_cashconverters_results,
)
from pricing.views.integrations import react_app, address_lookup, cash_generator_retail_categories
from pricing.views.nospos import (
    nospos_category_mappings_view,
    nospos_category_mapping_detail,
    nospos_categories_list,
    nospos_categories_sync,
    nospos_fields_list,
    nospos_fields_sync,
    nospos_category_fields_sync,
)

# These large modules remain in views_v2 until fully extracted.
# Import them here so pricing.views.X still resolves for urls.py.
from pricing.views_v2 import (
    requests_view,
    add_request_item,
    request_detail,
    update_park_agreement_state,
    update_request_intent,
    requests_overview_list,
    update_request_item,
    update_request_item_raw_data,
    delete_request_item,
    finish_request,
    cancel_request,
    complete_request_after_testing,
    repricing_sessions_view,
    repricing_session_detail,
    upload_sessions_view,
    upload_session_detail,
    quick_reprice_lookup,
    variant_prices,
    cex_product_prices,
    pricing_rules_view,
    pricing_rule_detail,
    ebay_offer_margins,
    customer_rule_settings_view,
    customer_offer_rules_view,
    customer_offer_rule_detail,
)
