// Cliente API tipado — consumido por web y (futuro) móvil.
import type {
  HealthResponse,
  PredictRequest,
  PredictResponse,
  FeatureCollection,
  RouteRequest,
  RouteResponse,
  RiskZonesResponse,
  IncidentReport,
  IncidentResponse,
} from "./types";

export class NomadaApi {
  constructor(private baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { "content-type": "application/json" },
      ...init,
    });
    if (!res.ok) {
      throw new Error(`API ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  health() {
    return this.req<HealthResponse>("/health");
  }

  predictDestination(body: PredictRequest) {
    return this.req<PredictResponse>("/predict/destination", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  corridors(bbox?: [number, number, number, number], limit?: number) {
    const q = new URLSearchParams();
    if (bbox) q.set("bbox", bbox.join(","));
    if (limit) q.set("limit", String(limit));
    const qs = q.toString();
    return this.req<FeatureCollection>(`/corridors${qs ? `?${qs}` : ""}`);
  }

  riskZones(bbox?: [number, number, number, number]) {
    const q = bbox ? `?bbox=${bbox.join(",")}` : "";
    return this.req<RiskZonesResponse>(`/risk/zones${q}`);
  }

  safeRoute(body: RouteRequest) {
    return this.req<RouteResponse>("/route/safe", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  reportIncident(body: IncidentReport) {
    return this.req<IncidentResponse>("/incidents/report", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}
