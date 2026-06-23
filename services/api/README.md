# NómadaAI — API (FastAPI)

Backend que expone OE1 (predicción de destino + corredores) y deja stubs tipados
para OE2 (riesgo) y OE3 (rutas seguras).

## Correr en local

```bash
cd app/services/api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# Por defecto usa ../../../Research como RESEARCH_DIR. Para tier gratuito (poca RAM)
# puedes limitar trayectorias:  export MAX_TRAJECTORIES=800
uvicorn app.main:app --reload --port 8000
```

Docs interactivas: http://localhost:8000/docs

## Endpoints

| Método | Ruta | Estado | Descripción |
|--------|------|--------|-------------|
| GET | `/health` | real | Estado y conteos de artefactos cargados |
| POST | `/predict/destination` | **real** | Predicción de continuación (OE1) |
| GET | `/corridors?bbox=` | **real** | Corredores TRACLUS (GeoJSON) |
| GET | `/trajectories/similar?id=` | real | Vecinos Fréchet (cobertura parcial) |
| GET | `/risk/zones?bbox=` | stub | Zonas de riesgo (OE2) |
| POST | `/route/safe` | stub | Ruta segura (OE3) |
| POST | `/incidents/report` | stub | Reporte ciudadano |

## Ejemplo de predicción

```bash
curl -s -X POST http://localhost:8000/predict/destination \
  -H 'content-type: application/json' \
  -d '{"points":[{"lon":-78.7855,"lat":1.7840,"t":0},
                 {"lon":-78.7854,"lat":1.7840,"t":1},
                 {"lon":-78.7853,"lat":1.7839,"t":2}],"type":"bus","topk":3}'
```
