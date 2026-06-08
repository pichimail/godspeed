#!/usr/bin/env python3
"""Refresh the cached OpenRouter free-model catalog."""

from __future__ import annotations

from src.openrouter_free_models import refresh_free_models


def main() -> None:
    payload = refresh_free_models()
    print(f"Refreshed {payload.get('count', 0)} free models")


if __name__ == "__main__":
    main()

