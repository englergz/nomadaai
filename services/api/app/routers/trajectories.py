from __future__ import annotations

import csv
from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException, Query

from app import state
from app.core.config import get_settings
from app.ml.destination import DestinationPredictor
from app.state import get_predictor

router = APIRouter(prefix="/trajectories", tags=["trajectories"])


@router.get("/sample")
def sample(
    n: int = Query(24, ge=1, le=100),
    predictor: DestinationPredictor = Depends(get_predictor),
) -> dict:
    """Lista de viajes reales para elegir en la demostración."""
    return {"trips": predictor.list_ids(n=n)}


@router.get("/{tid}/demo")
def demo(
    tid: str,
    topk: int = Query(3, ge=1, le=10),
    hour: int = Query(19, ge=0, le=23, description="Hora del día para el riesgo"),
    predictor: DestinationPredictor = Depends(get_predictor),
) -> dict:
    """Prefijo observado (75%) + predicción + recorrido real + alerta anticipada de riesgo."""
    d = predictor.get_demo(tid, topk=topk)
    if d is None:
        raise HTTPException(status_code=404, detail=f"Viaje '{tid}' no encontrado")
    # Alerta anticipada (OE3): mira la ruta predicha y avisa de la primera zona
    # de riesgo alto ANTES de alcanzarla, evaluada a la hora indicada.
    d["hour"] = hour
    d["alert"] = None
    if state.risk is not None and d.get("candidates"):
        d["alert"] = state.risk.lookahead_alert(d["candidates"][0]["coordinates"], hour)
    return d


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
