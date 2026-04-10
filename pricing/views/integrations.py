import logging

import requests as http_requests
from django.shortcuts import render
from django.conf import settings
from urllib.parse import quote
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

logger = logging.getLogger(__name__)


def react_app(request):
    return render(request, "react.html")


@api_view(['GET'])
def address_lookup(request, postcode):
    """Proxy to Ideal Postcodes postcode lookup API."""
    api_key = (getattr(settings, 'IDEAL_POSTCODES_API_KEY', '') or '').strip()
    if not api_key:
        return Response(
            {'error': 'Address lookup not configured. Set IDEAL_POSTCODES_API_KEY in .env.'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE
        )
    postcode_clean = (postcode or '').strip()
    if not postcode_clean or len(postcode_clean.replace(' ', '')) < 4:
        return Response({'addresses': []})
    try:
        url = f"https://api.ideal-postcodes.co.uk/v1/postcodes/{quote(postcode_clean)}?api_key={api_key}"
        resp = http_requests.get(url, timeout=10)
        if resp.status_code == 401:
            logger.warning('Ideal Postcodes 401: invalid API key')
            return Response(
                {'error': 'Invalid Ideal Postcodes API key. Check your key at https://ideal-postcodes.co.uk/'},
                status=status.HTTP_401_UNAUTHORIZED
            )
        if resp.status_code == 402:
            logger.warning('Ideal Postcodes 402: no lookups remaining')
            return Response(
                {'error': 'Address lookup limit reached. Top up at https://ideal-postcodes.co.uk/'},
                status=status.HTTP_402_PAYMENT_REQUIRED
            )
        if resp.status_code == 404:
            return Response({'addresses': []})
        resp.raise_for_status()
        data = resp.json()
        result = data.get('result', [])
        if not isinstance(result, list):
            result = [result] if result else []
        return Response({'addresses': result})
    except http_requests.RequestException as e:
        logger.warning('Ideal Postcodes postcode lookup failed: %s', e)
        return Response(
            {'error': str(e) if hasattr(e, 'message') else 'Address lookup failed'},
            status=status.HTTP_502_BAD_GATEWAY
        )
