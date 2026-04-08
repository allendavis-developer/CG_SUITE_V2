"""
NosPos category suggestion + field-fill service.

Primary  : Groq  (meta-llama/llama-4-scout-17b-16e-instruct)
Fallback : Gemini free tier (gemini-2.5-flash)

If the Groq call raises for any reason (rate-limit, API error, network, …),
the request is automatically retried against Gemini and a WARNING is logged.
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass

logger = logging.getLogger(__name__)

GROQ_MODEL   = "meta-llama/llama-4-scout-17b-16e-instruct"
GEMINI_MODEL = "gemini-2.5-flash"

# ---------------------------------------------------------------------------
# Lazy clients
# ---------------------------------------------------------------------------

_groq_client = None
_gemini_model = None


def _get_groq():
    global _groq_client
    if _groq_client is None:
        from groq import Groq  # noqa: PLC0415
        api_key = os.environ.get("GROQ_API_KEY", "")
        if not api_key:
            raise ValueError("GROQ_API_KEY is not set.")
        _groq_client = Groq(api_key=api_key)
    return _groq_client


def _get_gemini():
    global _gemini_model
    if _gemini_model is None:
        from google import genai  # noqa: PLC0415
        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            raise ValueError("GEMINI_API_KEY is not set.")
        _gemini_model = genai.Client(api_key=api_key)
    return _gemini_model


# ---------------------------------------------------------------------------
# Output schema
# ---------------------------------------------------------------------------

@dataclass
class CategorySuggestion:
    suggested: str
    confidence: str   # "high" | "medium" | "low"
    reasoning: str


@dataclass
class FieldSuggestions:
    fields: dict  # { fieldName: suggestedValue }


# ---------------------------------------------------------------------------
# Shared prompt builders
# ---------------------------------------------------------------------------

_CATEGORY_SYSTEM = """\
You are a specialist assistant at a second-hand goods buying counter (CG Suite).
Your role is to select the single most appropriate NosPos product category for a
traded-in item at the current category hierarchy level.

You MUST respond with valid JSON only — no markdown fences, no preamble, no trailing text.
The JSON must conform exactly to this schema:
{
  "suggested": "<copied verbatim from AVAILABLE OPTIONS>",
  "confidence": "<high|medium|low>",
  "reasoning": "<one concise sentence explaining the match>"
}

Rules:
- "suggested" MUST be one of the exact strings listed under AVAILABLE OPTIONS.
- If no option is a perfect match, pick the closest one and set confidence to "low".
- Never output anything outside the JSON object.
"""

_FIELDS_SYSTEM = """\
You are an assistant at a second-hand goods buying counter (CG Suite).
Given details about a traded-in item, fill in as many NosPos agreement form
fields as you can determine with confidence.

Strict rules:
- Respond with valid JSON only — no markdown, no preamble.
- The JSON object must have a single key "fields" whose value is an object
  mapping fieldName → suggestedValue.
- CRITICAL: Each key in "fields" MUST be the exact "name" string shown for that
  field in FIELDS TO FILL. Names may look like DraftAgreementItem[123][grade] or
  synthetic ids such as cg_nf_45678 — copy the name= value verbatim. Do not use
  only the human label as the JSON key (labels are still used to match if you slip).
- For SELECT fields, "suggestedValue" MUST be one of the exact strings
  listed in that field's options array (copy it verbatim).
- For TEXT/NUMBER fields, provide the most accurate value you can derive
  from the item details. Do NOT guess.
- Omit any field you are not confident about — it is safer to leave it blank
  than to guess wrong.
- Mobile / phone NETWORK or CARRIER-LOCK fields (any field whose label or
  purpose is network lock, locked to network, SIM lock, etc.): do NOT choose
  "unlocked", "open", "SIM free", "SIM-free", or similar positive-unlock
  options unless the item name or attributes EXPLICITLY say the device is
  unlocked, SIM-free, or not carrier-locked. Never treat "unlocked" as a
  default or best guess when status is unknown — omit the field instead.
- NEVER fill: description, serial number, IMEI, barcode, EAN, location,
  address, postcode, notes, comments, condition notes, rate, or any field
  that requires physical inspection or store-specific knowledge.

