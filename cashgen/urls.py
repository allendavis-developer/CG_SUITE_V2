from django.contrib import admin
from django.urls import path, re_path, include

from pricing.views.integrations import react_app

urlpatterns = [
    path('', react_app, name='react_app_root'),
    path('admin/', admin.site.urls),
    path('api/', include('pricing.urls')),
    re_path(r'^(?:.*)/?$', react_app, name='react_app_catchall'),
]

from django.conf import settings
from django.conf.urls.static import static

if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
