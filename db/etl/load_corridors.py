"""ETL: carga corredores TRACLUS (WGS84) a PostGIS.

Lee Research/traclus_segments_wgs84.geojson e inserta en la tabla `corridors`
(ver db/migrations/001_init_postgis.sql). Espeja a la nube lo que el backend hoy
sirve desde archivo, para el despliegue con Supabase.

Uso:
  DATABASE_URL=postgresql://user:pass@host:5432/db \
  python db/etl/load_corridors.py [ruta_geojson]

Requiere: psycopg[binary]  (pip install "psycopg[binary]")
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_GEOJSON = REPO_ROOT / "Research" / "traclus_segments_wgs84.geojson"


def main() -> None:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        sys.exit("Define DATABASE_URL (postgresql://...)")
    geojson_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_GEOJSON
    if not geojson_path.exists():
        sys.exit(f"No existe {geojson_path}")

    import psycopg  # import diferido para no exigirlo si no se usa el ETL

    with open(geojson_path) as f:
        fc = json.load(f)

    rows = []
    for feat in fc.get("features", []):
        g = feat.get("geometry", {})
        if g.get("type") != "LineString":
            continue
        p = feat.get("properties", {})
        rows.append(
            (
                p.get("id"),
                p.get("cluster"),
                p.get("len"),
                p.get("ang"),
                json.dumps(g),
            )
        )

    print(f"Insertando {len(rows)} corredores en PostGIS ...")
    with psycopg.connect(db_url) as conn, conn.cursor() as cur:
        cur.execute("TRUNCATE corridors;")
        cur.executemany(
            """
            INSERT INTO corridors (traj_id, cluster, len_m, ang, geom)
            VALUES (%s, %s, %s, %s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
            """,
            rows,
        )
        conn.commit()
    print("✅ Corredores cargados.")


if __name__ == "__main__":
    main()
