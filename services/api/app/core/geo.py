"""Conversiones geográficas EPSG:3857 (Web Mercator, metros) <-> EPSG:4326 (lon/lat).

Los datos de `Research/` están en metros (3857), pero la API habla lon/lat (4326)
para encajar con MapLibre/GeoJSON. Espejo de la fórmula usada en
`Research/algos/04_make_trajectories_wgs84_pred.py`.
"""
from __future__ import annotations

import math

R = 6378137.0  # radio de la Tierra (Web Mercator)


def to_wgs84(x: float, y: float) -> tuple[float, float]:
    """(x, y) metros -> (lon, lat) grados."""
    lon = (x / R) * 180.0 / math.pi
    lat = (2 * math.atan(math.exp(y / R)) - math.pi / 2) * 180.0 / math.pi
    return lon, lat


def to_mercator(lon: float, lat: float) -> tuple[float, float]:
    """(lon, lat) grados -> (x, y) metros."""
    x = lon * math.pi / 180.0 * R
    y = R * math.log(math.tan(math.pi / 4 + (lat * math.pi / 180.0) / 2))
    return x, y


def heading(p0: tuple[float, float], p1: tuple[float, float]) -> float:
    return math.atan2(p1[1] - p0[1], p1[0] - p0[0])


def angle_diff(a: float, b: float) -> float:
    d = abs(a - b)
    return d if d <= math.pi else 2 * math.pi - d
