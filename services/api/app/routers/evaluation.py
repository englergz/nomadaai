"""Evaluación de efectividad del SISTEMA (OE4): protección/alerta y comparación de escenarios.

Lee los resultados precomputados por la línea de modelo (Cowork):
- `eval_alerta_anticipada.csv`: por viaje (id, alerta, riesgo_zona, anticipacion_m/s, ruta_m).
- `sweep_alerta.csv`: barrido de escenarios (hora × umbral × look-ahead).

Complementa la efectividad de PREDICCIÓN (`/trajectories/evaluate`) con la efectividad de la
ALERTA/recomendación: ¿avisa ANTES de entrar a una zona de alto riesgo y con cuánta anticipación?
"""
from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter

from app.core.config import get_settings

router = APIRouter(prefix="/evaluate", tags=["evaluation"])


def _eval_dir() -> Path:
    return get_settings().research_path / "eval"


@lru_cache
def _alerts_summary() -> dict:
    path = _eval_dir() / "eval_alerta_anticipada.csv"
    if not path.exists():
        # fallback dev: Research/analysis_v2
        path = get_settings().research_path / "analysis_v2" / "eval_alerta_anticipada.csv"
    if not path.exists():
        return {"available": False}
    n = 0
    con_alerta = 0
    anticipadas = 0
    antic_m = []
    antic_s = []
    for row in csv.DictReader(open(path, newline="")):
        n += 1
        alerta = int(float(row.get("alerta", 0) or 0))
        am = float(row.get("anticipacion_m", 0) or 0)
        as_ = float(row.get("anticipacion_s", 0) or 0)
        if alerta:
            con_alerta += 1
            if am > 0:
                anticipadas += 1
                antic_m.append(am)
                antic_s.append(as_)
    med = lambda v: round(sorted(v)[len(v) // 2], 1) if v else 0.0
    mean = lambda v: round(sum(v) / len(v), 1) if v else 0.0
    return {
        "available": True,
        "n": n,
        "pct_con_alerta": round(100 * con_alerta / n, 1) if n else 0,
        "pct_anticipadas": round(100 * anticipadas / con_alerta, 1) if con_alerta else 0,
        "anticipacion_media_m": mean(antic_m),
        "anticipacion_media_s": mean(antic_s),
        "anticipacion_mediana_m": med(antic_m),
    }


@lru_cache
def _scenarios() -> list[dict]:
    path = _eval_dir() / "sweep_alerta.csv"
    if not path.exists():
        path = get_settings().research_path / "analysis_v2" / "sweep_alerta.csv"
    if not path.exists():
        return []
    rows = []
    for r in csv.DictReader(open(path, newline="")):
        rows.append({
            "hora": int(float(r["hora"])),
            "umbral": int(float(r["umbral"])),
            "lookahead_m": int(float(r["lookahead_m"])),
            "pct_con_riesgo": float(r["pct_con_riesgo"]),
            "pct_anticipadas": float(r["pct_anticipadas"]),
            "antic_media_m": float(r["antic_media_m"]),
        })
    return rows


@router.get("/alerts")
def alerts() -> dict:
    """Efectividad de la alerta: ¿avisa antes de entrar a la zona de riesgo? (OE4)."""
    return _alerts_summary()


@router.get("/scenarios")
def scenarios() -> dict:
    """Comparación de escenarios (hora × umbral × look-ahead) del motor de alerta."""
    return {"scenarios": _scenarios()}
