#!/usr/bin/env python3
"""Reconstruye el índice de riesgo con COBERTURA COMPLETA del casco urbano (OE2).

Problema: la malla anterior se derivaba solo de las trayectorias SUMO → había manzanas pobladas
**sin celda** (grillas faltantes) y celdas con "población 0" que no eran seguras. Este script
construye la malla de 150 m sobre **todas las manzanas censales DANE pobladas** del casco urbano
(unión con las celdas de actividad de tráfico), de modo que toda zona con viviendas tenga su celda.

Índice por celda = 0.65·norm(densidad poblacional DANE) + 0.35·norm(actividad de tráfico).
Niveles por cuantiles. Curva temporal (relativa) preservada desde el CSV horario actual.

Salidas (con respaldo .bak): artifacts/risk/tumaco_riesgo_horario.csv y tumaco_zonas_riesgo_v2.csv
"""
from __future__ import annotations

import csv
import json
import math
import shutil
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

ART = Path(__file__).resolve().parents[1] / "artifacts" / "risk"
RTM = ART / "tumaco_zonas_riesgo_rtm.csv"
HOURLY = ART / "tumaco_riesgo_horario.csv"
SVC = ("https://ags.esri.co/arcgis/rest/services/LivingAtlas/"
       "Censo_personas_manzana_2018/MapServer/0/query")
R = 20037508.34
CELL = 150.0
MARGIN = 6  # celdas de margen alrededor del área con trayectorias (evita traer zona rural lejana)


def to3857(lon, lat):
    x = lon * R / 180.0
    y = math.log(math.tan((90 + lat) * math.pi / 360.0)) / (math.pi / 180.0) * R / 180.0
    return x, y


def to4326(x, y):
    lon = x / R * 180.0
    lat = math.atan(math.exp(y / R * 180.0 * (math.pi / 180.0))) * 360.0 / math.pi - 90.0
    return lon, lat


def minmax(xs):
    lo, hi = min(xs), max(xs)
    return [(v - lo) / (hi - lo) if hi > lo else 0.0 for v in xs]


def pearson(a, b):
    n = len(a); ma = sum(a) / n; mb = sum(b) / n
    num = sum((a[i] - ma) * (b[i] - mb) for i in range(n))
    da = sum((a[i] - ma) ** 2 for i in range(n)) ** 0.5
    db = sum((b[i] - mb) ** 2 for i in range(n)) ** 0.5
    return num / (da * db) if da and db else 0.0


def centroid(geom):
    rings = geom.get("rings") if geom else None
    if not rings:
        return None
    pts = rings[0]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if not pts:
        return None
    n = len(pts)
    return (sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n)


def fetch_manzanas():
    feats, off = [], 0
    while True:
        params = {"where": "MPIO LIKE '%TUMACO%'", "outFields": "SEXO_TOTAL",
                  "returnGeometry": "true", "outSR": "4326", "f": "json",
                  "resultOffset": off, "resultRecordCount": 1000}
        req = urllib.request.Request(SVC + "?" + urllib.parse.urlencode(params),
                                     headers={"User-Agent": "NomadaAI/1.0"})
        d = json.load(urllib.request.urlopen(req, timeout=180))
        f = d.get("features", []); feats += f
        if len(f) < 1000:
            break
        off += 1000
    return feats


