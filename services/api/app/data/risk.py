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


def _min_step(vals: list[float]) -> float:
    """Mínima separación positiva entre valores ordenados (paso de la malla)."""
    step = None
    for i in range(1, len(vals)):
        d = vals[i] - vals[i - 1]
        if d > 1e-9 and (step is None or d < step):
            step = d
    return step or 0.002  # ~200 m de respaldo


def _level(risk_norm: float) -> str:
    if risk_norm >= 0.7:
        return "alto"
    if risk_norm >= 0.4:
        return "medio"
    return "bajo"


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

        # Metadatos por zona (población DANE real, actividad) para enriquecer el popup.
        self._meta: dict[str, dict] = {}
        meta_path = csv_path.parent / "tumaco_zonas_riesgo_v2.csv"
        if meta_path.exists():
            with open(meta_path, newline="") as f:
                for row in csv.DictReader(f):
                    self._meta[row["cell_id"]] = {
                        "poblacion": int(float(row.get("poblacion_dane", 0) or 0)),
                        "actividad": int(float(row.get("n_points", 0) or 0)),
                    }

        # Tamaño de celda de la malla (para dibujar zonas discretas como polígonos):
        # mínima separación positiva entre centroides en lon y lat.
        sample = self._by_hour.get(0) or next(iter(self._by_hour.values()), [])
        lons = sorted({round(lon, 6) for (_c, lon, _la, _r) in sample})
        lats = sorted({round(lat, 6) for (_c, _lo, lat, _r) in sample})
        self.dlon = _min_step(lons)
        self.dlat = _min_step(lats)

    # --- mapa: zonas discretas (polígonos cuadrados) con riesgo por hora ---
    def zones_geojson(self, hour: int) -> dict:
        hour = int(hour) % 24
        hx, hy = self.dlon / 2, self.dlat / 2
        feats = []
        for (cid, lon, lat, r) in self._by_hour.get(hour, []):
            rn = r / self.max_risk
            feats.append({
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [lon - hx, lat - hy], [lon + hx, lat - hy],
                        [lon + hx, lat + hy], [lon - hx, lat + hy],
                        [lon - hx, lat - hy],
                    ]],
                },
                "properties": {
                    "cell_id": cid,
                    "lon": lon,
                    "lat": lat,
                    "risk": round(r, 2),
                    "risk_norm": round(rn, 4),
                    "level": _level(rn),
                    "poblacion": self._meta.get(cid, {}).get("poblacion"),
                    "actividad": self._meta.get(cid, {}).get("actividad"),
                },
            })
        return {"type": "FeatureCollection", "features": feats, "hour": hour}

    # --- consulta puntual (zona más cercana) ---
    def risk_at(self, lon: float, lat: float, hour: int) -> tuple[float, float, str]:
        """Devuelve (riesgo, riesgo_norm, cell_id) en la zona más cercana al punto."""
        rows = self._by_hour.get(int(hour) % 24, [])
        best_r, best_d, best_c = 0.0, float("inf"), ""
        for (c, zlon, zlat, r) in rows:
            d = _haversine_m((lon, lat), (zlon, zlat))
            if d < best_d:
                best_d, best_r, best_c = d, r, c
        return best_r, best_r / self.max_risk, best_c

    # --- alerta anticipada (look-ahead) ---
    def lookahead_alert(
        self,
        path: list[list[float]],   # [[lon,lat], ...] continuación predicha
        start_seconds: float,      # segundos desde medianoche en la posición actual
        threshold_norm: float = 0.7,
        speed_mps: float = 8.3,    # ~30 km/h por defecto (configurable)
    ) -> dict | None:
        """Alerta anticipada con reloj corriendo: el riesgo de cada zona se evalúa a la
        HORA ESTIMADA DE LLEGADA (no a una hora fija). Devuelve la primera zona que supere
        el umbral (aviso lo más temprano posible); si ninguna, la de mayor riesgo (info).
        """
        if not path:
            return None
        acc = 0.0
        first_high = None
        peak = None
        for i, pt in enumerate(path):
            if i > 0:
                acc += _haversine_m(path[i - 1], path[i])
            eta_s = acc / speed_mps if speed_mps else 0.0
            arrival_s = start_seconds + eta_s
            arrival_hour = int(arrival_s // 3600) % 24
            r, rn, cid = self.risk_at(pt[0], pt[1], arrival_hour)
            info = {
                "lon": pt[0],
                "lat": pt[1],
                "cell_id": cid,
                "risk": round(r, 2),
                "risk_norm": round(rn, 4),
                "distance_m": round(acc, 1),
                "eta_s": round(eta_s, 1),
                "hour": arrival_hour,
                "arrival_min": int((arrival_s % 3600) // 60),
            }
            if rn >= threshold_norm and first_high is None:
                first_high = {**info, "is_high": True}
            if peak is None or rn > peak["risk_norm"]:
                peak = {**info, "is_high": False}
        return first_high or peak
