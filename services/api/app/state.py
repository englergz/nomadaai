"""Estado compartido del backend: artefactos cargados una sola vez al iniciar.

Los routers acceden a estos objetos vía dependencias (get_predictor, get_corridors).
Se rellenan en el lifespan de app/main.py.
"""
from __future__ import annotations

from fastapi import HTTPException

from app.data.corridors import CorridorStore
from app.data.risk import RiskStore
from app.ml.destination import DestinationPredictor

predictor: DestinationPredictor | None = None
corridors: CorridorStore | None = None
risk: RiskStore | None = None


def get_predictor() -> DestinationPredictor:
    if predictor is None:
        raise HTTPException(status_code=503, detail="Predictor no disponible")
    return predictor


def get_corridors() -> CorridorStore:
    if corridors is None:
        raise HTTPException(status_code=503, detail="Corredores no disponibles")
    return corridors


def get_risk() -> RiskStore:
    if risk is None:
        raise HTTPException(status_code=503, detail="Capa de riesgo no disponible")
    return risk
