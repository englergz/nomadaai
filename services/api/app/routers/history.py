"""Histórico de efectividad (persistido en Postgres/Supabase).

Un registro por viaje simulado con dos comparaciones: predicción (modelo vs línea recta) y
protección (ruta segura vs directa). Degrada con elegancia si no hay base de datos configurada.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.data import history

router = APIRouter(prefix="/history", tags=["history"])


class TripRecord(BaseModel):
    mode: Optional[str] = None
    vehicle: Optional[str] = None
    hour: Optional[int] = None
    n_pred: int = 0
    model_err_sum: float = 0.0
    base_err_sum: float = 0.0
    model_hit50: int = 0
    base_hit50: int = 0
    exposure_reduction_pct: Optional[float] = None
    safe_exposure: Optional[float] = None
    direct_exposure: Optional[float] = None
    safe_dist_m: Optional[float] = None
    direct_dist_m: Optional[float] = None
    city: str = "tumaco"


@router.post("/trip")
def log_trip(rec: TripRecord) -> dict:
    try:
        return history.log_trip(rec.model_dump())
    except Exception as e:  # noqa: BLE001 — nunca romper la simulación por la DB
        return {"ok": False, "error": str(e)}


@router.get("/summary")
def get_summary(city: str = "tumaco") -> dict:
    try:
        return history.summary(city)
    except Exception as e:  # noqa: BLE001
        return {"available": False, "error": str(e)}


@router.delete("")
def reset(city: str = "tumaco") -> dict:
    try:
        return history.reset(city)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}
