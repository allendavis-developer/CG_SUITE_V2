"""Shared view decorators for the pricing app."""

import functools

from django.conf import settings
from rest_framework.response import Response
from rest_framework import status


def require_nospos_sync_secret(view_func):
    """Check X-CG-Nospos-Sync-Secret header on NosPos sync endpoints."""
    @functools.wraps(view_func)
    def wrapper(request, *args, **kwargs):
        secret = getattr(settings, "NOSPOS_CATEGORY_SYNC_SECRET", "") or ""
        if secret:
            if (request.headers.get("X-CG-Nospos-Sync-Secret") or "") != secret:
                return Response({"error": "Unauthorized"}, status=status.HTTP_403_FORBIDDEN)
        elif not settings.DEBUG:
            return Response(
                {"error": "NOSPOS_CATEGORY_SYNC_SECRET must be set when DEBUG is False"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return view_func(request, *args, **kwargs)
    return wrapper
