"""Re-export all view callables so `pricing.urls` can keep using
``from pricing import views`` + ``views.finish_request`` etc.

After the views_v2 split, every endpoint lives in a domain-specific module:

    - catalogue.py       — product / category / variant read endpoints
    - customers.py       — customer CRUD
    - requests.py        — Request lifecycle + items
    - repricing.py       — RepricingSession + quick-reprice lookup
    - uploads.py         — UploadSession
    - pricing_rules.py   — pricing / customer-rule / ebay-margin endpoints
    - market_stats.py    — variant_prices, cex_product_prices
    - market_research.py — eBay / CashConverters filter + result fetches
    - integrations.py    — React shell, address lookup, CG scraper
    - nospos.py          — NosPos category / field / mapping sync
    - _shared.py         — cross-domain helpers (do not add new logic here)
"""

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
from pricing.views.integrations import (
    react_app,
    address_lookup,
    cash_generator_retail_categories,
    webepos_categories_view,
)
from pricing.views.nospos import (
    nospos_category_mappings_view,
    nospos_category_mapping_detail,
    nospos_categories_list,
    nospos_categories_sync,
    nospos_fields_list,
    nospos_fields_sync,
    nospos_category_fields_sync,
)
from pricing.views.requests import (
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
)
from pricing.views.repricing import (
    repricing_sessions_view,
    repricing_session_detail,
    quick_reprice_lookup,
)
from pricing.views.uploads import (
    upload_sessions_view,
    upload_session_detail,
)
from pricing.views.pricing_rules import (
    pricing_rules_view,
    pricing_rule_detail,
    ebay_offer_margins,
    customer_rule_settings_view,
    customer_offer_rules_view,
    customer_offer_rule_detail,
)
from pricing.views.market_stats import (
    variant_prices,
    cex_product_prices,
)
