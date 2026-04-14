from django.urls import path

from pricing import views
from pricing import ai_views

urlpatterns = [
    # Catalogue
    path('product-categories/', views.categories_list, name='product-categories'),
    path('all-categories/', views.all_categories_flat, name='all-categories'),
    path('products/', views.products_list),
    path('product-variants/', views.product_variants),
    path('market-stats/', views.variant_market_stats),
    path('variant-prices/', views.variant_prices),
    path('cex-product-prices/', views.cex_product_prices),

    # Market research
    path('ebay/filters/', views.get_ebay_filters, name='api-get-ebay-filters'),
    path('cashconverters/filters/', views.get_cashconverters_filters, name='api-get-cashconverters-filters'),
    path('cashconverters/results/', views.get_cashconverters_results, name='api-get-cashconverters-results'),

    # Customers
    path('customers/', views.customers_view),
    path('customers/<int:customer_id>/', views.customer_detail),

    # Requests
    path('requests/', views.requests_view, name='requests'),
    path('requests/<int:request_id>/items/', views.add_request_item, name='add_request_item'),
    path('requests/<int:request_id>/', views.request_detail, name='request_detail'),
    path('requests/overview/', views.requests_overview_list, name='requests_overview_list'),
    path('requests/<int:request_id>/finish/', views.finish_request, name='finish_request'),
    path('requests/<int:request_id>/complete-testing/', views.complete_request_after_testing, name='complete_request_after_testing'),
    path('requests/<int:request_id>/cancel/', views.cancel_request, name='cancel_request'),
    path('requests/<int:request_id>/update-intent/', views.update_request_intent, name='update_request_intent'),

    path('requests/<int:request_id>/park-state/', views.update_park_agreement_state, name='update_park_agreement_state'),
    path('request-items/<int:request_item_id>/update-raw/', views.update_request_item_raw_data, name='update_request_item_raw_data'),
    path('request-items/<int:request_item_id>/update-offer/', views.update_request_item, name='update_request_item'),
    path('request-items/<int:request_item_id>/', views.delete_request_item, name='delete_request_item'),

    # Repricing
    path('quick-reprice/lookup/', views.quick_reprice_lookup, name='quick_reprice_lookup'),
    path('repricing-sessions/', views.repricing_sessions_view, name='repricing_sessions'),
    path('repricing-sessions/overview/', views.repricing_sessions_view, name='repricing_sessions_overview'),
    path('repricing-sessions/<int:repricing_session_id>/', views.repricing_session_detail, name='repricing_session_detail'),

    path('upload-sessions/', views.upload_sessions_view, name='upload_sessions'),
    path('upload-sessions/overview/', views.upload_sessions_view, name='upload_sessions_overview'),
    path('upload-sessions/<int:upload_session_id>/', views.upload_session_detail, name='upload_session_detail'),

    # Pricing rules
    path('pricing-rules/', views.pricing_rules_view, name='pricing_rules'),
    path('pricing-rules/<int:rule_id>/', views.pricing_rule_detail, name='pricing_rule_detail'),
    path('ebay-offer-margins/', views.ebay_offer_margins, name='ebay_offer_margins'),
    path('customer-rule-settings/', views.customer_rule_settings_view, name='customer_rule_settings'),
    path('customer-offer-rules/', views.customer_offer_rules_view, name='customer_offer_rules'),
    path('customer-offer-rules/<str:customer_type>/', views.customer_offer_rule_detail, name='customer_offer_rule_detail'),

    # NosPos
    path('nospos-category-mappings/', views.nospos_category_mappings_view, name='nospos_category_mappings'),
    path('nospos-category-mappings/<int:mapping_id>/', views.nospos_category_mapping_detail, name='nospos_category_mapping_detail'),
    path('nospos-categories/sync/', views.nospos_categories_sync, name='nospos_categories_sync'),
    path('nospos-categories/', views.nospos_categories_list, name='nospos_categories_list'),
    path('nospos-fields/sync/', views.nospos_fields_sync, name='nospos_fields_sync'),
    path('nospos-fields/', views.nospos_fields_list, name='nospos_fields_list'),
    path('nospos-category-fields/sync/', views.nospos_category_fields_sync, name='nospos_category_fields_sync'),

    # Integrations
    path('address-lookup/<str:postcode>/', views.address_lookup, name='address_lookup'),

    # AI
    path('ai/suggest-category/', ai_views.suggest_nospos_category, name='ai_suggest_nospos_category'),
    path('ai/suggest-fields/', ai_views.suggest_nospos_fields, name='ai_suggest_nospos_fields'),
    path(
        'ai/suggest-marketplace-search-term/',
        ai_views.suggest_marketplace_research_search_term_view,
        name='ai_suggest_marketplace_search_term',
    ),
]
