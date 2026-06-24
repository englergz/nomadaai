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


# --- Predicción online (streaming) + alerta anticipada (OE3) ---
class OnlineRequest(BaseModel):
    points: list[TrajectoryPoint] = Field(..., min_length=2)
    type: Optional[str] = None
    hour: int = Field(default=19, ge=0, le=23)
    # Reloj de la simulación: segundos desde medianoche en la posición ACTUAL.
    # Si se envía, el riesgo se evalúa a la hora de llegada a cada zona.
    t_seconds: Optional[float] = Field(default=None, ge=0, le=86400)
    threshold: float = Field(default=0.7, ge=0.0, le=1.0)
    speed_mps: float = Field(default=8.3, gt=0.0, le=40.0)
    exclude_id: Optional[str] = None
    topk: int = Field(default=1, ge=1, le=5)


class RiskAlert(BaseModel):
    lon: float
    lat: float
    cell_id: str = ""
    risk: float
    risk_norm: float
    distance_m: float
    eta_s: Optional[float] = None
    hour: int
    arrival_min: int = 0
    is_high: bool


class OnlineResponse(BaseModel):
    candidates: list[PredictionCandidate]
    alert: Optional[RiskAlert] = None


# --- Generación de ruta NUEVA (OE3) ---
class BuildRouteRequest(BaseModel):
    origin: Coordinate  # [lon, lat] — dónde estoy
    dest: Coordinate    # [lon, lat] — a dónde voy
    type: Optional[str] = None  # vehículo (opcional, para la animación)


class BuildRouteResponse(BaseModel):
    coords: list[Coordinate]
    distance_m: float
    n: int
    vehicle_restricted: bool = False


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
