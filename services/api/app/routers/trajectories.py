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


_eval_cache: dict[int, dict] = {}


@router.get("/evaluate")
def evaluate(
    n: int = Query(160, ge=5, le=2000),
    predictor: DestinationPredictor = Depends(get_predictor),
) -> dict:
    """Efectividad de la predicción de destino sobre el conjunto TEST (no visto).

    Para cada viaje de prueba reproduce la división 75/25, predice excluyendo la propia
    trayectoria (analogía solo con TRAIN) y mide el error final (FDE) contra el recorrido
    real a igual horizonte. Reporta acierto a ≤50 m y ≤100 m, global y por tipo.
    """
    import statistics

    if n in _eval_cache:
        return _eval_cache[n]

    test_ids = sorted(predictor.test_ids)[:n]
    fdes: list[float] = []
    base_fdes: list[float] = []
    by_type: dict[str, list[float]] = {}
    for tid in test_ids:
        d = predictor.get_demo(tid)
        if not d or d.get("fde_m") is None:
            continue
        fde = float(d["fde_m"])
        fdes.append(fde)
        by_type.setdefault(d["type"], []).append(fde)
        if d.get("baseline_fde_m") is not None:
            base_fdes.append(float(d["baseline_fde_m"]))

    def summarize(vals: list[float]) -> dict:
        if not vals:
            return {"n": 0}
        vals_sorted = sorted(vals)
        p90 = vals_sorted[min(len(vals_sorted) - 1, int(0.9 * len(vals_sorted)))]
        return {
            "n": len(vals),
            "fde_median_m": round(statistics.median(vals), 2),
            "fde_mean_m": round(statistics.fmean(vals), 2),
            "fde_p90_m": round(p90, 2),
            "acc_50m_pct": round(100 * sum(v <= 50 for v in vals) / len(vals), 1),
            "acc_100m_pct": round(100 * sum(v <= 100 for v in vals) / len(vals), 1),
        }

    overall = summarize(fdes)
    baseline = summarize(base_fdes)
    mejora = None
    if overall.get("acc_50m_pct") and baseline.get("acc_50m_pct") is not None:
        mejora = round(overall["acc_50m_pct"] - baseline["acc_50m_pct"], 1)
    result = {
        "n_train": predictor.n_train,
        "n_test": predictor.n_test,
        "evaluated": len(fdes),
        "overall": overall,
        "baseline": baseline,            # extrapolación en línea recta (referencia)
        "mejora_vs_baseline_pp": mejora,  # puntos porcentuales de mejora en acierto ≤50 m
        "by_type": {t: summarize(v) for t, v in sorted(by_type.items())},
        "note": "FDE = error final vs recorrido real al horizonte de continuación (no visto). "
                "baseline = extrapolación en línea recta.",
    }
    _eval_cache[n] = result
    return result


@router.get("/{tid}/track")
def track(
    tid: str,
    predictor: DestinationPredictor = Depends(get_predictor),
) -> dict:
    """Recorrido completo (lon/lat) de un viaje real, para reproducir como GPS en vivo."""
    from app.ml.destination import infer_type

    coords = predictor.get_track(tid)
    if coords is None:
        raise HTTPException(status_code=404, detail=f"Viaje '{tid}' no encontrado")
    return {"id": tid, "type": infer_type(tid), "coords": coords, "n": len(coords)}


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
        d["alert"] = state.risk.lookahead_alert(
            d["candidates"][0]["coordinates"], start_seconds=hour * 3600
        )
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
