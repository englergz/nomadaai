"""Ruteo seguro (OE3) — stub tipado.

En esta fase devuelve una ruta directa (línea recta) entre origen y destino con
su distancia geodésica, como placeholder con el contrato final ya definido.

El plan para OE3 (documentado en docs/ARCHITECTURE.md): construir un grafo
`networkx` desde `Research/tumaco.osm` / `tumaco.net.xml` (offline, cacheado) y
calcular el camino más corto con peso `length * (1 + lambda * risk(edge))`, donde
`risk` proviene de las zonas de OE2 y `lambda` lo aporta `risk_weight`.
"""
from __future__ import annotations

import math

R = 6371000.0  # radio medio de la Tierra (m), para Haversine


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1 = a
    lon2, lat2 = b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def safe_route(
    origin: tuple[float, float],
    dest: tuple[float, float],
    risk_weight: float = 0.0,
) -> dict:
    """Placeholder: línea recta origen->destino. Estructura lista para networkx."""
    distance = haversine_m(origin, dest)
    return {
        "coordinates": [list(origin), list(dest)],
        "distance_m": round(distance, 2),
        "risk_score": 0.0,
        "note": (
            "Stub OE3: ruta en línea recta. El ruteo seguro real (grafo vial + "
            "peso de riesgo) se habilita al integrar OE2 y networkx."
        ),
    }
