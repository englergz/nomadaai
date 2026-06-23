// Contrato de la API NómadaAI — espejo de services/api/app/models/schemas.py
// Mantener ambos en sincronía.

export type Coordinate = [number, number]; // [lon, lat]

export interface LineStringGeometry {
  type: "LineString";
  coordinates: Coordinate[];
}

// --- Predicción de destino (OE1) ---
export interface TrajectoryPoint {
  lon: number;
  lat: number;
  t?: number;
}

export interface PredictRequest {
  points: TrajectoryPoint[];
  type?: string;
  topk?: number;
}

export interface PredictionCandidate {
  rank: number;
  neighbor_id: string;
  geometry: LineStringGeometry;
  length_m: number;
  n_points: number;
  confidence: number;
}

export interface PredictResponse {
  candidates: PredictionCandidate[];
}

// --- Demostración con viajes reales (división 75/25) ---
export interface TripSummary {
  id: string;
  type: string;
  n_points: number;
  start: Coordinate;
}

export interface TripsResponse {
  trips: TripSummary[];
}

export interface DemoResponse {
  id: string;
  type: string;
  prefix: Coordinate[];
  truth: Coordinate[];
  candidates: {
    rank: number;
    neighbor_id: string;
    coordinates: Coordinate[];
    length_m: number;
    confidence: number;
  }[];
  fde_m: number | null;
  horizon_m: number | null;
}

// --- Corredores TRACLUS (OE1) ---
export interface FeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
  note?: string;
}

export interface GeoJSONFeature {
  type: "Feature";
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
}

// --- Ruteo seguro (OE3) ---
export interface RouteRequest {
  origin: Coordinate;
  dest: Coordinate;
  risk_weight?: number;
}

export interface RouteResponse {
  geometry: LineStringGeometry;
  distance_m: number;
  risk_score: number;
  note?: string;
}

// --- Riesgo (OE2) ---
export type RiskZonesResponse = FeatureCollection;

// --- Incidentes ---
export interface IncidentReport {
  lon: number;
  lat: number;
  category: string;
  description?: string;
}

export interface IncidentResponse {
  accepted: boolean;
  id?: string;
  note?: string;
}

// --- Health ---
export interface HealthResponse {
  status: string;
  environment: string;
  predictor_ready: boolean;
  n_trajectories: number;
  n_train?: number;
  n_test?: number;
  n_segments: number;
  corridors_ready: boolean;
  n_corridors: number;
}
