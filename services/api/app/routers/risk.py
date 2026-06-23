from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query

from app.models.schemas import (
    IncidentReport,
    IncidentResponse,
    RiskZonesResponse,
)

router = APIRouter(tags=["risk"])

_NOTE_OE2 = (
    "Stub OE2: la capa de riesgo aún no tiene datos. Se poblará con incidentes "
    "georreferenciados (datos.gov.co / Policía / DANE) agregados a hexágonos H3."
)


@router.get("/risk/zones", response_model=RiskZonesResponse)
def risk_zones(
    bbox: Optional[str] = Query(None, description="minLon,minLat,maxLon,maxLat"),
) -> RiskZonesResponse:
    """Zonas de riesgo (OE2) — stub: FeatureCollection vacío con nota honesta."""
    return RiskZonesResponse(features=[], note=_NOTE_OE2)


@router.post("/incidents/report", response_model=IncidentResponse)
def report_incident(report: IncidentReport) -> IncidentResponse:
    """Reporte ciudadano (cimiento de 'tiempo real') — stub: aún no persiste."""
    return IncidentResponse(
        accepted=False,
        id=None,
        note="Stub: la persistencia de reportes se habilita con la tabla incidents (OE2).",
    )
