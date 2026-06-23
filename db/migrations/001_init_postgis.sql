-- ============================================================
-- NómadaAI — Esquema PostGIS inicial (capas de servicio de la app)
-- Proyecto: Tesis MGTIC - Engler González Prado (Universidad de Nariño)
-- Reutiliza patrones de Research/scripts/import_pred.sql (geom + GIST + vistas).
--
-- NOTA: solo capas DERIVADAS (no los 1.5M de puntos crudos), para caber en el
-- tier gratuito de Supabase (500 MB). Los artefactos pesados viven en el backend.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- 1) Corredores TRACLUS (OE1) — desde traclus_segments_wgs84.geojson
DROP TABLE IF EXISTS corridors CASCADE;
CREATE TABLE corridors (
  gid       BIGSERIAL PRIMARY KEY,
  traj_id   TEXT,
  cluster   INTEGER,
  len_m     DOUBLE PRECISION,
  ang       DOUBLE PRECISION,
  geom      geometry(LineString, 4326)
);
CREATE INDEX corridors_geom_idx ON corridors USING GIST (geom);
CREATE INDEX corridors_cluster_idx ON corridors (cluster);

-- 2) Muestra de trayectorias (OE1) — desde trajectories_wgs84.csv (muestreada)
DROP TABLE IF EXISTS trajectories_sample CASCADE;
CREATE TABLE trajectories_sample (
  id     TEXT,
  type   TEXT,
  t      DOUBLE PRECISION,
  geom   geometry(Point, 4326)
);
CREATE INDEX trajectories_sample_geom_idx ON trajectories_sample USING GIST (geom);
CREATE INDEX trajectories_sample_id_idx ON trajectories_sample (id);

-- 3) Grafo vial (OE3) — derivado de tumaco.osm / tumaco.net.xml
DROP TABLE IF EXISTS road_nodes CASCADE;
CREATE TABLE road_nodes (
  node_id BIGINT PRIMARY KEY,
  geom    geometry(Point, 4326)
);
CREATE INDEX road_nodes_geom_idx ON road_nodes USING GIST (geom);

DROP TABLE IF EXISTS road_edges CASCADE;
CREATE TABLE road_edges (
  edge_id  BIGSERIAL PRIMARY KEY,
  source   BIGINT REFERENCES road_nodes(node_id),
  target   BIGINT REFERENCES road_nodes(node_id),
  length_m DOUBLE PRECISION,
  risk     DOUBLE PRECISION DEFAULT 0,  -- se rellena con OE2
  geom     geometry(LineString, 4326)
);
CREATE INDEX road_edges_geom_idx ON road_edges USING GIST (geom);
CREATE INDEX road_edges_source_idx ON road_edges (source);
CREATE INDEX road_edges_target_idx ON road_edges (target);

-- 4) Zonas de riesgo (OE2) — hexágonos H3, vacío hasta ingerir datos abiertos
DROP TABLE IF EXISTS risk_zones CASCADE;
CREATE TABLE risk_zones (
  h3_index   TEXT PRIMARY KEY,
  risk_score DOUBLE PRECISION DEFAULT 0,
  n_incidents INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  geom       geometry(Polygon, 4326)
);
CREATE INDEX risk_zones_geom_idx ON risk_zones USING GIST (geom);

-- 5) Incidentes (OE2 + reportes ciudadanos "tiempo real")
DROP TABLE IF EXISTS incidents CASCADE;
CREATE TABLE incidents (
  id          BIGSERIAL PRIMARY KEY,
  source      TEXT,        -- 'datos.gov.co' | 'policia' | 'ciudadano'
  category    TEXT,
  description TEXT,
  occurred_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  geom        geometry(Point, 4326)
);
CREATE INDEX incidents_geom_idx ON incidents USING GIST (geom);
CREATE INDEX incidents_occurred_idx ON incidents (occurred_at);
