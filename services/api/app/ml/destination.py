"""Predicción de destino por recuperación/analogía (OE1).

Puerto de la lógica de `Research/scripts/traj_nn.py` a una clase de servicio:
- Se construye UNA vez al iniciar el backend (KDTree sobre los puntos de inicio
  de cada segmento de las trayectorias verdad, en EPSG:3857).
- En cada consulta recibe un prefijo (lon/lat/t), toma el último punto y el rumbo,
  busca trayectorias conocidas que pasan por la misma zona en el mismo rumbo, y
  propone su continuación como predicción (top-k candidatos).

Mantiene los mismos hiperparámetros que el script original para reproducibilidad.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.neighbors import KDTree

from app.core.geo import angle_diff, heading, to_mercator, to_wgs84

# Hiperparámetros (espejo de traj_nn.py)
K_NEIGH_MAX = 5000
# (radio_m, peso_angulo, restringe_por_tipo)
R_TIERS = [(25.0, 1.5, True), (60.0, 1.0, True), (120.0, 0.0, False)]


def infer_type(tid: str) -> str:
    s = (tid or "").lower()
    m = re.match(r"^([a-z]+)", s)
    if not m:
        return "vehicle"
    pref = m.group(1)
    norm = {
        "moto": "mot", "mot": "mot", "bus": "bus", "car": "car", "auto": "car",
        "taxi": "taxi", "truck": "truck", "tru": "truck", "camion": "truck",
        "van": "van", "suv": "suv", "pickup": "pickup", "veh": "veh",
        "bike": "bike", "bici": "bike",
    }
    return norm.get(pref, pref)


def _haversine_m(a: list[float], b: list[float]) -> float:
    R = 6371000.0
    lon1, lat1 = a
    lon2, lat2 = b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def _point_at_distance(coords: list[list[float]], dist_m: float) -> list[float] | None:
    """Punto a `dist_m` metros recorridos a lo largo de una polilínea lon/lat."""
    if not coords:
        return None
    if dist_m <= 0:
        return coords[0]
    acc = 0.0
    for i in range(1, len(coords)):
        step = _haversine_m(coords[i - 1], coords[i])
        if acc + step >= dist_m:
            return coords[i]
        acc += step
    return coords[-1]


@dataclass
class Candidate:
    rank: int
    neighbor_id: str
    coordinates: list[list[float]]  # [[lon, lat], ...] (la continuación predicha)
    length_m: float
    n_points: int
    confidence: float  # 1 - score normalizado (mayor = mejor)


class DestinationPredictor:
    """Carga las trayectorias verdad y predice la continuación de un prefijo."""

    def __init__(
        self,
        parquet_path: Path,
        max_trajectories: int = 0,
        default_topk: int = 5,
        max_meters: float = 200.0,
        frac_miss: float = 0.25,
    ) -> None:
        self.default_topk = default_topk
        self.max_meters = max_meters
        self.frac_miss = frac_miss
        self._load(parquet_path, max_trajectories)

    def _load(self, parquet_path: Path, max_trajectories: int) -> None:
        df = pd.read_parquet(parquet_path)  # id, x, y, t (metros)
        if max_trajectories and max_trajectories > 0:
            keep = df["id"].drop_duplicates().head(max_trajectories)
            df = df[df["id"].isin(keep)]

        # true_dict: id -> [(x, y, t), ...] ordenado por t
        self.true_dict: dict[str, list[tuple[float, float, float]]] = {}
        for tid, g in df.sort_values("t").groupby("id"):
            self.true_dict[tid] = list(
                zip(g.x.to_numpy(), g.y.to_numpy(), g.t.to_numpy())
            )

        # KDTree sobre el punto de inicio de cada segmento
        rows: list[tuple[float, float, str, int, str]] = []
        for tid, pts in self.true_dict.items():
            typ = infer_type(tid)
            for j in range(len(pts) - 1):
                x, y, _ = pts[j]
                rows.append((x, y, tid, j, typ))

        self._A = np.array([[r[0], r[1]] for r in rows], dtype=float)
        self._meta = [(r[2], r[3], r[4]) for r in rows]  # (id, idx, type)
        self._tree = KDTree(self._A) if len(rows) else None
        self.n_trajectories = len(self.true_dict)
        self.n_segments = len(rows)

    # --- API pública ---
    def predict(
        self,
        points_lonlat: list[tuple[float, float, float]],  # (lon, lat, t)
        veh_type: str | None = None,
        topk: int | None = None,
        exclude_id: str | None = None,
        n_pred: int | None = None,
    ) -> list[Candidate]:
        if self._tree is None:
            return []
        topk = topk or self.default_topk
        # Convertir prefijo a metros (3857)
        prefix = [(*to_mercator(lon, lat), t) for (lon, lat, t) in points_lonlat]
        L = len(prefix)
        if L < 3:
            return []

        want_type = (veh_type or infer_type("vehicle")).lower()
        if n_pred is None:
            n_pred = max(1, int(round(L * self.frac_miss / (1 - self.frac_miss))))

        found: list[tuple[str, int, list, float, float]] = []
        for (radius, w_ang, restrict) in R_TIERS:
            if len(found) >= topk:
                break
            found += self._collect(
                prefix, want_type, radius, w_ang, restrict, n_pred,
                topk - len(found), exclude_id,
            )

        candidates: list[Candidate] = []
        for rank, (cid, _j, tail, length_m, score) in enumerate(found, start=1):
            coords: list[list[float]] = []
            for (x, y, _t) in tail:
                lon, lat = to_wgs84(x, y)
                coords.append([float(lon), float(lat)])
            candidates.append(
                Candidate(
                    rank=rank,
                    neighbor_id=cid,
                    coordinates=coords,
                    length_m=round(float(length_m), 3),
                    n_points=len(tail),
                    confidence=round(max(0.0, 1.0 - float(score)), 4),
                )
            )
        return candidates

    # --- demostración con viajes reales (división 75/25) ---
    def list_ids(self, n: int = 24, seed: int = 7) -> list[dict]:
        """Muestra variada de viajes reales para elegir en el frontend."""
        import random

        ids = [t for t, pts in self.true_dict.items() if len(pts) >= 12]
        random.Random(seed).shuffle(ids)
        out = []
        for tid in ids:
            pts = self.true_dict[tid]
            lon, lat = to_wgs84(pts[0][0], pts[0][1])
            out.append({
                "id": tid,
                "type": infer_type(tid),
                "n_points": len(pts),
                "start": [float(lon), float(lat)],
            })
            if len(out) >= n:
                break
        return out

    def get_track(self, tid: str) -> list[list[float]] | None:
        """Recorrido completo de un viaje real en lon/lat, para reproducir como GPS en vivo."""
        pts = self.true_dict.get(tid)
        if not pts:
            return None
        out: list[list[float]] = []
        for (x, y, _t) in pts:
            lon, lat = to_wgs84(x, y)
            out.append([float(lon), float(lat)])
        return out

    def get_demo(self, tid: str, topk: int = 3, frac: float = 0.75) -> dict | None:
        """Para un viaje real: prefijo observado (75%), predicción y recorrido real."""
        pts = self.true_dict.get(tid)
        if not pts or len(pts) < 4:
            return None
        cut = max(2, int(len(pts) * frac))
        prefix_m, suffix_m = pts[:cut], pts[cut:]

        def ll(seq):
            res = []
            for (x, y, _t) in seq:
                lon, lat = to_wgs84(x, y)
                res.append([float(lon), float(lat)])
            return res

        prefix_ll = ll(prefix_m)
        truth_ll = ll(suffix_m)

        prefix_for_pred = [(c[0], c[1], i) for i, c in enumerate(prefix_ll)]
        # horizonte = nº de puntos del recorrido real oculto (para comparar de igual a igual)
        n_pred = max(1, len(suffix_m))
        cands = self.predict(
            prefix_for_pred, veh_type=infer_type(tid), topk=topk,
            exclude_id=tid, n_pred=n_pred,
        )

        # error final (FDE) del candidato #1 vs el recorrido real, a su mismo horizonte
        fde_m = None
        horizon_m = None
        if cands and truth_ll:
            pred_coords = cands[0].coordinates
            horizon_m = cands[0].length_m
            ref = _point_at_distance(truth_ll, horizon_m)
            if ref and pred_coords:
                fde_m = round(_haversine_m(pred_coords[-1], ref), 1)

        return {
            "id": tid,
            "type": infer_type(tid),
            "prefix": prefix_ll,
            "truth": truth_ll,
            "candidates": [
                {
                    "rank": c.rank,
                    "neighbor_id": c.neighbor_id,
                    "coordinates": c.coordinates,
                    "length_m": c.length_m,
                    "confidence": c.confidence,
                }
                for c in cands
            ],
            "fde_m": fde_m,
            "horizon_m": horizon_m,
        }

    # --- interno ---
    def _collect(self, prefix, want_type, radius, w_ang, restrict, n_pred, topk,
                 exclude_id=None):
        xL, yL, _ = prefix[-1]
        hL = heading(prefix[-2][:2], prefix[-1][:2])

        k = min(K_NEIGH_MAX, self._A.shape[0])
        dists, idxs = self._tree.query([[xL, yL]], k=k)
        idxs, dists = idxs[0], dists[0]

        scored: list[tuple[float, str, int]] = []
        for d, idx in zip(dists, idxs):
            if d > radius:
                continue
            cid, j, ctype = self._meta[idx]
            if exclude_id and cid == exclude_id:
                continue  # nunca predecir copiándose a sí misma (criterio de la tesis)
            if restrict and ctype != want_type:
                continue
            cand = self.true_dict[cid]
            if j + 1 >= len(cand):
                continue
            hc = heading(cand[j][:2], cand[j + 1][:2])
            ad = angle_diff(hL, hc)
            score = (d / max(radius, 1e-6)) + w_ang * (ad / math.pi)
            scored.append((score, cid, j))

        out, seen = [], set()
        for sc, cid, j in sorted(scored, key=lambda z: z[0]):
            if cid in seen:
                continue
            seen.add(cid)
            cand = self.true_dict[cid]
            tail = cand[j + 1 : j + 1 + max(1, n_pred)]
            tail, length_m = self._trim_tail(tail, self.max_meters)
            if tail:
                out.append((cid, j, tail, length_m, sc))
            if len(out) >= topk:
                break
        return out

    @staticmethod
    def _trim_tail(tail, max_m):
        if not tail:
            return tail, 0.0
        acc = 0.0
        out = [tail[0]]
        for i in range(1, len(tail)):
            dx = tail[i][0] - tail[i - 1][0]
            dy = tail[i][1] - tail[i - 1][1]
            step = math.hypot(dx, dy)
            if acc + step > max_m:
                break
            acc += step
            out.append(tail[i])
        return out, acc
