#!/usr/bin/env python3
"""Reconstruye el índice de riesgo con datos DANE reales por manzana (OE2).

Motivación (evidencia): el índice anterior estaba explicado en 96% por la densidad de tráfico
(`n_points`) y su factor socioeconómico era ~constante (estrato 1 en el 99% de Tumaco) → sin
contraste espacial real. Este script:

1. Descarga las **manzanas censales DANE 2018** de Tumaco (población `SEXO_TOTAL` + geometría) del
   servicio Esri Colombia.
2. Agrega la **población real por celda** de la malla de 150 m del RTM.
3. Reconstruye el índice = mezcla de **densidad poblacional (DANE)** y exposición de actividad,
   sin el factor socioeconómico constante (se documenta que el estrato es homogéneo).
4. Recalibra los niveles (bajo/medio/alto) por cuantiles y regenera el CSV horario que usa la app,
   preservando la curva temporal existente.
5. Imprime el **antes/después** (correlaciones y distribución de niveles).

Solo librería estándar. Escribe artifacts/risk/tumaco_riesgo_horario.csv (con respaldo .bak) y
artifacts/risk/tumaco_zonas_riesgo_v2.csv (para el popup enriquecido).
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


def to3857(lon: float, lat: float) -> tuple[float, float]:
    x = lon * R / 180.0
    y = math.log(math.tan((90 + lat) * math.pi / 360.0)) / (math.pi / 180.0) * R / 180.0
    return x, y


def _pearson(a, b):
    n = len(a); ma = sum(a) / n; mb = sum(b) / n
    num = sum((a[i] - ma) * (b[i] - mb) for i in range(n))
    da = sum((a[i] - ma) ** 2 for i in range(n)) ** 0.5
    db = sum((b[i] - mb) ** 2 for i in range(n)) ** 0.5
    return num / (da * db) if da and db else 0.0


def _minmax(xs):
    lo, hi = min(xs), max(xs)
    return [(x - lo) / (hi - lo) if hi > lo else 0.0 for x in xs]


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


def main():
    zonas = list(csv.DictReader(open(RTM)))
    # origen de la malla desde una celda conocida
    z0 = zonas[0]
    x0 = float(z0["x_center"]) - (int(z0["ix"]) + 0.5) * CELL
    y0 = float(z0["y_center"]) - (int(z0["iy"]) + 0.5) * CELL
    cells = {int(z["cell_id"]): z for z in zonas}

    print("Descargando manzanas DANE de Tumaco…")
    feats = fetch_manzanas()
    pob_cel = defaultdict(float)
    asign = 0
    for f in feats:
        a = f.get("attributes", {})
        p = a.get("SEXO_TOTAL") or 0
        c = centroid(f.get("geometry"))
        if not c or p <= 0:
            continue
        x, y = to3857(c[0], c[1])
        ix = int((x - x0) // CELL); iy = int((y - y0) // CELL)
        cid = ix * 100000 + iy
        if cid in cells:
            pob_cel[cid] += p
            asign += 1
    print(f"Manzanas asignadas a la malla urbana: {asign} · población urbana: {int(sum(pob_cel.values()))}")

    ids = [int(z["cell_id"]) for z in zonas]
    npts = [float(z["n_points"]) for z in zonas]
    old = [float(z["indice_riesgo_rtm"]) for z in zonas]
    pob = [pob_cel.get(i, 0.0) for i in ids]

    # Nuevo índice: densidad poblacional real (DANE) dominante + exposición de actividad secundaria.
    # Se descarta el factor socioeconómico por ser homogéneo (estrato 1 en el 99% → sin contraste).
    nd = _minmax(pob); ne = _minmax(npts)
    W_POB, W_EXP = 0.65, 0.35
    new = [round(100 * (W_POB * nd[i] + W_EXP * ne[i]), 2) for i in range(len(ids))]

    # Niveles por cuantiles (reparto sensato: ~15% alto, ~35% medio, resto bajo)
    order = sorted(range(len(new)), key=lambda i: new[i])
    lvl = [""] * len(new)
    for rank, i in enumerate(order):
        q = rank / len(order)
        lvl[i] = "alto" if q >= 0.85 else ("medio" if q >= 0.50 else "bajo")

    # Diagnóstico antes/después
    from collections import Counter
    print("\n===== ANTES vs DESPUÉS =====")
    print(f"corr(índice, tráfico n_points):  antes {_pearson(old, npts):.3f}  →  después {_pearson(new, npts):.3f}")
    print(f"corr(índice, población DANE):     antes {_pearson(old, pob):.3f}  →  después {_pearson(new, pob):.3f}")
    print(f"corr(nuevo, viejo):               {_pearson(new, old):.3f}")
    lv_old = Counter(z["riesgo_nivel"] for z in zonas)
    print(f"niveles antes:   {dict(lv_old)}")
    print(f"niveles después: {dict(Counter(lvl))}")

    # Curva temporal (global) desde el CSV horario actual: factor(h) = mean(riesgo_dyn(h)/old)
    hourly = list(csv.DictReader(open(HOURLY)))
    oldmap = {int(z["cell_id"]): float(z["indice_riesgo_rtm"]) for z in zonas}
    fac_num = defaultdict(float); fac_den = defaultdict(int)
    for r in hourly:
        cid = int(r["cell_id"]); h = int(r["hora"]); base = oldmap.get(cid)
        if base and base > 0:
            fac_num[h] += float(r["riesgo_dyn"]) / base; fac_den[h] += 1
    tfac = {h: (fac_num[h] / fac_den[h] if fac_den[h] else 1.0) for h in range(24)}
    print(f"\nCurva temporal preservada: pico h={max(tfac, key=tfac.get)} (×{max(tfac.values()):.2f}), "
          f"valle h={min(tfac, key=tfac.get)} (×{min(tfac.values()):.2f})")

    newmap = {ids[i]: new[i] for i in range(len(ids))}
    lvlmap = {ids[i]: lvl[i] for i in range(len(ids))}
    llmap = {int(z["cell_id"]): (z["lon"], z["lat"]) for z in zonas}

    # Regenerar CSV horario (respaldo del anterior)
    shutil.copyfile(HOURLY, HOURLY.with_suffix(".csv.bak"))
    with open(HOURLY, "w", newline="") as f:
        w = csv.writer(f); w.writerow(["cell_id", "lon", "lat", "hora", "riesgo_dyn"])
        for cid in ids:
            lon, lat = llmap[cid]
            for h in range(24):
                w.writerow([cid, lon, lat, h, round(newmap[cid] * tfac[h], 2)])

    # Zona v2 enriquecida (para el popup)
    with open(ART / "tumaco_zonas_riesgo_v2.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["cell_id", "lon", "lat", "poblacion_dane", "n_points", "indice", "nivel"])
        for i, cid in enumerate(ids):
            lon, lat = llmap[cid]
            w.writerow([cid, lon, lat, int(pob[i]), int(npts[i]), new[i], lvlmap[cid]])
    print(f"\nEscrito: {HOURLY.name} (nuevo) + tumaco_zonas_riesgo_v2.csv (+ .bak del anterior)")


if __name__ == "__main__":
    main()
