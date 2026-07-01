#!/usr/bin/env python3
"""OE4 — Barrido sistemático origen-destino de la protección (ruta segura vs. directa).

Mide, sobre un conjunto de pares O-D **reales** (inicio y fin de trayectorias observadas, que por
construcción caen en la red vial), cuánto **reduce la exposición al riesgo** la ruta segura frente
a la directa, a distintas horas. Reporta la reducción media/mediana y el % de rutas que mejoran.

Es el respaldo cuantitativo del indicador OE4 ("mejora de seguridad") como **proxy objetivo**.

Uso:
    python oe4_od_sweep.py [BASE_URL] [N_PARES]
    # p. ej.  python oe4_od_sweep.py https://englergz-nomadaai.hf.space 40

Solo usa la librería estándar (urllib), así corre en cualquier Python 3 sin instalar nada.
Escribe `artifacts/eval/oe4_od_sweep.csv` y un resumen por consola.
"""
from __future__ import annotations

import csv
import json
import sys
import urllib.request
from pathlib import Path
from statistics import fmean, median

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://englergz-nomadaai.hf.space").rstrip("/")
N_PAIRS = int(sys.argv[2]) if len(sys.argv) > 2 else 40
HOURS = [6, 12, 18, 20, 22]
RISK_WEIGHT = 5.0  # λ = prioridad de seguridad máxima (evita riesgo) → protección alcanzable


def _get(path: str):
    with urllib.request.urlopen(f"{BASE}{path}", timeout=60) as r:
        return json.load(r)


def _post(path: str, body: dict):
    req = urllib.request.Request(
        f"{BASE}{path}", data=json.dumps(body).encode(),
        headers={"content-type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)


def main() -> None:
    print(f"Base: {BASE} · pares O-D: {N_PAIRS} · horas: {HOURS} · λ={RISK_WEIGHT}")
    trips = _get(f"/trajectories/sample?n={N_PAIRS}").get("trips", [])
    pairs: list[tuple[str, list, list]] = []
    for t in trips:
        try:
            track = _get(f"/trajectories/{t['id']}/track")
            c = track.get("coords", [])
            if len(c) >= 2:
                pairs.append((t["id"], c[0], c[-1]))
        except Exception as e:  # noqa: BLE001
            print(f"  (omito {t.get('id')}: {e})")
    print(f"Pares O-D válidos: {len(pairs)}")

    rows: list[dict] = []
    for tid, o, d in pairs:
        for h in HOURS:
            try:
                j = _post("/route/build", {
                    "origin": o, "dest": d, "type": None, "hour": h, "risk_weight": RISK_WEIGHT,
                })
            except Exception:  # noqa: BLE001 — O-D sin ruta factible
                continue
            comp = j.get("comparison")
            if not comp or comp.get("exposure_reduction_pct") is None:
                continue
            rows.append({
                "trip_id": tid, "hour": h,
                "exposure_reduction_pct": comp["exposure_reduction_pct"],
                "safe_exposure": comp.get("safe_exposure"),
                "direct_exposure": comp.get("direct_exposure"),
                "safe_dist_m": comp.get("safe_distance_m"),
                "direct_dist_m": comp.get("direct_distance_m"),
            })

    if not rows:
        print("Sin resultados (¿API caída?).")
        return

    out = Path(__file__).resolve().parents[1] / "artifacts" / "eval" / "oe4_od_sweep.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    red = [r["exposure_reduction_pct"] for r in rows]
    extra_dist = [
        100 * (r["safe_dist_m"] - r["direct_dist_m"]) / r["direct_dist_m"]
        for r in rows if r.get("direct_dist_m")
    ]
    print("\n===== RESUMEN OE4 (protección: ruta segura vs. directa) =====")
    print(f"Rutas evaluadas:            {len(rows)}  ({len(pairs)} O-D × {len(HOURS)} horas)")
    print(f"Reducción de exposición:    media {fmean(red):.1f}%  ·  mediana {median(red):.1f}%  ·  máx {max(red):.1f}%")
    print(f"Rutas que mejoran (>0%):    {100*sum(1 for x in red if x > 0)/len(red):.1f}%")
    if extra_dist:
        print(f"Sobrecosto de distancia:    media {fmean(extra_dist):.1f}%")
    print("\nPor hora:")
    for h in HOURS:
        hr = [r["exposure_reduction_pct"] for r in rows if r["hour"] == h]
        if hr:
            print(f"  {h:02d}:00 → media {fmean(hr):5.1f}%  ·  n={len(hr)}")
    print(f"\nCSV: {out}")


if __name__ == "__main__":
    main()