Schema:
{ "fields": { "<fieldName>": "<value>", ... } }
"""


def _build_category_user_msg(
    item_name: str,
    db_category: str | None,
    attributes: dict[str, str],
    level_index: int,
    available_options: list[str],
    previous_path: list[str],
) -> str:
    attr_block = (
        "\n".join(f"    - {k}: {v}" for k, v in attributes.items()) if attributes else "    (none)"
    )
    path_block = (
        "\n".join(f"    Level {i + 1}: {seg}" for i, seg in enumerate(previous_path))
        if previous_path
        else "    (this is the top-level selection — no prior selections)"
    )
    options_block = "\n".join(f"    - {o}" for o in available_options)
    return (
        f"ITEM DETAILS\n"
        f"  Name        : {item_name}\n"
        f"  DB Category : {db_category or '(unknown)'}\n"
        f"  Attributes  :\n{attr_block}\n\n"
        f"PREVIOUSLY SELECTED PATH\n{path_block}\n\n"
        f"TASK\n"
        f"  Select the most appropriate NosPos category at hierarchy level {level_index + 1}"
        f"{' (top-level)' if level_index == 0 else ''}.\n\n"
        f"AVAILABLE OPTIONS\n{options_block}"
    )


def _build_fields_user_msg(
    item_name: str,
    db_category: str | None,
    attributes: dict[str, str],
    fields: list[dict],
) -> str:
    attr_block = (
        "\n".join(f"    - {k}: {v}" for k, v in attributes.items()) if attributes else "    (none)"
    )
    field_lines = []
    for f in fields:
        opts = f.get("options") or []
        if opts:
            opts_str = ", ".join(
                f'"{o["text"]}" (value={o["value"]!r})' for o in opts[:40]
            )
            field_lines.append(
                f'  - name={f["name"]!r}  label={f.get("label", "")!r}  type=SELECT\n'
                f'    options: [{opts_str}]'
            )
        else:
            field_lines.append(
                f'  - name={f["name"]!r}  label={f.get("label", "")!r}'
                f'  type={f.get("control", "text").upper()}'
            )
    return (
        f"ITEM\n"
        f"  Name        : {item_name}\n"
        f"  DB Category : {db_category or '(unknown)'}\n"
        f"  Attributes  :\n{attr_block}\n\n"
        f"FIELDS TO FILL\n"
        + "\n".join(field_lines)
        + "\n\nUse each field's name=... value EXACTLY as the JSON key in your "
        "response \"fields\" object."
    )


def _last_bracket_key(form_name: str) -> str:
    m = re.search(r"\[([^\]]+)\]\s*$", (form_name or "").strip())
    return m.group(1) if m else ""


def _label_slug(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (label or "").lower())


def _normalize_field_response_keys(
    raw_fields: dict,
    fields: list[dict],
) -> dict[str, str]:
    """
    Models often return keys like 'grade' or 'Grade' instead of the full form
    name DraftAgreementItem[id][grade]. Map those back to canonical names.
    """
    if not raw_fields or not fields:
        return {}

    name_set = {str(f.get("name") or "") for f in fields if f.get("name")}
    alias_to_name: dict[str, str] = {}

    for f in fields:
        fn = str(f.get("name") or "").strip()
        if not fn:
            continue
        alias_to_name[fn.lower()] = fn
        lab = str(f.get("label") or "").strip()
        if lab:
            alias_to_name[lab.lower()] = fn
            slug = _label_slug(lab)
            if slug:
                alias_to_name[slug] = fn
        tail = _last_bracket_key(fn)
        if tail:
            alias_to_name[tail.lower()] = fn

    out: dict[str, str] = {}
    for k, v in raw_fields.items():
        if v is None:
            continue
        val = str(v).strip()
        if not val:
            continue
        ks = str(k).strip()
        if ks in name_set:
            out[ks] = val
            continue
        kl = ks.lower()
        canon = alias_to_name.get(kl)
        if not canon:
            canon = alias_to_name.get(_label_slug(ks))
        if canon:
            out[canon] = val
        else:
            logger.warning(
                "[AI Fields] Unmapped model key %r (value=%r); known names=%s",
                ks,
                val,
                list(name_set),
            )
    return out


# ---------------------------------------------------------------------------
# Low-level provider calls (each returns raw JSON string)
# ---------------------------------------------------------------------------

def _groq_call(system: str, user: str, max_tokens: int) -> str:
    client = _get_groq()
    completion = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.1,
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
    )
    return completion.choices[0].message.content.strip()


def _gemini_call(system: str, user: str) -> str:
    from google.genai import types  # noqa: PLC0415
    client = _get_gemini()
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=f"{system}\n\n{user}",
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.1,
        ),
    )
    return response.text.strip()


def _call_with_fallback(system: str, user: str, max_tokens: int, label: str) -> str:
    """Try Groq; on any failure fall back to Gemini."""
    try:
        raw = _groq_call(system, user, max_tokens)
        logger.debug("[%s] Groq responded OK", label)
        return raw
    except Exception as groq_exc:
        logger.warning(
            "[%s] Groq failed (%s: %s) — falling back to Gemini",
            label,
            type(groq_exc).__name__,
            groq_exc,
        )

    try:
        raw = _gemini_call(system, user)
        logger.debug("[%s] Gemini fallback responded OK", label)
        return raw
    except Exception as gemini_exc:
        raise RuntimeError(
            f"Both Groq and Gemini failed. "
            f"Groq: {groq_exc}. Gemini: {gemini_exc}."
        ) from gemini_exc


def _parse_json(raw: str, label: str) -> dict:
    # Strip accidental markdown fences (Gemini sometimes adds them)
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"[{label}] Model returned non-JSON: {raw!r}") from exc


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def suggest_category(
    item_name: str,
    db_category: str | None,
    attributes: dict[str, str],
    level_index: int,
    available_options: list[str],
    previous_path: list[str],
) -> CategorySuggestion:
    """
    Suggest the best NosPos category option at the given hierarchy level.
    Tries Groq first, falls back to Gemini on any failure.
    """
    user_msg = _build_category_user_msg(
        item_name, db_category, attributes, level_index, available_options, previous_path
    )
    label = f"AI Category L{level_index + 1}"

    logger.debug("[%s] Prompt:\n%s\n%s\n%s", label, "=" * 60, user_msg, "=" * 60)

    raw = _call_with_fallback(_CATEGORY_SYSTEM, user_msg, max_tokens=256, label=label)
    data = _parse_json(raw, label)

    suggested  = str(data.get("suggested", "")).strip()
    confidence = str(data.get("confidence", "low")).strip().lower()
    reasoning  = str(data.get("reasoning", "")).strip()
    if confidence not in ("high", "medium", "low"):
        confidence = "low"

    result = CategorySuggestion(suggested=suggested, confidence=confidence, reasoning=reasoning)
    logger.info(
        "[%s] → suggested=%r  confidence=%s  | %s",
        label, result.suggested, result.confidence, result.reasoning,
    )
    return result


def suggest_field_values(
    item_name: str,
    db_category: str | None,
    attributes: dict[str, str],
    fields: list[dict],
) -> FieldSuggestions:
    """
    Suggest values for a set of NosPos form fields.
    Tries Groq first, falls back to Gemini on any failure.
    """
    if not fields:
        return FieldSuggestions(fields={})

    user_msg = _build_fields_user_msg(item_name, db_category, attributes, fields)
    label = "AI Fields"

    logger.debug("[%s] Prompt:\n%s\n%s\n%s", label, "=" * 60, user_msg, "=" * 60)

    raw = _call_with_fallback(_FIELDS_SYSTEM, user_msg, max_tokens=512, label=label)
    data = _parse_json(raw, label)

    raw_fields = data.get("fields") or {}
    if not isinstance(raw_fields, dict):
        raw_fields = {}
    result_fields = _normalize_field_response_keys(raw_fields, fields)

    logger.info("[%s] Filled %d field(s): %s", label, len(result_fields), list(result_fields.keys()))
    return FieldSuggestions(fields=result_fields)
