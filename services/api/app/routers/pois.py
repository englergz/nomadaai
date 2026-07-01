"""Puntos de interés (POIs) de OSM para la capa del mapa (OE3).

Sirve el GeoJSON embebido en `artifacts/pois/tumaco_pois.geojson` (policía, salud, educación,
transporte, etc.). Categorías generadoras/atractoras según Brantingham & Brantingham (1995).
"""
from __future__ import annotations

import json
from functools import lru_cache

from fastapi import APIRouter

from app.core.config import get_settings

router = APIRouter(prefix="/pois", tags=["pois"])


@lru_cache
def _load() -> dict:
    p = get_settings().research_path / "pois" / "tumaco_pois.geojson"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {"type": "FeatureCollection", "features": []}


@router.get("")
def pois() -> dict:
    """Lugares de interés (GeoJSON de puntos con `category` y `name`)."""
    return _load()
