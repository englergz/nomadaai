---
title: NómadaAI
emoji: 🗺️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# NómadaAI

**Aplicación inteligente para la gestión segura de rutas urbanas mediante análisis de datos en
tiempo real en el Distrito de Tumaco, Nariño.** 

Trabajo de Grado, **Maestría en Gestión de Tecnologías de la Información y del Conocimiento (MGTIC)**, Facultad de Ingeniería, Universidad de Nariño. 

**Autores**: 
- Engler González. 
- PhD. Andrés Calderón. (**Director**) *Research — Scripts/SUMO* (software/repositorio base de simulación de movilidad). GitHub. [En línea]. Disponible: https://github.com/aocalderon/Research/tree/master/Scripts/SUMO

**Ejemplo de uso** / *ver [docs/DEPLOY.md](docs/DEPLOY.md) | Despliegue*
```bash
BASE="https://englergz-nomadaai.hf.space"
curl -s -X POST "$BASE/predict/online" -H 'content-type: application/json' -d '{
  "points":[{"lon":-78.7855,"lat":1.7840,"t":0},{"lon":-78.7854,"lat":1.7841,"t":1},
            {"lon":-78.7852,"lat":1.7843,"t":2},{"lon":-78.7850,"lat":1.7846,"t":3}],
  "type":"car","t_seconds":70200,"speed_mps":8.3,"threshold":0.7
}'
```
Este árbol `app/` es la **aplicación** (backend + frontend) construida sobre la investigación de
`../Research/`. Demo en vivo: **https://englergz-nomadaai.hf.space**

> **Atribución.** La base de simulación de movilidad (red vial de Tumaco y generación de
> trayectorias con SUMO) parte del trabajo del director, PhD. Andrés Oswaldo Calderón Romero:
> https://github.com/aocalderon/Research/tree/master/Scripts/SUMO

## Objetivos específicos

- **OE1** — Caracterizar el desplazamiento y **predecir el destino** (modelo de IA).
- **OE2** — **Modelo de riesgo delictivo por zonas** (espacio-temporal, multivariable).
- **OE3** — **Recomendación de rutas seguras** y **alerta anticipada** (integra OE1+OE2).
- **OE4** — **Evaluar la efectividad** mediante simulaciones (train/test, ajuste de parámetros).

## Documentación

| Documento | Contenido |
|-----------|-----------|
| [docs/PARA_COWORK.md](docs/PARA_COWORK.md) | **Insumo para la tesis**: estado, resultados medibles, límites/supuestos, atribución |
| [docs/METODOLOGIA.md](docs/METODOLOGIA.md) | Método, modelos y técnicas por OE, coherente con el anteproyecto; inyección por terminal |
| [docs/MODELO_RIESGO.md](docs/MODELO_RIESGO.md) | Fundamentación y **variables** del riesgo (OE2), socioeconómicas + criminología ambiental |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitectura, stack, contrato de API, modelo de datos |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Despliegue (Hugging Face Space + Supabase) |

> **Citación: IEEE** en toda la documentación; la numeración `[n]` coincide con el anteproyecto.

## Estructura

```
app/
  packages/shared/   tipos + cliente API (web y futuro móvil)
  apps/web/          React + Vite + MapLibre GL
  services/api/      FastAPI — OE1 (predicción), OE2 (riesgo), OE3 (ruteo/alerta), OE4 (/evaluate)
  db/                migraciones PostGIS + ETL
  docs/              metodología, modelo de riesgo, arquitectura, despliegue
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
- ✅ **OE1** predicción de destino — operativo; **acierto ≈90% a ≤50 m** sobre conjunto no visto.
- ✅ **OE2** riesgo espacio-temporal por zonas — operativo (`/risk/zones?hour=`); enriquecimiento socioeconómico documentado.
- ✅ **OE3** alerta anticipada + ruteo (networkx) — operativo (`/predict/online`, `/route/build`).
- ✅ **OE4** evaluación sin sesgo (train/test) — `/trajectories/evaluate`.
