"""Lectura de corredores TRACLUS (OE1).

En esta fase lee directamente el GeoJSON de `Research/` (ya en WGS84) para que la
API sea verificable sin necesidad de levantar PostGIS. El ETL en `db/etl/` espeja
estos mismos datos a Supabase para el despliegue en nube; cuando `DATABASE_URL`
esté configurada se puede cambiar la fuente sin tocar el router.
"""
from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Optional


def _in_bbox(coords: list[list[float]], bbox: tuple[float, float, float, float]) -> bool:
    minx, miny, maxx, maxy = bbox
    return any(minx <= x <= maxx and miny <= y <= maxy for x, y in coords)


class CorridorStore:
    def __init__(self, geojson_path: Path) -> None:
        self.path = geojson_path
        # Soporta .geojson y .geojson.gz (los artefactos embebidos van comprimidos
        # para no superar el límite de 10 MB de Hugging Face).
        opener = gzip.open if str(geojson_path).endswith(".gz") else open
        with opener(geojson_path, "rt") as f:
            self._fc = json.load(f)
        self.n_features = len(self._fc.get("features", []))

    def get(
        self,
        bbox: Optional[tuple[float, float, float, float]] = None,
        limit: Optional[int] = None,
    ) -> dict:
        feats = self._fc.get("features", [])
        if bbox is not None:
            feats = [
                f
                for f in feats
                if f.get("geometry", {}).get("type") == "LineString"
                and _in_bbox(f["geometry"]["coordinates"], bbox)
            ]
        if limit:
            feats = feats[:limit]
        return {"type": "FeatureCollection", "features": feats}
