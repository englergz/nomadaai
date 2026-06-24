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
        """`cell` = tamaño de cuantización en metros (resolución del grafo)."""
        self.cell = cell
        g = nx.Graph()
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

    def route(self, origin: list[float], dest: list[float], vtype: str | None = None) -> dict | None:
        """origin/dest = [lon, lat]. `vtype` filtra calles según accesibilidad del vehículo."""
        if self._tree is None:
            return None
        a = self._snap(origin[0], origin[1])
        b = self._snap(dest[0], dest[1])
        if a == b:
            return None

        w_need = _width(vtype)
        graph: nx.Graph = self.g
        restricted = False
        if w_need > 0:
            # subgrafo con calles transitables por el tipo (ancho de tramo >= ancho del vehículo)
            graph = nx.subgraph_view(self.g, filter_edge=lambda u, v: self.g[u][v]["mw"] >= w_need)
            restricted = True

        path = None
        for gtry, restr in ((graph, restricted), (self.g, False)):
            try:
                path = nx.shortest_path(gtry, a, b, weight="w")
                restricted = restr
                break
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                path = None
        if path is None:
            return None

        coords: list[list[float]] = []
        dist = 0.0
        prev_xy = None
        for k in path:
            x, y = self._xy[self._index[k]]
            lon, lat = to_wgs84(x, y)
            coords.append([float(lon), float(lat)])
            if prev_xy is not None:
                dist += math.hypot(x - prev_xy[0], y - prev_xy[1])
            prev_xy = (x, y)
        return {"coords": coords, "distance_m": round(dist, 1), "n": len(coords),
                "vehicle_restricted": restricted}
