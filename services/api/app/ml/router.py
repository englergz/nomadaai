"""Motor de rutas sobre la red vial de Tumaco (OE3), consciente del tipo de vehículo.

Construye un grafo navegable a partir de las trayectorias reales (sus segmentos son
tramos de calle reales) y calcula el camino más corto entre un origen y un destino
arbitrarios. Permite **inyectar una ruta NUEVA** (origen→destino inédito) y respeta la
**accesibilidad por tipo de vehículo**: una calle es transitable para un tipo si fue
recorrida por algún vehículo de igual o mayor "ancho" (modelo jerárquico, basado en datos:
si pasó un bus, un carro cabe; si solo pasaron motos, un carro no entra).

Se construye una sola vez, de forma perezosa, sobre los puntos en EPSG:3857 (metros).
"""
from __future__ import annotations

import math

import networkx as nx
import numpy as np
from sklearn.neighbors import KDTree

from app.core.geo import to_mercator, to_wgs84
from app.ml.destination import infer_type

# Ancho/jerarquía por tipo: 0 = moto/bici (entra a casi todo), 2 = bus/camión (calles anchas).
_WIDTH = {"mot": 0, "bike": 0, "moto": 0, "taxi": 1, "car": 1, "van": 1, "suv": 1,
          "pickup": 1, "bus": 2, "truck": 2}


def _width(t: str | None) -> int:
    return _WIDTH.get((t or "car").lower(), 1)


class RouteGraph:
    def __init__(self, true_dict: dict, cell: float = 18.0) -> None:
        """`cell` = tamaño de cuantización en metros (resolución del grafo).

        Grafo **dirigido**: cada segmento A→B se agrega en el sentido en que el agente lo
        recorrió. Una calle de doble sentido tendrá ambas aristas (agentes en los dos
        sentidos); una de sentido único tendrá solo una → el ruteo respeta el tránsito.
        """
        self.cell = cell
        g = nx.DiGraph()
        node_xy: dict[tuple[int, int], tuple[float, float]] = {}

        def key(x: float, y: float) -> tuple[int, int]:
            return (int(round(x / cell)), int(round(y / cell)))

        for tid, pts in true_dict.items():
            vw = _width(infer_type(tid))
            prev_k = None
            for (x, y, _t) in pts:
                k = key(x, y)
                if k not in node_xy:
                    node_xy[k] = (float(x), float(y))
                if prev_k is not None and prev_k != k:
                    if g.has_edge(prev_k, k):
                        e = g[prev_k][k]
                        if vw > e["mw"]:
                            e["mw"] = vw  # ancho máximo de vehículo que usó el tramo
                    else:
                        ax, ay = node_xy[prev_k]
                        bx, by = node_xy[k]
                        g.add_edge(prev_k, k, w=math.hypot(bx - ax, by - ay), mw=vw)
                prev_k = k

        self.g = g
        self._keys = list(node_xy.keys())
        self._index = {k: i for i, k in enumerate(self._keys)}
        self._xy = np.array([node_xy[k] for k in self._keys], dtype=float)
        self._tree = KDTree(self._xy) if len(self._keys) else None
        self.n_nodes = g.number_of_nodes()
        self.n_edges = g.number_of_edges()

    def _snap(self, lon: float, lat: float) -> tuple[int, int]:
        x, y = to_mercator(lon, lat)
        _d, idx = self._tree.query([[x, y]], k=1)
        return self._keys[int(idx[0][0])]

    def _node_risk(self, hour: int, risk) -> dict:
        """Riesgo normalizado [0,1] de la zona de cada nodo a una hora (cacheado por hora)."""
        if not hasattr(self, "_nr_cache"):
            self._nr_cache = {}
        h = int(hour) % 24
        if h in self._nr_cache:
            return self._nr_cache[h]
        nr = {}
        for k in self._keys:
            x, y = self._xy[self._index[k]]
            lon, lat = to_wgs84(x, y)
            nr[k] = risk.risk_at(lon, lat, h)[1]  # risk_norm
        self._nr_cache[h] = nr
        return nr

    def _metrics(self, path, nr) -> dict:
        """coords lon/lat, distancia (m) y exposición al riesgo (Σ longitud·riesgo) de un camino."""
        coords, dist, expo, prev = [], 0.0, 0.0, None
        for k in path:
            x, y = self._xy[self._index[k]]
            lon, lat = to_wgs84(x, y)
            coords.append([float(lon), float(lat)])
            if prev is not None:
                seg = math.hypot(x - prev[0], y - prev[1])
                dist += seg
                if nr is not None:
                    expo += seg * 0.5 * (nr.get(prev[2], 0.0) + nr.get(k, 0.0))
            prev = (x, y, k)
        return {"coords": coords, "distance_m": round(dist, 1), "exposure": round(expo, 1)}

    def route(self, origin: list[float], dest: list[float], vtype: str | None = None,
              hour: int = 19, risk_weight: float = 0.0, risk=None) -> dict | None:
        """origin/dest = [lon, lat]. Devuelve la ruta SEGURA (ponderada por riesgo) y la compara
        con la directa (más corta). `risk_weight` (λ) = prioridad de seguridad vs. distancia."""
        if self._tree is None:
            return None
        a = self._snap(origin[0], origin[1])
        b = self._snap(dest[0], dest[1])
        if a == b:
            return None

        w_need = _width(vtype)
        attempts = []
        if w_need > 0:
            typed = nx.subgraph_view(self.g, filter_edge=lambda u, v: self.g[u][v]["mw"] >= w_need)
            attempts.append((typed, True, True))
        attempts.append((self.g, False, True))
        attempts.append((self.g.to_undirected(as_view=True), False, False))

        gsel, restricted, directional, path_direct = None, False, True, None
        for gtry, restr, direc in attempts:
            try:
                path_direct = nx.shortest_path(gtry, a, b, weight="w")
                gsel, restricted, directional = gtry, restr, direc
                break
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                path_direct = None
        if path_direct is None:
            return None

        nr = self._node_risk(hour, risk) if risk is not None else None

        # Ruta segura: minimiza distancia·(1 + λ·riesgo)
        path_safe = path_direct
        if risk_weight > 0 and nr is not None:
            def wfn(u, v, dd):
                return dd["w"] * (1.0 + risk_weight * 0.5 * (nr.get(u, 0.0) + nr.get(v, 0.0)))
            try:
                path_safe = nx.shortest_path(gsel, a, b, weight=wfn)
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                path_safe = path_direct

        m_safe = self._metrics(path_safe, nr)
        m_direct = self._metrics(path_direct, nr)
        reduction = 0.0
        if nr is not None and m_direct["exposure"] > 0:
            reduction = round(100 * (m_direct["exposure"] - m_safe["exposure"]) / m_direct["exposure"], 1)

        return {
            "coords": m_safe["coords"], "distance_m": m_safe["distance_m"], "n": len(m_safe["coords"]),
            "vehicle_restricted": restricted, "directional": directional,
            "direct_coords": m_direct["coords"],
            "comparison": {
                "safe_distance_m": m_safe["distance_m"], "direct_distance_m": m_direct["distance_m"],
                "safe_exposure": m_safe["exposure"], "direct_exposure": m_direct["exposure"],
                "exposure_reduction_pct": reduction,
            },
        }
