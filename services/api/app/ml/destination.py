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
        n_pred = max(1, int(round(L * self.frac_miss / (1 - self.frac_miss))))

        found: list[tuple[str, int, list, float, float]] = []
        for (radius, w_ang, restrict) in R_TIERS:
            if len(found) >= topk:
                break
            found += self._collect(
                prefix, want_type, radius, w_ang, restrict, n_pred, topk - len(found)
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

    # --- interno ---
    def _collect(self, prefix, want_type, radius, w_ang, restrict, n_pred, topk):
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
