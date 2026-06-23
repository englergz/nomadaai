from __future__ import annotations

from fastapi import APIRouter

from app import state
from app.core.config import get_settings

router = APIRouter(tags=["meta"])


@router.get("/health")
def health() -> dict:
    s = get_settings()
    return {
        "status": "ok",
        "environment": s.environment,
        "predictor_ready": state.predictor is not None,
        "n_trajectories": getattr(state.predictor, "n_trajectories", 0),
        "n_train": getattr(state.predictor, "n_train", 0),
        "n_test": getattr(state.predictor, "n_test", 0),
        "n_segments": getattr(state.predictor, "n_segments", 0),
        "corridors_ready": state.corridors is not None,
        "n_corridors": getattr(state.corridors, "n_features", 0),
    }
