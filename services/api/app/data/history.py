"""Histórico de efectividad **por usuario** persistido en Postgres (Supabase).

Guarda **un registro por viaje simulado**, atado a un `user_id`, con las dos comparaciones que
importan:

- **Predicción:** el modelo (k-vecinos + rumbo) frente a un baseline ingenuo (línea recta).
- **Protección:** la ruta segura frente a la ruta directa (reducción de exposición al riesgo).

La dimensión de usuario habilita (a) **personalización** —que el sistema conozca a cada usuario— y
(b) **BI/estadísticas** agregadas. Diseñado para ser **replicable a cualquier ciudad** (columna
`city`) y para degradar con elegancia: si no hay `DATABASE_URL`, reporta `available=False` y el
frontend cae a almacenamiento local. En cuanto se configura la credencial, es un histórico real.
"""
from __future__ import annotations

from typing import Any, Optional

from app.core.config import get_settings

_DDL = """
create table if not exists sim_effectiveness (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  city          text not null default 'tumaco',
  user_id       text not null default 'anon',
  session_id    text,
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
create index if not exists sim_eff_city_user_idx on sim_effectiveness (city, user_id);
create index if not exists sim_eff_created_idx    on sim_effectiveness (created_at);
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
                  (city, user_id, session_id, mode, vehicle, hour, n_pred, model_err_sum,
                   base_err_sum, model_hit50, base_hit50, exposure_reduction_pct, safe_exposure,
                   direct_exposure, safe_dist_m, direct_dist_m)
                values (%(city)s, %(user_id)s, %(session_id)s, %(mode)s, %(vehicle)s, %(hour)s,
                        %(n_pred)s, %(model_err_sum)s, %(base_err_sum)s, %(model_hit50)s,
                        %(base_hit50)s, %(exposure_reduction_pct)s, %(safe_exposure)s,
                        %(direct_exposure)s, %(safe_dist_m)s, %(direct_dist_m)s)
                returning id
                """,
                {
                    "city": rec.get("city", "tumaco"),
                    "user_id": (rec.get("user_id") or "anon")[:64],
                    "session_id": rec.get("session_id"),
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


def summary(city: str = "tumaco", user_id: Optional[str] = None) -> dict[str, Any]:
    """Agregados comparativos. Si `user_id`, se filtra a ese usuario; si no, es global.

    Siempre incluye `users` (usuarios distintos) para dar contexto de BI.
    """
    if not available():
        return {"available": False}
    _ensure()
    where = "where city = %(city)s"
    params: dict[str, Any] = {"city": city}
    if user_id:
        where += " and user_id = %(uid)s"
        params["uid"] = user_id
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                select
                  count(*)                        as trips,
                  count(distinct user_id)         as users,
                  coalesce(sum(n_pred), 0)        as n_pred,
                  coalesce(sum(model_err_sum), 0) as model_err_sum,
                  coalesce(sum(base_err_sum), 0)  as base_err_sum,
                  coalesce(sum(model_hit50), 0)   as model_hit50,
                  coalesce(sum(base_hit50), 0)    as base_hit50,
                  count(exposure_reduction_pct)   as n_routes,
                  avg(exposure_reduction_pct)     as exp_red_avg,
                  min(created_at)                 as since,
                  max(created_at)                 as updated
                from sim_effectiveness
                {where}
                """,
                params,
            )
            r = cur.fetchone()

    trips, users, n_pred, m_sum, b_sum, m_hit, b_hit, n_routes, exp_avg, since, updated = r
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
        prot = {"n": int(n_routes), "exposure_reduction_avg_pct": round(float(exp_avg), 1)}
    return {
        "available": True,
        "scope": "user" if user_id else "global",
        "user_id": user_id,
        "trips": int(trips),
        "users": int(users),
        "prediccion": pred,
        "proteccion": prot,
        "since": since.isoformat() if since else None,
        "updated": updated.isoformat() if updated else None,
    }


def stats(city: str = "tumaco") -> dict[str, Any]:
    """Panel BI: totales, usuarios, y desgloses por hora, vehículo y día."""
    if not available():
        return {"available": False}
    _ensure()

    def rows(q: str) -> list[dict[str, Any]]:
        with _connect() as conn:
            with conn.cursor() as cur:
                cur.execute(q, {"city": city})
                cols = [c.name for c in cur.description]
                return [dict(zip(cols, row)) for row in cur.fetchall()]

    def _num(v: Any) -> Any:
        return round(float(v), 1) if v is not None else None

    totals = rows(
        """
        select count(*) trips, count(distinct user_id) users,
               coalesce(sum(n_pred),0) predicciones,
               avg(exposure_reduction_pct) exp_red_avg
        from sim_effectiveness where city = %(city)s
        """
    )[0]
    by_hour = rows(
        """
        select hour, count(*) trips, avg(exposure_reduction_pct) exp_red_avg
        from sim_effectiveness where city = %(city)s and hour is not null
        group by hour order by hour
        """
    )
    by_vehicle = rows(
        """
        select coalesce(vehicle,'?') vehicle, count(*) trips,
               avg(exposure_reduction_pct) exp_red_avg
        from sim_effectiveness where city = %(city)s
        group by vehicle order by trips desc
        """
    )
    by_day = rows(
        """
        select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as dia,
               count(*) as trips, count(distinct user_id) as users
        from sim_effectiveness where city = %(city)s
        group by 1 order by 1 desc limit 30
        """
    )
    for row in (*by_hour, *by_vehicle):
        row["exp_red_avg"] = _num(row.get("exp_red_avg"))
    totals["exp_red_avg"] = _num(totals.get("exp_red_avg"))
    return {
        "available": True,
        "city": city,
        "totals": totals,
        "by_hour": by_hour,
        "by_vehicle": by_vehicle,
        "by_day": by_day,
    }


def reset(city: str = "tumaco", user_id: Optional[str] = None) -> dict[str, Any]:
    """Borra el histórico. Si `user_id`, solo el de ese usuario; si no, toda la ciudad."""
    if not available():
        return {"ok": False, "available": False}
    _ensure()
    where = "where city = %(city)s"
    params: dict[str, Any] = {"city": city}
    if user_id:
        where += " and user_id = %(uid)s"
        params["uid"] = user_id
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(f"delete from sim_effectiveness {where}", params)
        conn.commit()
    return {"ok": True}
