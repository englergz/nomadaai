"""Configuración central del backend NómadaAI.

Lee variables de entorno (ver app/.env.example). Mantiene las rutas a los
artefactos de `Research/` para no duplicar datos: el backend los reutiliza
directamente como fuente de verdad de OE1.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Raíz del repo appNomadaAI/ en desarrollo (…/app/services/api/app/core/config.py
# -> 5 padres). En el contenedor la estructura es más plana y RESEARCH_DIR se pasa
# por entorno, así que este cálculo es solo un fallback: no debe tronar si faltan padres.
_HERE = Path(__file__).resolve()
REPO_ROOT = _HERE.parents[5] if len(_HERE.parents) > 5 else _HERE.parent
DEFAULT_RESEARCH_DIR = REPO_ROOT / "Research"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Identidad ---
    app_name: str = "NómadaAI API"
    environment: str = "development"

    # --- Artefactos de Research (OE1) ---
    research_dir: Path = DEFAULT_RESEARCH_DIR
    # Parquet de trayectorias verdad en EPSG:3857 (columnas id,x,y,t en metros).
    trajectories_parquet: str = "data/trajectories_xy.parquet"
    # Corredores TRACLUS ya en WGS84.
    corridors_geojson: str = "traclus_segments_wgs84.geojson"
    # Vecinos precomputados (Fréchet).
    neighbors_csv: str = "neighbors_frechet_mot.csv"
    # Riesgo espacio-temporal (OE2): cell_id,lon,lat,hora,riesgo_dyn
    # En el contenedor se embebe en artifacts/risk/. En dev cae a Research/analysis_v2/.
    risk_hourly_csv: str = "risk/tumaco_riesgo_horario.csv"

    # --- Límites para tier gratuito (memoria) ---
    # 0 = sin límite. Cap de trayectorias cargadas en el KDTree.
    max_trajectories: int = 0

    # --- Predicción (espejo de traj_nn.py) ---
    pred_default_topk: int = 5
    pred_max_meters: float = 200.0
    pred_frac_miss: float = 0.25

    # --- CORS (frontend) ---
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # --- Frontend estático (despliegue single-Space en Hugging Face) ---
    # Si apunta a una carpeta con el build de la web, se sirve en "/".
    static_dir: str | None = None

    # --- Base de datos (opcional en esta fase) ---
    database_url: str | None = None

    @property
    def research_path(self) -> Path:
        return Path(self.research_dir)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
