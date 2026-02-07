from django.contrib import admin
from django.urls import path, re_path

import pricing.views_v2 as v2
urlpatterns = [
    path('', v2.react_app, name='react_app_root'),
    path('admin/', admin.site.urls),

    # new frontend rewrite api calls needed
    path('api/product-categories/', v2.categories_list, name='product-categories'),
    path('api/products/', v2.products_list),  
    path('api/product-variants/', v2.product_variants),  
    path('api/market-stats/', v2.variant_market_stats),
    path('api/variant-prices/', v2.variant_prices),
    path('api/customers/', v2.customers_view),
    path('api/requests/', v2.requests_view, name='requests'),
    path('api/requests/<int:request_id>/items/', v2.add_request_item, name='add_request_item'),
    path('api/requests/<int:request_id>/', v2.request_detail, name='request_detail'),
    path('api/requests/<int:request_id>/finish/', v2.finish_request, name='finish_request'),
    path('api/requests/<int:request_id>/cancel/', v2.cancel_request, name='cancel_request'),
    path('api/requests/<int:request_id>/update-intent/', v2.update_request_intent, name='update_request_intent'),
    path('api/request-items/<int:request_item_id>/update-raw/', v2.update_request_item_raw_data, name='update_request_item_raw_data'),
    re_path(r'^(?:.*)/?$', v2.react_app, name='react_app_catchall'),


]

from django.conf import settings
from django.conf.urls.static import static


if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
