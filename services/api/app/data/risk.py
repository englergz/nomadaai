"""Capa de riesgo espacio-temporal (OE2) y alerta anticipada (OE3).

Consume el artefacto generado por la línea de investigación (Cowork) en
`Research/analysis_v2/tumaco_riesgo_horario.csv`:
  columnas: cell_id, lon, lat, hora, riesgo_dyn

Es autosuficiente (trae el centroide lon/lat de cada zona + el riesgo por hora),
así que no depende de unir polígonos por cell_id (que hoy difiere entre scripts).

Expone:
  - zones_geojson(hour): zonas (puntos centroide) con riesgo a esa hora, para el mapa.
  - risk_at(lon, lat, hour): riesgo en una ubicación (zona más cercana).
  - lookahead_alert(path, hour, ...): primera zona de riesgo alto en la ruta -> alerta.
"""
from __future__ import annotations

import csv
import math
from pathlib import Path


def _haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    R = 6371000.0
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dphi = math.radians(b[1] - a[1])
    dlmb = math.radians(b[0] - a[0])
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


class RiskStore:
    def __init__(self, csv_path: Path) -> None:
        # hour -> list[(cell_id, lon, lat, risk)]
        self._by_hour: dict[int, list[tuple[str, float, float, float]]] = {h: [] for h in range(24)}
        max_risk = 0.0
        with open(csv_path, newline="") as f:
            for row in csv.DictReader(f):
                h = int(float(row["hora"]))
                r = float(row["riesgo_dyn"])
                self._by_hour.setdefault(h, []).append(
                    (row["cell_id"], float(row["lon"]), float(row["lat"]), r)
                )
                max_risk = max(max_risk, r)
        self.max_risk = max_risk or 1.0
        self.n_zones = len({c for rows in self._by_hour.values() for (c, *_3) in rows})

    # --- mapa ---
    def zones_geojson(self, hour: int) -> dict:
        hour = int(hour) % 24
        feats = []
        for (cid, lon, lat, r) in self._by_hour.get(hour, []):
            feats.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "cell_id": cid,
                    "risk": round(r, 2),
                    "risk_norm": round(r / self.max_risk, 4),
                },
            })
        return {"type": "FeatureCollection", "features": feats, "hour": hour}

    # --- consulta puntual (zona más cercana) ---
    def risk_at(self, lon: float, lat: float, hour: int) -> tuple[float, float]:
        """Devuelve (riesgo, riesgo_norm) en la zona más cercana al punto."""
        rows = self._by_hour.get(int(hour) % 24, [])
        best_r, best_d = 0.0, float("inf")
        for (_c, zlon, zlat, r) in rows:
            d = _haversine_m((lon, lat), (zlon, zlat))
            if d < best_d:
                best_d, best_r = d, r
        return best_r, best_r / self.max_risk

    # --- alerta anticipada (look-ahead) ---
    def lookahead_alert(
        self,
        path: list[list[float]],   # [[lon,lat], ...] continuación predicha
        hour: int,
        threshold_norm: float = 0.5,
        speed_mps: float = 8.3,    # ~30 km/h por defecto (configurable)
    ) -> dict | None:
        """Mira la ruta predicha y devuelve la alerta anticipada.

        Si alguna zona supera el umbral, devuelve la PRIMERA (aviso lo más temprano
        posible, `is_high=True`). Si no, devuelve la de mayor riesgo de la ruta como
        información (`is_high=False`). `distance_m`/`eta_s` = anticipación al punto.
        """
        if not path:
            return None
        acc = 0.0
        first_high = None
        peak = None
        for i, pt in enumerate(path):
            if i > 0:
                acc += _haversine_m(path[i - 1], path[i])
            r, rn = self.risk_at(pt[0], pt[1], hour)
            info = {
                "lon": pt[0],
                "lat": pt[1],
                "risk": round(r, 2),
                "risk_norm": round(rn, 4),
                "distance_m": round(acc, 1),
                "eta_s": round(acc / speed_mps, 1) if speed_mps else None,
                "hour": int(hour) % 24,
            }
            if rn >= threshold_norm and first_high is None:
                first_high = {**info, "is_high": True}
            if peak is None or rn > peak["risk_norm"]:
                peak = {**info, "is_high": False}
        return first_high or peak
