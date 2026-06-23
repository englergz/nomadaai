from __future__ import annotations

from fastapi import APIRouter

from app.ml.routing import safe_route
from app.models.schemas import LineStringGeometry, RouteRequest, RouteResponse

router = APIRouter(prefix="/route", tags=["routing"])


@router.post("/safe", response_model=RouteResponse)
def route_safe(req: RouteRequest) -> RouteResponse:
    """Ruta segura (OE3) — stub: devuelve ruta directa hasta integrar OE2."""
    r = safe_route(
        (req.origin[0], req.origin[1]),
        (req.dest[0], req.dest[1]),
        risk_weight=req.risk_weight,
    )
    return RouteResponse(
        geometry=LineStringGeometry(coordinates=r["coordinates"]),
        distance_m=r["distance_m"],
        risk_score=r["risk_score"],
        note=r["note"],
    )
