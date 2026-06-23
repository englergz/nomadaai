from __future__ import annotations

import csv
from functools import lru_cache

from fastapi import APIRouter, Query

from app.core.config import get_settings

router = APIRouter(prefix="/trajectories", tags=["trajectories"])


@lru_cache
def _load_neighbors() -> dict[str, list[dict]]:
    """Carga vecinos Fréchet precomputados (OE1). Cobertura parcial de ids."""
    s = get_settings()
    path = s.research_path / s.neighbors_csv
    out: dict[str, list[dict]] = {}
    if not path.exists():
        return out
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            q = row.get("query_id")
            if not q:
                continue
            out.setdefault(q, []).append(
                {
                    "neighbor_id": row.get("neighbor_id"),
                    "type": row.get("neighbor_type"),
                    "dfrechet": float(row["dfrechet"]) if row.get("dfrechet") else None,
                }
            )
    return out


@router.get("/similar")
def similar(id: str = Query(..., description="id de la trayectoria consulta")) -> dict:
    """Trayectorias más parecidas (Fréchet) a la consulta (OE1)."""
    neigh = _load_neighbors().get(id, [])
    return {"query_id": id, "neighbors": neigh}
