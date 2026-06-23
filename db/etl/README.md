# ETL — cargar capas de servicio a PostGIS

Espeja a la base de datos (Supabase o PostGIS local) las capas derivadas que el
backend sirve. En esta fase solo se incluye la carga de corredores; el resto se
agrega al avanzar OE2/OE3.

## Orden

1. Aplicar el esquema:
   ```bash
   psql "$DATABASE_URL" -f db/migrations/001_init_postgis.sql
   ```
2. Cargar corredores TRACLUS:
   ```bash
   pip install "psycopg[binary]"
   DATABASE_URL="postgresql://user:pass@host:5432/db" python db/etl/load_corridors.py
   ```

## Pendiente (OE2/OE3)
- `load_trajectories_sample.py` — muestra de `trajectories_wgs84.csv`.
- `build_road_graph.py` — grafo vial desde `tumaco.osm` → `road_nodes`/`road_edges`.
- `ingest_incidents.py` — incidentes desde datos.gov.co → `incidents` → agregación H3 → `risk_zones`.
