"""NómadaAI API — punto de entrada FastAPI.

Carga los artefactos de OE1 (predictor de destino + corredores) una sola vez en el
arranque (lifespan) y expone el contrato REST documentado en docs/ARCHITECTURE.md.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import state
from app.core.config import get_settings
from app.data.corridors import CorridorStore
from app.data.risk import RiskStore
from app.ml.destination import DestinationPredictor
from app.routers import corridors, evaluation, health, predict, risk, route, trajectories

logger = logging.getLogger("nomadaai")
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    parquet = s.research_path / s.trajectories_parquet
    geojson = s.research_path / s.corridors_geojson
    if not geojson.exists() and geojson.with_suffix(".geojson.gz").exists():
        geojson = geojson.with_suffix(".geojson.gz")

    if parquet.exists():
        logger.info("Cargando predictor desde %s ...", parquet)
        state.predictor = DestinationPredictor(
            parquet_path=parquet,
            max_trajectories=s.max_trajectories,
            default_topk=s.pred_default_topk,
            max_meters=s.pred_max_meters,
            frac_miss=s.pred_frac_miss,
        )
        logger.info(
            "Predictor listo: %d trayectorias, %d segmentos",
            state.predictor.n_trajectories,
            state.predictor.n_segments,
        )
    else:
        logger.warning("No existe %s — predictor deshabilitado", parquet)

    if geojson.exists():
        state.corridors = CorridorStore(geojson)
        logger.info("Corredores listos: %d", state.corridors.n_features)
    else:
        logger.warning("No existe %s — corredores deshabilitados", geojson)

    # Riesgo espacio-temporal (OE2): artefacto embebido o, en dev, Research/analysis_v2/
    risk_csv = s.research_path / s.risk_hourly_csv
    if not risk_csv.exists():
        risk_csv = s.research_path / "analysis_v2" / "tumaco_riesgo_horario.csv"
    if risk_csv.exists():
        state.risk = RiskStore(risk_csv)
        logger.info("Riesgo listo: %d zonas × 24h", state.risk.n_zones)
    else:
        logger.warning("No existe %s — capa de riesgo deshabilitada", risk_csv)

    # Grafo de rutas (OE3) — construido al inicio para que /route/build sea inmediato.
    if state.predictor is not None:
        try:
            from app.ml.router import RouteGraph
            state.route_graph = RouteGraph(state.predictor.true_dict)
            logger.info(
                "Grafo de rutas listo: %d nodos, %d aristas",
                state.route_graph.n_nodes, state.route_graph.n_edges,
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("No se pudo construir el grafo de rutas: %s", e)

    yield
    state.predictor = None
    state.corridors = None
    state.risk = None
    state.route_graph = None


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title=s.app_name, version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(predict.router)
    app.include_router(corridors.router)
    app.include_router(trajectories.router)
    app.include_router(risk.router)
    app.include_router(route.router)
    app.include_router(evaluation.router)

    # Frontend estático (despliegue single-Space): se monta al final para no
    # tapar las rutas de la API. html=True sirve index.html en "/".
    if s.static_dir and Path(s.static_dir).is_dir():
        app.mount("/", StaticFiles(directory=s.static_dir, html=True), name="web")

    return app


app = create_app()
