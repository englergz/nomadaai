from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.data.corridors import CorridorStore
from app.state import get_corridors

router = APIRouter(prefix="/corridors", tags=["corridors"])


@router.get("")
def get_corridors_geojson(
    bbox: Optional[str] = Query(
        None, description="minLon,minLat,maxLon,maxLat"
    ),
    limit: Optional[int] = Query(None, ge=1, le=50000),
    store: CorridorStore = Depends(get_corridors),
) -> dict:
    """Corredores TRACLUS (OE1) como FeatureCollection GeoJSON."""
    box = None
    if bbox:
        parts = [float(v) for v in bbox.split(",")]
        if len(parts) == 4:
            box = (parts[0], parts[1], parts[2], parts[3])
    return store.get(bbox=box, limit=limit)
