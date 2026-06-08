"""OpenRouter free-model catalog refresh and cache helpers."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

from core.atomic_io import atomic_write_json
from core.constants import DATA_DIR
from src.tls_overrides import llm_verify

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
CACHE_FILE = Path(DATA_DIR) / "openrouter_free_models.json"


def _auth_headers(api_key: Optional[str] = None) -> Dict[str, str]:
    key = (api_key or os.getenv("OPENROUTER_API_KEY") or "").strip()
    headers = {"Accept": "application/json", "User-Agent": "GodspeedAI/1.0"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _as_float(value: Any) -> float:
    try:
        return float(value)
    except Exception:
        return -1.0


def _is_free_priced(model: Dict[str, Any]) -> bool:
    pricing = model.get("pricing") or {}
    return _as_float(pricing.get("prompt")) == 0.0 and _as_float(pricing.get("completion")) == 0.0


def _normalize_modalities(values: Any) -> List[str]:
    if not isinstance(values, list):
        return []
    out: List[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        norm = value.strip().lower()
        if norm and norm not in out:
            out.append(norm)
    return out


def _categorize_model(model: Dict[str, Any]) -> str:
    architecture = model.get("architecture") or {}
    input_modalities = set(_normalize_modalities(architecture.get("input_modalities")))
    output_modalities = set(_normalize_modalities(architecture.get("output_modalities")))

    if "embeddings" in output_modalities:
        return "embeddings"
    if "image" in output_modalities:
        return "image"
    if "audio" in output_modalities and "text" not in output_modalities:
        return "audio"
    if "audio" in input_modalities:
        return "audio"
    if "image" in input_modalities:
        return "vision"
    return "text"


def _compact_model(model: Dict[str, Any]) -> Dict[str, Any]:
    architecture = model.get("architecture") or {}
    pricing = model.get("pricing") or {}
    top_provider = model.get("top_provider") or {}
    category = _categorize_model(model)
    return {
        "id": model.get("id"),
        "name": model.get("name") or model.get("id"),
        "category": category,
        "context_length": model.get("context_length"),
        "pricing": {
            "prompt": pricing.get("prompt"),
            "completion": pricing.get("completion"),
        },
        "top_provider": {
            "context_length": top_provider.get("context_length"),
            "is_moderated": top_provider.get("is_moderated"),
        },
        "architecture": {
            "modality": architecture.get("modality"),
            "input_modalities": _normalize_modalities(architecture.get("input_modalities")),
            "output_modalities": _normalize_modalities(architecture.get("output_modalities")),
        },
        "supported_parameters": model.get("supported_parameters") or [],
        "links": model.get("links") or {},
    }


def _group_models(models: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    groups = {"text": [], "vision": [], "image": [], "audio": [], "embeddings": []}
    for model in models:
        category = model.get("category") or "text"
        if category not in groups:
            category = "text"
        groups[category].append(model["id"])
    return groups


def load_cached_free_models() -> Dict[str, Any]:
    try:
        with CACHE_FILE.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_cached_free_models(payload: Dict[str, Any]) -> Dict[str, Any]:
    atomic_write_json(str(CACHE_FILE), payload, indent=2)
    return payload


def refresh_free_models(api_key: Optional[str] = None, *, output_modalities: str = "all", timeout: float = 30.0) -> Dict[str, Any]:
    """Fetch OpenRouter free models, cache them locally, and return the payload."""
    params = {"output_modalities": output_modalities}
    headers = _auth_headers(api_key)
    try:
        with httpx.Client(timeout=timeout, verify=llm_verify()) as client:
            resp = client.get(OPENROUTER_MODELS_URL, params=params, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        cached = load_cached_free_models()
        if cached:
            cached["stale"] = True
            cached["error"] = str(exc)
            cached["updated_at"] = cached.get("updated_at") or datetime.now(timezone.utc).isoformat()
            return cached
        raise

    models = [m for m in (data.get("data") or []) if isinstance(m, dict) and m.get("id") and _is_free_priced(m)]
    compact = [_compact_model(m) for m in models]
    payload = {
        "source": {
            "url": OPENROUTER_MODELS_URL,
            "output_modalities": output_modalities,
        },
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(compact),
        "groups": _group_models(compact),
        "models": compact,
    }
    save_cached_free_models(payload)
    return payload


def get_free_models(api_key: Optional[str] = None, *, output_modalities: str = "all", timeout: float = 30.0) -> Dict[str, Any]:
    cached = load_cached_free_models()
    if cached.get("models"):
        return cached
    try:
        return refresh_free_models(api_key=api_key, output_modalities=output_modalities, timeout=timeout)
    except Exception:
        return cached or {"count": 0, "groups": {}, "models": []}
