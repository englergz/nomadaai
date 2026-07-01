-- Histórico de efectividad por usuario (OE1/OE3/OE4 · BI)
-- Un registro por viaje simulado, atado a user_id, con dos comparaciones:
--   Predicción: modelo (KNN+rumbo) vs línea recta (baseline)
--   Protección: ruta segura vs ruta directa (reducción de exposición al riesgo)
-- Replicable a otra ciudad vía la columna `city`.
-- La API la crea sola (CREATE TABLE IF NOT EXISTS); este archivo es la referencia versionada.

create table if not exists sim_effectiveness (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  city          text not null default 'tumaco',
  user_id       text not null default 'anon',
  session_id    text,
  mode          text,          -- 'test' (no visto) | 'draw' (ruta nueva)
  vehicle       text,
  hour          int,
  -- Predicción
  n_pred        int     not null default 0,
  model_err_sum double precision not null default 0,
  base_err_sum  double precision not null default 0,
  model_hit50   int     not null default 0,
  base_hit50    int     not null default 0,
  alerts        int     not null default 0,   -- alertas de riesgo recibidas a tiempo
  -- Protección (solo modo 'draw')
  exposure_reduction_pct double precision,
  safe_exposure  double precision,
  direct_exposure double precision,
  safe_dist_m    double precision,
  direct_dist_m  double precision
);

create index if not exists sim_eff_city_user_idx on sim_effectiveness (city, user_id);
create index if not exists sim_eff_created_idx    on sim_effectiveness (created_at);
