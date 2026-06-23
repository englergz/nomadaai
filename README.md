---
title: NomadaAI
emoji: 🗺️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# NómadaAI

Aplicación inteligente para la **gestión segura de rutas urbanas** mediante análisis de
datos en el Distrito de Tumaco, Nariño. Tesis MGTIC · Universidad de Nariño.

Este árbol `app/` es la **aplicación** (backend + frontend) construida sobre la
investigación de `../Research/`. Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Estructura

```
app/
  packages/shared/   tipos + cliente API (web y futuro móvil)
  apps/web/          React + Vite + MapLibre GL
  services/api/      FastAPI — expone OE1, stubs OE2/OE3
  db/                migraciones PostGIS + ETL
  docs/              arquitectura
```

## Arranque rápido (dev)

**1. Backend** (reutiliza artefactos de `../Research`):
```bash
cd services/api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt        # Python 3.11+ recomendado
export MAX_TRAJECTORIES=800             # opcional: menos RAM
uvicorn app.main:app --reload --port 8000
```

**2. Frontend:**
```bash
npm install                            # desde app/ (workspaces)
cp apps/web/.env.example apps/web/.env # VITE_API_URL=http://localhost:8000
npm run dev:web                        # http://localhost:5173
```

## Estado
- ✅ **OE1** predicción de destino + corredores — operativo y verificado.
- ⏳ **OE2** riesgo por zonas — tablas y endpoints listos, faltan datos.
- 🟡 **OE3** rutas seguras — ruteo stub (línea recta) listo para networkx + riesgo.
