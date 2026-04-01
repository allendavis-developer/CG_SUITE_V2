from django.contrib import admin
from django.urls import path, re_path

import pricing.views_v2 as v2
urlpatterns = [
    path('', v2.react_app, name='react_app_root'),
    path('admin/', admin.site.urls),

    # new frontend rewrite api calls needed
    path('api/product-categories/', v2.categories_list, name='product-categories'),
    path('api/all-categories/', v2.all_categories_flat, name='all-categories'),
    path("api/ebay/filters/", v2.get_ebay_filters, name="api-get-ebay-filters"),
    path("api/cashconverters/filters/", v2.get_cashconverters_filters, name="api-get-cashconverters-filters"),
    path("api/cashconverters/results/", v2.get_cashconverters_results, name="api-get-cashconverters-results"),
    path('api/products/', v2.products_list),  
    path('api/product-variants/', v2.product_variants),  
    path('api/market-stats/', v2.variant_market_stats),
    path('api/variant-prices/', v2.variant_prices),
    path('api/cex-product-prices/', v2.cex_product_prices),
    path('api/customers/', v2.customers_view),
    path('api/customers/<int:customer_id>/', v2.customer_detail),
    path('api/requests/', v2.requests_view, name='requests'),
    path('api/requests/<int:request_id>/items/', v2.add_request_item, name='add_request_item'),
    path('api/requests/<int:request_id>/', v2.request_detail, name='request_detail'),
    path('api/requests/overview/', v2.requests_overview_list, name='requests_overview_list'),
    path('api/requests/<int:request_id>/finish/', v2.finish_request, name='finish_request'),
    path(
        'api/requests/<int:request_id>/complete-testing/',
        v2.complete_request_after_testing,
        name='complete_request_after_testing',
    ),
    path('api/requests/<int:request_id>/cancel/', v2.cancel_request, name='cancel_request'),
    path('api/requests/<int:request_id>/update-intent/', v2.update_request_intent, name='update_request_intent'),
    path('api/request-items/<int:request_item_id>/update-raw/', v2.update_request_item_raw_data, name='update_request_item_raw_data'),
    path('api/request-items/<int:request_item_id>/update-offer/', v2.update_request_item, name='update_request_item'),
    path('api/request-items/<int:request_item_id>/', v2.delete_request_item, name='delete_request_item'),
    path('api/quick-reprice/lookup/', v2.quick_reprice_lookup, name='quick_reprice_lookup'),
    path('api/repricing-sessions/', v2.repricing_sessions_view, name='repricing_sessions'),
    path('api/repricing-sessions/overview/', v2.repricing_sessions_view, name='repricing_sessions_overview'),
    path('api/repricing-sessions/<int:repricing_session_id>/', v2.repricing_session_detail, name='repricing_session_detail'),
    path('api/pricing-rules/', v2.pricing_rules_view, name='pricing_rules'),
    path('api/pricing-rules/<int:rule_id>/', v2.pricing_rule_detail, name='pricing_rule_detail'),
    path('api/ebay-offer-margins/', v2.ebay_offer_margins, name='ebay_offer_margins'),
    path('api/customer-rule-settings/', v2.customer_rule_settings_view, name='customer_rule_settings'),
    path('api/customer-offer-rules/', v2.customer_offer_rules_view, name='customer_offer_rules'),
    path('api/customer-offer-rules/<str:customer_type>/', v2.customer_offer_rule_detail, name='customer_offer_rule_detail'),
    path('api/address-lookup/<str:postcode>/', v2.address_lookup, name='address_lookup'),
    re_path(r'^(?:.*)/?$', v2.react_app, name='react_app_catchall'),


]

from django.conf import settings
from django.conf.urls.static import static


if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
