from __future__ import annotations

from fastapi import APIRouter, Depends

from app import state
from app.ml.destination import DestinationPredictor
from app.models.schemas import (
    LineStringGeometry,
    OnlineRequest,
    OnlineResponse,
    PredictionCandidate,
    PredictRequest,
    PredictResponse,
    RiskAlert,
)
from app.state import get_predictor

router = APIRouter(prefix="/predict", tags=["prediction"])


def _to_candidates(cands) -> list[PredictionCandidate]:
    return [
        PredictionCandidate(
            rank=c.rank,
            neighbor_id=c.neighbor_id,
            geometry=LineStringGeometry(coordinates=c.coordinates),
            length_m=c.length_m,
            n_points=c.n_points,
            confidence=c.confidence,
        )
        for c in cands
    ]


@router.post("/destination", response_model=PredictResponse)
def predict_destination(
    req: PredictRequest,
    predictor: DestinationPredictor = Depends(get_predictor),
) -> PredictResponse:
    """Predice la continuación del recorrido (OE1) por recuperación/analogía."""
    pts = [(p.lon, p.lat, p.t) for p in req.points]
    cands = predictor.predict(pts, veh_type=req.type, topk=req.topk)
    return PredictResponse(candidates=_to_candidates(cands))


@router.post("/online", response_model=OnlineResponse)
def predict_online(
    req: OnlineRequest,
    predictor: DestinationPredictor = Depends(get_predictor),
) -> OnlineResponse:
    """Predicción en streaming (OE1+OE3): a partir de las ubicaciones acumuladas hasta
    'ahora', predice la ruta probable y emite la alerta anticipada de riesgo.

    El modelo NO recibe el destino: solo el prefijo capturado en vivo. `exclude_id`
    evita que una trayectoria reproducida se prediga a sí misma.
    """
    pts = [(p.lon, p.lat, p.t) for p in req.points]
    cands = predictor.predict(
        pts, veh_type=req.type, topk=req.topk, exclude_id=req.exclude_id
    )
    alert = None
    if state.risk is not None and cands:
        a = state.risk.lookahead_alert(cands[0].coordinates, req.hour)
        if a is not None:
            alert = RiskAlert(**a)
    return OnlineResponse(candidates=_to_candidates(cands), alert=alert)