def main():
    zonas = list(csv.DictReader(open(RTM)))
    z0 = zonas[0]
    x0 = float(z0["x_center"]) - (int(z0["ix"]) + 0.5) * CELL
    y0 = float(z0["y_center"]) - (int(z0["iy"]) + 0.5) * CELL

    # actividad (tráfico) por celda existente + rango del área urbana con trayectorias
    act = {}
    ixs, iys = [], []
    for z in zonas:
        ix, iy = int(z["ix"]), int(z["iy"])
        act[(ix, iy)] = float(z["n_points"])
        ixs.append(ix); iys.append(iy)
    ix_min, ix_max = min(ixs) - MARGIN, max(ixs) + MARGIN
    iy_min, iy_max = min(iys) - MARGIN, max(iys) + MARGIN

    print("Descargando manzanas DANE…")
    feats = fetch_manzanas()
    pob = defaultdict(float)
    for f in feats:
        p = f.get("attributes", {}).get("SEXO_TOTAL") or 0
        c = centroid(f.get("geometry"))
        if not c or p <= 0:
            continue
        x, y = to3857(c[0], c[1])
        ix = int((x - x0) // CELL); iy = int((y - y0) // CELL)
        if ix_min <= ix <= ix_max and iy_min <= iy <= iy_max:  # dentro del casco urbano (+margen)
            pob[(ix, iy)] += p

    # Unión de celdas: con población (DANE) o con actividad (trayectorias)
    cells = sorted(set(act) | set(pob))
    print(f"Celdas: antes {len(zonas)} (solo tráfico)  →  ahora {len(cells)} (tráfico ∪ población)")
    nuevas_pob = sum(1 for c in cells if c in pob and c not in act)
    print(f"  celdas nuevas por población (antes faltaban): {nuevas_pob}")

    P = [pob.get(c, 0.0) for c in cells]
    A = [act.get(c, 0.0) for c in cells]
    nd, na = minmax(P), minmax(A)
    idx = [round(100 * (0.65 * nd[i] + 0.35 * na[i]), 2) for i in range(len(cells))]

    order = sorted(range(len(idx)), key=lambda i: idx[i])
    lvl = [""] * len(idx)
    for rank, i in enumerate(order):
        q = rank / len(order)
        lvl[i] = "alto" if q >= 0.85 else ("medio" if q >= 0.50 else "bajo")

    from collections import Counter
    print(f"corr(índice, población): {pearson(idx, P):.3f} · corr(índice, tráfico): {pearson(idx, A):.3f}")
    print(f"niveles: {dict(Counter(lvl))}")

    # centroides lon/lat de cada celda
    def cell_lonlat(ix, iy):
        return to4326(x0 + (ix + 0.5) * CELL, y0 + (iy + 0.5) * CELL)

    # curva temporal relativa desde el CSV horario actual (media por hora, normalizada al pico)
    hourly = list(csv.DictReader(open(HOURLY)))
    hsum = defaultdict(float); hcnt = defaultdict(int)
    for r in hourly:
        h = int(r["hora"]); hsum[h] += float(r["riesgo_dyn"]); hcnt[h] += 1
    hmean = {h: (hsum[h] / hcnt[h] if hcnt[h] else 0.0) for h in range(24)}
    peak = max(hmean.values()) or 1.0
    tfac = {h: hmean[h] / peak for h in range(24)}
    print(f"curva temporal (relativa): pico h={max(tfac, key=tfac.get)} valle h={min(tfac, key=tfac.get)}")

    shutil.copyfile(HOURLY, HOURLY.with_suffix(".csv.bak"))
    with open(HOURLY, "w", newline="") as f:
        w = csv.writer(f); w.writerow(["cell_id", "lon", "lat", "hora", "riesgo_dyn"])
        for i, (ix, iy) in enumerate(cells):
            lon, lat = cell_lonlat(ix, iy)
            cid = ix * 100000 + iy
            for h in range(24):
                w.writerow([cid, round(lon, 6), round(lat, 6), h, round(idx[i] * tfac[h], 2)])
    with open(ART / "tumaco_zonas_riesgo_v2.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["cell_id", "lon", "lat", "poblacion_dane", "n_points", "indice", "nivel"])
        for i, (ix, iy) in enumerate(cells):
            lon, lat = cell_lonlat(ix, iy)
            w.writerow([ix * 100000 + iy, round(lon, 6), round(lat, 6), int(P[i]), int(A[i]), idx[i], lvl[i]])
    print(f"\nEscrito {HOURLY.name} ({len(cells)} celdas × 24h) + tumaco_zonas_riesgo_v2.csv")


if __name__ == "__main__":
    main()
