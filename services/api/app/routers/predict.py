from __future__ import annotations

from fastapi import APIRouter, Depends

from app.ml.destination import DestinationPredictor
from app.models.schemas import (
    LineStringGeometry,
    PredictionCandidate,
    PredictRequest,
    PredictResponse,
)
from app.state import get_predictor

router = APIRouter(prefix="/predict", tags=["prediction"])


@router.post("/destination", response_model=PredictResponse)
def predict_destination(
    req: PredictRequest,
    predictor: DestinationPredictor = Depends(get_predictor),
) -> PredictResponse:
    """Predice la continuación del recorrido (OE1) por recuperación/analogía."""
    pts = [(p.lon, p.lat, p.t) for p in req.points]
    cands = predictor.predict(pts, veh_type=req.type, topk=req.topk)
    return PredictResponse(
        candidates=[
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
    )
