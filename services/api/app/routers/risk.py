from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.data.risk import RiskStore
from app.models.schemas import IncidentReport, IncidentResponse
from app.state import get_risk

router = APIRouter(tags=["risk"])


@router.get("/risk/zones")
def risk_zones(
    hour: int = Query(19, ge=0, le=23, description="Hora del día (0-23)"),
    risk: RiskStore = Depends(get_risk),
) -> dict:
    """Zonas de riesgo a una hora dada (OE2): riesgo espacio-temporal por zona."""
    fc = risk.zones_geojson(hour)
    fc["max_risk"] = round(risk.max_risk, 2)
    return fc


@router.post("/incidents/report", response_model=IncidentResponse)
def report_incident(report: IncidentReport) -> IncidentResponse:
    """Reporte ciudadano (cimiento de 'tiempo real') — stub: aún no persiste."""
    return IncidentResponse(
        accepted=False,
        id=None,
        note="Stub: la persistencia de reportes se habilita con la tabla incidents (OE2).",
    )
