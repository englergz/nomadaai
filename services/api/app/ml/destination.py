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

# Baseline de Markov (1er orden) sobre una malla espacial: aprende, del conjunto TRAIN,
# la probabilidad de pasar de una celda a otra. Sirve como comparación "que sí aprende"
# frente al modelo (k-vecinos+rumbo) y al baseline ingenuo (línea recta).
MARKOV_CELL_M = 80.0


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


def _cell(x: float, y: float) -> tuple[int, int]:
    """Celda de la malla (en metros/EPSG:3857) a la que pertenece un punto."""
    return (int(math.floor(x / MARKOV_CELL_M)), int(math.floor(y / MARKOV_CELL_M)))


def _cell_centroid(cell: tuple[int, int]) -> tuple[float, float]:
    return ((cell[0] + 0.5) * MARKOV_CELL_M, (cell[1] + 0.5) * MARKOV_CELL_M)


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
        test_fraction: float = 0.2,
        test_seed: int = 42,
    ) -> None:
        self.default_topk = default_topk
        self.max_meters = max_meters
        self.frac_miss = frac_miss
        self.test_fraction = test_fraction
        self.test_seed = test_seed
        self._load(parquet_path, max_trajectories)

    def _load(self, parquet_path: Path, max_trajectories: int) -> None:
        import random

        df = pd.read_parquet(parquet_path)  # id, x, y, t (metros)
        if max_trajectories and max_trajectories > 0:
            keep = df["id"].drop_duplicates().head(max_trajectories)
            df = df[df["id"].isin(keep)]

        # true_dict: id -> [(x, y, t), ...] ordenado por t  (TODAS las trayectorias)
        self.true_dict: dict[str, list[tuple[float, float, float]]] = {}
        for tid, g in df.sort_values("t").groupby("id"):
            self.true_dict[tid] = list(
                zip(g.x.to_numpy(), g.y.to_numpy(), g.t.to_numpy())
            )

        # División train/test reproducible: el modelo SOLO indexa TRAIN; el conjunto
        # TEST queda NO VISTO para medir la efectividad sin sesgo.
        ids = sorted(self.true_dict.keys())
        random.Random(self.test_seed).shuffle(ids)
        n_test = int(len(ids) * self.test_fraction)
        self.test_ids: set[str] = set(ids[:n_test])
        self.train_ids: set[str] = set(ids[n_test:])

        # KDTree sobre el punto de inicio de cada segmento — SOLO con TRAIN
        rows: list[tuple[float, float, str, int, str]] = []
        for tid in self.train_ids:
            pts = self.true_dict[tid]
            typ = infer_type(tid)
            for j in range(len(pts) - 1):
                x, y, _ = pts[j]
                rows.append((x, y, tid, j, typ))

        self._A = np.array([[r[0], r[1]] for r in rows], dtype=float)
        self._meta = [(r[2], r[3], r[4]) for r in rows]  # (id, idx, type)
        self._tree = KDTree(self._A) if len(rows) else None
        self.n_trajectories = len(self.true_dict)
        self.n_train = len(self.train_ids)
        self.n_test = len(self.test_ids)
        self.n_segments = len(rows)

        # Matriz de transición de Markov (celda -> {celda_siguiente: conteo}), SOLO con TRAIN.
        self._trans: dict[tuple[int, int], dict[tuple[int, int], int]] = {}
        for tid in self.train_ids:
            seq: list[tuple[int, int]] = []
            for (x, y, _t) in self.true_dict[tid]:
                c = _cell(x, y)
                if not seq or seq[-1] != c:
                    seq.append(c)
            for a, b in zip(seq, seq[1:]):
                d = self._trans.setdefault(a, {})
                d[b] = d.get(b, 0) + 1

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
        """Viajes del conjunto TEST (NO vistos por el modelo) para evaluar sin sesgo."""
        import random

        ids = [t for t in self.test_ids if len(self.true_dict[t]) >= 12]
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
                "unseen": True,
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

        # BASELINE ingenuo: extrapolar el último tramo del prefijo en LÍNEA RECTA al mismo
        # horizonte. Permite demostrar cuánto aporta el modelo frente a "seguir derecho".
        baseline_fde_m = None
        if horizon_m and truth_ll and len(prefix_ll) >= 2:
            a, b = prefix_ll[-2], prefix_ll[-1]
            seg = _haversine_m(a, b)
            if seg > 1e-6:
                k = horizon_m / seg
                naive = [b[0] + (b[0] - a[0]) * k, b[1] + (b[1] - a[1]) * k]
                ref2 = _point_at_distance(truth_ll, horizon_m)
                if ref2:
                    baseline_fde_m = round(_haversine_m(naive, ref2), 1)

        # BASELINE de Markov: seguir la transición más probable aprendida (sí "aprende").
        markov_fde_m = None
        if horizon_m and truth_ll:
            end_m = self._markov_endpoint_m(prefix_m, horizon_m)
            if end_m:
                lon, lat = to_wgs84(end_m[0], end_m[1])
                ref3 = _point_at_distance(truth_ll, horizon_m)
                if ref3:
                    markov_fde_m = round(_haversine_m([float(lon), float(lat)], ref3), 1)

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
            "baseline_fde_m": baseline_fde_m,
            "markov_fde_m": markov_fde_m,
            "horizon_m": horizon_m,
        }

    def _markov_endpoint_m(self, prefix_m, horizon_m: float) -> tuple[float, float] | None:
        """Predice el punto final con una cadena de Markov **direccional**: desde la celda actual
        elige la transición aprendida (TRAIN) que combina alta probabilidad y coherencia con el
        rumbo actual, hasta cubrir `horizon_m` metros. Devuelve (x, y) en 3857.

        El sesgo por rumbo evita que en cruces se vaya al destino globalmente más común (que dejaría
        el baseline artificialmente malo): es una comparación **justa** para el modelo.
        """
        if not self._trans or not horizon_m or horizon_m <= 0:
            return None
        px, py = prefix_m[-1][0], prefix_m[-1][1]
        hdg = heading(prefix_m[-2][:2], prefix_m[-1][:2]) if len(prefix_m) >= 2 else 0.0
        cur = _cell(px, py)
        acc = 0.0
        visited = {cur}
        for _ in range(80):
            nxts = self._trans.get(cur)
            if not nxts:
                break
            total = sum(nxts.values()) or 1
            best, best_score = None, -1.0
            for c, cnt in nxts.items():
                if c in visited:
                    continue
                cx, cy = _cell_centroid(c)
                if math.hypot(cx - px, cy - py) < 1e-6:
                    continue
                align = 1.0 - angle_diff(hdg, heading((px, py), (cx, cy))) / math.pi  # 1=mismo rumbo
                score = (cnt / total) * (0.2 + 0.8 * align)
                if score > best_score:
                    best, best_score = c, score
            if best is None:
                break
            cx, cy = _cell_centroid(best)
            step = math.hypot(cx - px, cy - py)
            if acc + step >= horizon_m:
                f = (horizon_m - acc) / step
                return (px + (cx - px) * f, py + (cy - py) * f)
            acc += step
            hdg = heading((px, py), (cx, cy))
            px, py = cx, cy
            visited.add(best); cur = best
        return (px, py) if acc > 0 else None

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
