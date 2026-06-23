"""Esquemas Pydantic = contrato de la API.

Estos modelos son el espejo de los tipos TypeScript en
`packages/shared/src/types.ts`. Mantener ambos en sincronía.
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

# --- Geometría ligera (GeoJSON-like) ---
Coordinate = list[float]  # [lon, lat]


class LineStringGeometry(BaseModel):
    type: Literal["LineString"] = "LineString"
    coordinates: list[Coordinate]


# --- Predicción de destino ---
class TrajectoryPoint(BaseModel):
    lon: float
    lat: float
    t: float = 0.0


class PredictRequest(BaseModel):
    points: list[TrajectoryPoint] = Field(..., min_length=3)
    type: Optional[str] = None
    topk: Optional[int] = Field(default=None, ge=1, le=100)


class PredictionCandidate(BaseModel):
    rank: int
    neighbor_id: str
    geometry: LineStringGeometry
    length_m: float
    n_points: int
    confidence: float


class PredictResponse(BaseModel):
    candidates: list[PredictionCandidate]


# --- Ruteo seguro (OE3 - stub tipado) ---
class RouteRequest(BaseModel):
    origin: Coordinate  # [lon, lat]
    dest: Coordinate
    risk_weight: float = Field(default=0.0, ge=0.0, le=1.0)


class RouteResponse(BaseModel):
    geometry: LineStringGeometry
    distance_m: float
    risk_score: float
    note: Optional[str] = None


# --- Riesgo por zonas (OE2 - stub tipado) ---
class RiskZonesResponse(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[dict[str, Any]] = []
    note: Optional[str] = None


# --- Reporte ciudadano de incidente (cimiento "tiempo real") ---
class IncidentReport(BaseModel):
    lon: float
    lat: float
    category: str
    description: Optional[str] = None


class IncidentResponse(BaseModel):
    accepted: bool
    id: Optional[str] = None
    note: Optional[str] = None
