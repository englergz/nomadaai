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

# Pesos del índice (editables por CLI). Reflejan una hipótesis criminológica para Tumaco:
# densidad (exposición/actividades rutinarias) + periferia/aislamiento (baja vigilancia, corredores).
W_DENS = 0.35    # densidad poblacional (DANE)
W_EXPO = 0.20    # actividad/tráfico
W_PERIPH = 0.30  # periferia/aislamiento
W_POLICE = 0.15  # lejanía de estación de policía (guardián capaz, Cohen & Felson 1979)
NIGHT_FLOOR = 0.5  # piso de la curva temporal (la violencia no se anula de madrugada)


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


def pctile(xs):
    """Cada valor → su percentil [0,1]. Así todos los factores quedan uniformes y los PESOS
    controlan la influencia real (no la varianza de cada factor)."""
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    r = [0.0] * len(xs)
    n = len(xs) or 1
    for rank, i in enumerate(order):
        r[i] = (rank + 1) / n
    return r


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


def fetch_police():
    """Estaciones de policía → (x,y) en 3857. Lee el archivo bundleado (por ciudad); si no,
    consulta OSM. Factor 'guardián capaz' (Cohen & Felson, 1979)."""
    pf = ART / "tumaco_police.json"
    if pf.exists():
        pts = json.loads(pf.read_text(encoding="utf-8"))
        return [to3857(p["lon"], p["lat"]) for p in pts]
    ql = '[out:json][timeout:60];node["amenity"="police"](1.75,-78.83,1.86,-78.70);out body;'
    for ep in ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"):
        try:
            req = urllib.request.Request(ep + "?" + urllib.parse.urlencode({"data": ql}),
                                         headers={"User-Agent": "NomadaAI-academic/1.0"})
            els = json.load(urllib.request.urlopen(req, timeout=90)).get("elements", [])
            return [to3857(e["lon"], e["lat"]) for e in els if "lat" in e]
        except Exception as e:  # noqa: BLE001
            print("  policía falló:", e)
    return []


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

    # Factor de PERIFERIA/AISLAMIENTO: distancia (en celdas) al centroide poblacional. Las zonas
    # periféricas y de baja vigilancia tienden a mayor violencia dirigida (Jacobs 1961 'ojos en la
    # calle'; Newman 1972 espacio defendible; CEDRE 2024: corredores/débil presencia estatal en la
    # periferia). Contrapesa el sesgo de "solo el centro concurrido es riesgoso".
    # coordenadas 3857 del centro de cada celda
    cxy = [(x0 + (ix + 0.5) * CELL, y0 + (iy + 0.5) * CELL) for (ix, iy) in cells]
    tot_p = sum(P) or 1.0
    cx = sum(cxy[i][0] * P[i] for i in range(len(cells))) / tot_p
    cy = sum(cxy[i][1] * P[i] for i in range(len(cells))) / tot_p
    periph = [((cxy[i][0] - cx) ** 2 + (cxy[i][1] - cy) ** 2) ** 0.5 for i in range(len(cells))]

    # Distancia a la estación de policía más cercana (lejanía = menor guardián capaz = ↑ riesgo).
    police = fetch_police()
    print(f"Estaciones de policía (OSM): {len(police)}")
    if police:
        nopol = [min(((cxy[i][0] - px) ** 2 + (cxy[i][1] - py) ** 2) ** 0.5 for (px, py) in police)
                 for i in range(len(cells))]
    else:
        nopol = [0.0] * len(cells)

    nd, na, npf, npo = pctile(P), pctile(A), pctile(periph), pctile(nopol)
    idx = [round(100 * (W_DENS * nd[i] + W_EXPO * na[i] + W_PERIPH * npf[i] + W_POLICE * npo[i]), 2)
           for i in range(len(cells))]

    order = sorted(range(len(idx)), key=lambda i: idx[i])
    lvl = [""] * len(idx)
    for rank, i in enumerate(order):
        q = rank / len(order)
        lvl[i] = "alto" if q >= 0.85 else ("medio" if q >= 0.50 else "bajo")

    from collections import Counter
    print(f"pesos: densidad={W_DENS} actividad={W_EXPO} periferia={W_PERIPH} lejaníaPolicía={W_POLICE}")
    print(f"corr(índice): población={pearson(idx, P):.3f} tráfico={pearson(idx, A):.3f} "
          f"periferia={pearson(idx, periph):.3f} lejaníaPolicía={pearson(idx, nopol):.3f}")
    print(f"niveles: {dict(Counter(lvl))}")

    # centroides lon/lat de cada celda
    def cell_lonlat(ix, iy):
        return to4326(x0 + (ix + 0.5) * CELL, y0 + (iy + 0.5) * CELL)

    # Curva HORARIA con RESPALDO CITABLE (no supuesto): CEJ "Reloj de la Criminalidad" (2019) +
    # INMLCF/Medicina Legal → los homicidios se concentran 18:00–23:59 (hasta 2× el promedio),
    # con pico ~20:00-22:00; menor en la mañana/madrugada. Curva relativa (0-1) sobre ese patrón.
    HOUR_REL = {0: .55, 1: .50, 2: .45, 3: .42, 4: .45, 5: .50, 6: .55, 7: .60, 8: .62, 9: .63,
                10: .65, 11: .67, 12: .70, 13: .72, 14: .74, 15: .76, 16: .80, 17: .88, 18: .95,
                19: 1.0, 20: 1.0, 21: .98, 22: .90, 23: .75}
    tfac = {h: NIGHT_FLOOR + (1 - NIGHT_FLOOR) * HOUR_REL[h] for h in range(24)}
    print("curva horaria: fuente CEJ Reloj de la Criminalidad 2019 (pico 18-24h)")

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
    import argparse
    ap = argparse.ArgumentParser(description="Reconstruye el índice de riesgo (pesos editables).")
    ap.add_argument("--w-dens", type=float, default=W_DENS, help="peso densidad poblacional")
    ap.add_argument("--w-expo", type=float, default=W_EXPO, help="peso actividad/tráfico")
    ap.add_argument("--w-periph", type=float, default=W_PERIPH, help="peso periferia/aislamiento")
    ap.add_argument("--w-police", type=float, default=W_POLICE, help="peso lejanía de policía")
    ap.add_argument("--night-floor", type=float, default=NIGHT_FLOOR, help="piso de la curva temporal (0-1)")
    a = ap.parse_args()
    s = (a.w_dens + a.w_expo + a.w_periph + a.w_police) or 1.0
    W_DENS, W_EXPO, W_PERIPH, W_POLICE = a.w_dens / s, a.w_expo / s, a.w_periph / s, a.w_police / s
    NIGHT_FLOOR = a.night_floor
    main()
