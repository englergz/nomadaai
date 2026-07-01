"""Histórico de efectividad persistido en Postgres (Supabase).

Guarda **un registro por viaje simulado** con las dos comparaciones que importan:

- **Predicción:** el modelo (k-vecinos + rumbo) frente a un baseline ingenuo (línea recta).
- **Protección:** la ruta segura frente a la ruta directa (reducción de exposición al riesgo).

Diseñado para ser **replicable a cualquier ciudad** (la tabla no asume Tumaco) y para degradar
con elegancia: si no hay `DATABASE_URL`, el módulo reporta `available=False` y el frontend cae a
almacenamiento local. En cuanto se configura la credencial, pasa a ser un histórico real de producto.
"""
from __future__ import annotations

from typing import Any, Optional

from app.core.config import get_settings

_DDL = """
create table if not exists sim_effectiveness (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  city          text not null default 'tumaco',
  mode          text,
  vehicle       text,
  hour          int,
  -- Predicción: modelo vs línea recta
  n_pred        int     not null default 0,
  model_err_sum double precision not null default 0,
  base_err_sum  double precision not null default 0,
  model_hit50   int     not null default 0,
  base_hit50    int     not null default 0,
  -- Protección: ruta segura vs directa (solo modo 'draw')
  exposure_reduction_pct double precision,
  safe_exposure  double precision,
  direct_exposure double precision,
  safe_dist_m    double precision,
  direct_dist_m  double precision
);
"""

_ready = False


def _dsn() -> Optional[str]:
    return get_settings().database_url


def available() -> bool:
    return bool(_dsn())


def _connect():
    import psycopg  # import perezoso: la app arranca aunque no esté la credencial

    return psycopg.connect(_dsn(), connect_timeout=6)


def _ensure() -> None:
    global _ready
    if _ready:
        return
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(_DDL)
        conn.commit()
    _ready = True


def log_trip(rec: dict[str, Any]) -> dict[str, Any]:
    """Inserta el resumen de un viaje simulado. Devuelve {ok, id} o {ok:False}."""
    if not available():
        return {"ok": False, "available": False}
    _ensure()
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into sim_effectiveness
                  (city, mode, vehicle, hour, n_pred, model_err_sum, base_err_sum,
                   model_hit50, base_hit50, exposure_reduction_pct, safe_exposure,
                   direct_exposure, safe_dist_m, direct_dist_m)
                values (%(city)s, %(mode)s, %(vehicle)s, %(hour)s, %(n_pred)s,
                        %(model_err_sum)s, %(base_err_sum)s, %(model_hit50)s, %(base_hit50)s,
                        %(exposure_reduction_pct)s, %(safe_exposure)s, %(direct_exposure)s,
                        %(safe_dist_m)s, %(direct_dist_m)s)
                returning id
                """,
                {
                    "city": rec.get("city", "tumaco"),
                    "mode": rec.get("mode"),
                    "vehicle": rec.get("vehicle"),
                    "hour": rec.get("hour"),
                    "n_pred": int(rec.get("n_pred", 0)),
                    "model_err_sum": float(rec.get("model_err_sum", 0.0)),
                    "base_err_sum": float(rec.get("base_err_sum", 0.0)),
                    "model_hit50": int(rec.get("model_hit50", 0)),
                    "base_hit50": int(rec.get("base_hit50", 0)),
                    "exposure_reduction_pct": rec.get("exposure_reduction_pct"),
                    "safe_exposure": rec.get("safe_exposure"),
                    "direct_exposure": rec.get("direct_exposure"),
                    "safe_dist_m": rec.get("safe_dist_m"),
                    "direct_dist_m": rec.get("direct_dist_m"),
                },
            )
            new_id = cur.fetchone()[0]
        conn.commit()
    return {"ok": True, "id": new_id}


def summary(city: str = "tumaco") -> dict[str, Any]:
    """Agregados comparativos sobre todos los viajes registrados."""
    if not available():
        return {"available": False}
    _ensure()
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select
                  count(*)                                              as trips,
                  coalesce(sum(n_pred), 0)                              as n_pred,
                  coalesce(sum(model_err_sum), 0)                       as model_err_sum,
                  coalesce(sum(base_err_sum), 0)                        as base_err_sum,
                  coalesce(sum(model_hit50), 0)                         as model_hit50,
                  coalesce(sum(base_hit50), 0)                          as base_hit50,
                  count(exposure_reduction_pct)                         as n_routes,
                  avg(exposure_reduction_pct)                           as exp_red_avg,
                  min(created_at)                                       as since,
                  max(created_at)                                       as updated
                from sim_effectiveness
                where city = %s
                """,
                (city,),
            )
            r = cur.fetchone()

    trips, n_pred, m_sum, b_sum, m_hit, b_hit, n_routes, exp_avg, since, updated = r
    pred = None
    if n_pred:
        pred = {
            "n": int(n_pred),
            "model_acc50_pct": round(100 * m_hit / n_pred, 1),
            "base_acc50_pct": round(100 * b_hit / n_pred, 1),
            "mejora_pp": round(100 * (m_hit - b_hit) / n_pred, 1),
            "model_err_mean_m": round(m_sum / n_pred, 1),
            "base_err_mean_m": round(b_sum / n_pred, 1),
        }
    prot = None
    if n_routes:
        prot = {
            "n": int(n_routes),
            "exposure_reduction_avg_pct": round(float(exp_avg), 1),
        }
    return {
        "available": True,
        "trips": int(trips),
        "prediccion": pred,
        "proteccion": prot,
        "since": since.isoformat() if since else None,
        "updated": updated.isoformat() if updated else None,
    }


def reset(city: str = "tumaco") -> dict[str, Any]:
    if not available():
        return {"ok": False, "available": False}
    _ensure()
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute("delete from sim_effectiveness where city = %s", (city,))
        conn.commit()
    return {"ok": True}
