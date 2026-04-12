"""
AI-powered NosPos category suggestion endpoint.

POST /api/ai/suggest-category/

Request body:
    {
        "item": {
            "name": "iPhone 13 Pro 256GB",
            "dbCategory": "Mobile Phone",
            "attributes": { "Storage": "256GB", "Colour": "Space Grey" }
        },
        "levelIndex": 0,
        "availableOptions": ["Coins & Bullion", "Electronics", "Jewellery"],
        "previousPath": []
    }

Response body:
    {
        "suggested": "Electronics",
        "confidence": "high",
        "reasoning": "The item is a smartphone which falls under Electronics."
    }
"""
from __future__ import annotations

import json
import logging

from django.http import JsonResponse
from django.views.decorators.http import require_POST

from pricing.services.ai_category import (
    suggest_category,
    suggest_field_values,
    suggest_marketplace_research_search_term,
)

logger = logging.getLogger(__name__)


@require_POST
def suggest_nospos_category(request):
    """Return an AI-suggested NosPos category for the given item + level."""
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"error": "Invalid JSON body."}, status=400)

    # --- item block ---
    item = body.get("item") or {}
    item_name = str(item.get("name") or "Unknown item").strip() or "Unknown item"
    db_category = item.get("dbCategory") or None
    raw_attrs = item.get("attributes") or {}
    if not isinstance(raw_attrs, dict):
        return JsonResponse({"error": "'item.attributes' must be an object."}, status=400)
    attributes = {str(k): str(v) for k, v in raw_attrs.items() if v is not None}

    # --- levelIndex ---
    level_index = body.get("levelIndex")
    if not isinstance(level_index, int) or level_index < 0:
        return JsonResponse(
            {"error": "'levelIndex' must be a non-negative integer."}, status=400
        )

    # --- availableOptions ---
    available_options = body.get("availableOptions") or []
    if not isinstance(available_options, list) or not available_options:
        return JsonResponse(
            {"error": "'availableOptions' must be a non-empty list."}, status=400
        )
    available_options = [str(o) for o in available_options]

    # --- previousPath ---
    previous_path = body.get("previousPath") or []
    if not isinstance(previous_path, list):
        return JsonResponse({"error": "'previousPath' must be a list."}, status=400)
    previous_path = [str(s) for s in previous_path]

    try:
        suggestion = suggest_category(
            item_name=item_name,
            db_category=db_category,
            attributes=attributes,
            level_index=int(level_index),
            available_options=available_options,
            previous_path=previous_path,
        )
    except ValueError as exc:
        logger.warning("[AI Category] Service error: %s", exc)
        return JsonResponse({"error": str(exc)}, status=500)
    except Exception as exc:  # noqa: BLE001
        logger.exception("[AI Category] Unexpected error")
        return JsonResponse({"error": "An unexpected error occurred."}, status=500)

    return JsonResponse({
        "suggested": suggestion.suggested,
        "confidence": suggestion.confidence,
        "reasoning": suggestion.reasoning,
    })


@require_POST
def suggest_nospos_fields(request):
    """
    Return AI-suggested values for a set of NosPos form fields.

    POST /api/ai/suggest-fields/

    Request body:
        {
            "item": { "name": "...", "dbCategory": "...", "attributes": {} },
            "fields": [
                { "name": "...", "label": "...", "control": "text|select|...",
                  "options": [{ "value": "...", "text": "..." }] }
            ]
        }

    Response body:
        { "fields": { "<fieldName>": "<suggestedValue>", ... } }
    """
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"error": "Invalid JSON body."}, status=400)

    item = body.get("item") or {}
    item_name = str(item.get("name") or "Unknown item").strip() or "Unknown item"
    db_category = item.get("dbCategory") or None
    raw_attrs = item.get("attributes") or {}
    if not isinstance(raw_attrs, dict):
        return JsonResponse({"error": "'item.attributes' must be an object."}, status=400)
    attributes = {str(k): str(v) for k, v in raw_attrs.items() if v is not None}

    fields = body.get("fields") or []
    if not isinstance(fields, list):
        return JsonResponse({"error": "'fields' must be a list."}, status=400)

    # Normalise each field entry
    clean_fields = []
    for f in fields:
        if not isinstance(f, dict):
            continue
        opts = f.get("options") or []
        clean_fields.append({
            "name": str(f.get("name") or ""),
            "label": str(f.get("label") or ""),
            "control": str(f.get("control") or "text"),
            "options": [
                {"value": str(o.get("value", "")), "text": str(o.get("text", ""))}
                for o in opts
                if isinstance(o, dict)
            ],
        })

    try:
        result = suggest_field_values(
            item_name=item_name,
            db_category=db_category,
            attributes=attributes,
            fields=clean_fields,
        )
    except ValueError as exc:
        logger.warning("[AI Fields] Service error: %s", exc)
        return JsonResponse({"error": str(exc)}, status=500)
    except Exception:  # noqa: BLE001
        logger.exception("[AI Fields] Unexpected error")
        return JsonResponse({"error": "An unexpected error occurred."}, status=500)

    return JsonResponse({"fields": result.fields})


@require_POST
def suggest_marketplace_research_search_term_view(request):
    """
    POST /api/ai/suggest-marketplace-search-term/

    Body: { "item": { "name", "dbCategory"?, "attributes": { ... } } }
    Same item shape as suggest-category.

    Response:
        {
          "searchTerm": "...",
          "reasoning": "...",
          "provider": "groq" | "gemini",
          "debug": { "systemPrompt", "userPrompt", "rawModelOutput" }
        }
    """
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"error": "Invalid JSON body."}, status=400)

    item = body.get("item") or {}
    item_name = str(item.get("name") or "Unknown item").strip() or "Unknown item"
    db_category = item.get("dbCategory") or None
    raw_attrs = item.get("attributes") or {}
    if not isinstance(raw_attrs, dict):
        return JsonResponse({"error": "'item.attributes' must be an object."}, status=400)
    attributes = {str(k): str(v) for k, v in raw_attrs.items() if v is not None}

    try:
        result = suggest_marketplace_research_search_term(
            item_name=item_name,
            db_category=db_category,
            attributes=attributes,
        )
    except ValueError as exc:
        logger.warning("[Marketplace search term] Service error: %s", exc)
        return JsonResponse({"error": str(exc)}, status=500)
    except Exception:  # noqa: BLE001
        logger.exception("[Marketplace search term] Unexpected error")
        return JsonResponse({"error": "An unexpected error occurred."}, status=500)

    return JsonResponse(
        {
            "searchTerm": result.search_term,
            "reasoning": result.reasoning,
            "provider": result.provider,
            "debug": {
                "systemPrompt": result.system_prompt,
                "userPrompt": result.user_prompt,
                "rawModelOutput": result.raw_output,
            },
        }
    )
