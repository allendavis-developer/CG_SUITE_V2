"""CeX API client for fetching live product data."""

import requests

CEX_BOX_DETAIL_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/118.0.5993.117 Safari/537.36"
    ),
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Referer": "https://www.cex.uk/",
}


def fetch_cex_box_detail(sku):
    """Fetch live box details from CEX API. Returns dict or None on failure."""
    url = f"https://wss2.cex.uk.webuy.io/v3/boxes/{sku}/detail"
    try:
        resp = requests.get(url, headers=CEX_BOX_DETAIL_HEADERS, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        response = data.get("response", {})
        if response.get("ack") != "Success":
            return None
        box_details = response.get("data", {}).get("boxDetails", [])
        if not box_details:
            return None
        return box_details[0]
    except Exception:
        return None
