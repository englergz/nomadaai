#!/usr/bin/env python3
"""OE2 — Validación **honesta** del modelo de riesgo (RTM).

Los datos abiertos de homicidios de Tumaco (Policía Nacional, datos.gov.co, dataset m8fd-ahd9)
**no traen coordenadas ni hora** (solo municipio + zona URBANA/RURAL + fecha + arma + modalidad).
Por eso NO es posible una precisión/recall espacial punto a punto sin microdato georreferenciado
(DIJIN, en trámite). Lo que sí se valida con evidencia:

1. **Caracterización real del riesgo** (contexto que justifica los factores del RTM): arma, modalidad,
   distribución urbana/rural y tendencia anual de los homicidios.
2. **Análisis de sensibilidad** del índice RTM: ¿el *ranking* de zonas por riesgo es estable ante
   cambios en los pesos de los factores? (robustez, técnica estándar en Risk Terrain Modeling).

Solo usa librería estándar. Escribe artifacts/eval/oe2_homicidios_tumaco.csv y un resumen por consola.
"""
from __future__ import annotations

import csv
import json
import random
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ART = Path(__file__).resolve().parents[1] / "artifacts"
RTM_CSV = ART / "risk" / "tumaco_zonas_riesgo_rtm.csv"
COD_TUMACO = "52835"
DATASET = "m8fd-ahd9"


# ---------- utilidades estadísticas (sin numpy) ----------
def _ranks(xs: list[float]) -> list[float]:
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    r = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        avg = (i + j) / 2 + 1
        for k in range(i, j + 1):
            r[order[k]] = avg
        i = j + 1
    return r


def _pearson(a: list[float], b: list[float]) -> float:
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    num = sum((a[i] - ma) * (b[i] - mb) for i in range(n))
    da = sum((a[i] - ma) ** 2 for i in range(n)) ** 0.5
    db = sum((b[i] - mb) ** 2 for i in range(n)) ** 0.5
    return num / (da * db) if da and db else 0.0


def spearman(a: list[float], b: list[float]) -> float:
    return _pearson(_ranks(a), _ranks(b))


def _minmax(xs: list[float]) -> list[float]:
    lo, hi = min(xs), max(xs)
    return [(x - lo) / (hi - lo) if hi > lo else 0.0 for x in xs]


# ---------- 1) caracterización real de homicidios ----------
def homicidios() -> dict:
    url = f"https://www.datos.gov.co/resource/{DATASET}.json?" + urllib.parse.urlencode(
        {"$where": f"cod_muni='{COD_TUMACO}'", "$limit": 100000}
    )
    req = urllib.request.Request(url, headers={"User-Agent": "NomadaAI/1.0"})
    rows = json.load(urllib.request.urlopen(req, timeout=90))

    def by(key: str) -> Counter:
        c: Counter = Counter()
        for r in rows:
            c[r.get(key, "NA")] += int(float(r.get("cantidad", 1)))
        return c

    total = sum(int(float(r.get("cantidad", 1))) for r in rows)
    zona = by("zona")
    base = zona.get("URBANA", 0) + zona.get("RURAL", 0)
    out = ART / "eval" / "oe2_homicidios_tumaco.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["dimension", "categoria", "homicidios"])
        for dim, cnt in [("zona", zona), ("arma", by("arma_medio")), ("modalidad", by("_modalidad_presunta"))]:
            for k, v in cnt.most_common():
                w.writerow([dim, k, v])
    return {
        "total": total, "n_registros": len(rows),
        "pct_urbana": round(100 * zona.get("URBANA", 0) / base, 1) if base else None,
        "pct_rural": round(100 * zona.get("RURAL", 0) / base, 1) if base else None,
        "arma_top": by("arma_medio").most_common(3),
        "modalidad_top": by("_modalidad_presunta").most_common(3),
        "csv": str(out),
    }


# ---------- 2) sensibilidad del RTM ----------
def sensibilidad(n_iter: int = 1000, seed: int = 42) -> dict:
    with open(RTM_CSV, newline="") as f:
        zonas = list(csv.DictReader(f))
    exp = _minmax([float(z["n_points"]) for z in zonas])
    soc = _minmax([float(z["socio"]) for z in zonas])
    pop = _minmax([float(z["pop"]) for z in zonas])
    publicado = [float(z["indice_riesgo_rtm"]) for z in zonas]

    # pesos base ≈ importancia media observada en las contribuciones del RTM publicado
    ce = sum(float(z["contrib_exp"]) for z in zonas)
    cs = sum(float(z["contrib_socio"]) for z in zonas)
    cp = sum(float(z["contrib_pop"]) for z in zonas)
    tot = ce + cs + cp
    w0 = (ce / tot, cs / tot, cp / tot)

    def index(w):
        return [w[0] * exp[i] + w[1] * soc[i] + w[2] * pop[i] for i in range(len(zonas))]

    base = index(w0)
    fidelidad = spearman(base, publicado)  # ¿mi reconstrucción refleja el índice publicado?

    rnd = random.Random(seed)
    rhos = []
    n = len(zonas)
    top = max(1, n // 10)
    base_top = set(sorted(range(n), key=lambda i: -base[i])[:top])
    keep = []
    for _ in range(n_iter):
        w = [max(0.0, w0[k] * (1 + rnd.uniform(-0.5, 0.5))) for k in range(3)]  # ±50%
        s = sum(w) or 1
        w = [x / s for x in w]
        idx = index(w)
        rhos.append(spearman(base, idx))
        p_top = set(sorted(range(n), key=lambda i: -idx[i])[:top])
        keep.append(len(base_top & p_top) / top)
    rhos.sort()
    return {
        "n_zonas": n,
        "pesos_base": {"exp": round(w0[0], 3), "socio": round(w0[1], 3), "pop": round(w0[2], 3)},
        "fidelidad_vs_publicado_rho": round(fidelidad, 3),
        "spearman_medio": round(sum(rhos) / len(rhos), 3),
        "spearman_p05": round(rhos[len(rhos) // 20], 3),
        "spearman_min": round(rhos[0], 3),
        "top10pct_preservado_medio": round(100 * sum(keep) / len(keep), 1),
    }


def main() -> None:
    print("===== OE2 · Validación del modelo de riesgo (honesta) =====\n")
    print("[1] Caracterización real de homicidios (datos.gov.co, sin coords ni hora):")
    h = homicidios()
    print(f"    Total {h['total']} homicidios ({h['n_registros']} registros).")
    print(f"    Zona: URBANA {h['pct_urbana']}% · RURAL {h['pct_rural']}%")
    print(f"    Arma: {h['arma_top']}")
    print(f"    Modalidad: {h['modalidad_top']}")
    print(f"    CSV: {h['csv']}")
    print("\n[2] Sensibilidad del índice RTM (robustez del ranking de zonas):")
    s = sensibilidad()
    print(f"    Zonas: {s['n_zonas']} · pesos base {s['pesos_base']}")
    print(f"    Fidelidad reconstrucción vs índice publicado: ρ={s['fidelidad_vs_publicado_rho']}")
    print(f"    Ranking estable ante ±50% en pesos: ρ medio {s['spearman_medio']} "
          f"(p05 {s['spearman_p05']}, mín {s['spearman_min']})")
    print(f"    Top-10% de zonas de riesgo preservado: {s['top10pct_preservado_medio']}%")
    print("\nLimitación declarada: sin microdato georreferenciado (DIJIN, en trámite) no hay "
          "precisión/recall espacial punto a punto; el RTM se valida como índice fundamentado + robusto.")


if __name__ == "__main__":
    main()
