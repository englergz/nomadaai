# NómadaAI — Arquitectura del software

> Aplicación inteligente para la gestión segura de rutas urbanas mediante análisis de
> datos en tiempo real en el Distrito de San Andrés de Tumaco, Nariño.
> Tesis MGTIC · Universidad de Nariño · Engler González Prado.

Este documento describe los cimientos técnicos de la aplicación que materializa la
investigación de `Research/`. Define el stack, la arquitectura, el contrato de API y el
modelo de datos. La fundamentación de métodos y del riesgo está en
[METODOLOGIA.md](METODOLOGIA.md) y [MODELO_RIESGO.md](MODELO_RIESGO.md) (citación IEEE).

## 1. Objetivos y estado (4 objetivos específicos)

| Obj. | Descripción | Estado | Dónde vive |
|------|-------------|--------|-----------|
| OE1 | Caracterizar la movilidad y **predecir el destino** | ✅ Operativo y medido | `Research/` (datos+modelo) · `services/api` |
| OE2 | Modelo de **riesgo delictivo por zonas** (espacio-temporal) | ✅ Operativo | `services/api` (`/risk/zones`) · `Research/analysis_v2` |
| OE3 | **Rutas seguras** + **alerta anticipada** | ✅ Operativo | `services/api` (`/predict/online`, `/route/build`) · `apps/web` |
| OE4 | **Evaluar la efectividad** (train/test, escenarios) | ✅ Operativo | `services/api` (`/trajectories/evaluate`) |

## 2. Decisiones de arquitectura (ADR resumido)

1. **No reescribir OE1.** El backend reutiliza directamente los artefactos de `Research/`
   (`trajectories_xy.parquet`, `traclus_segments_wgs84.geojson`, embeddings). La predicción
   de destino es un **puerto fiel** de `Research/scripts/traj_nn.py` (KDTree + rumbo),
   verificado contra los resultados originales.
2. **Predicción ligera, sin GPU.** El método es por recuperación/analogía (numpy + sklearn),
   no requiere PyTorch en runtime → cabe en planes gratuitos (512 MB).
3. **Nube gratis.** Supabase (Postgres + PostGIS) + backend en Render/Fly free + frontend en
   Vercel/Netlify. Sin costos para una investigación académica.
4. **Sin pgRouting.** Supabase no permite esa extensión. El ruteo seguro (OE3) se calcula en
   el backend con `networkx` sobre el grafo vial de Tumaco (`tumaco.osm`/`tumaco.net.xml`).
5. **Monorepo web-first, móvil-ready.** El paquete `packages/shared` (tipos + cliente API)
   permite añadir una app móvil (Expo) reutilizando el contrato sin reescribir.
6. **Honestidad sobre "tiempo real".** No existen feeds abiertos de criminalidad en vivo para
   Tumaco. "Tiempo real" se modela con (a) riesgo por franja horaria, (b) reportes ciudadanos
   (`/incidents/report`), y (c) refresco periódico de datos abiertos.

## 3. Vista de componentes (C4 nivel 2)

```
┌──────────────────────────────────────────────────────────────────┐
│  Usuario (web / futuro móvil)                                      │
│   apps/web  — React + Vite + MapLibre GL (OSM tiles, sin API key)  │
└───────────────┬───────────────────────────────────────────────────┘
                │  HTTPS (JSON / GeoJSON)   ── @nomadaai/shared (tipos+cliente)
                ▼
┌──────────────────────────────────────────────────────────────────┐
│  services/api — FastAPI (Python 3.11)                              │
│   • ml/destination.py  predicción de destino (OE1)  [REAL]         │
│   • data/corridors.py  corredores TRACLUS           [REAL]         │
│   • ml/routing.py      ruta segura (OE3)            [STUB→networkx] │
│   • routers/risk.py    zonas de riesgo (OE2)        [STUB]         │
└───────┬───────────────────────────────────┬───────────────────────┘
        │ lee artefactos                     │ (futuro) SQL
        ▼                                     ▼
┌─────────────────────────┐      ┌──────────────────────────────────┐
│ Research/ (fuente verdad)│      │ Supabase Postgres + PostGIS       │
│  parquet, geojson, npy   │      │  corridors, risk_zones, incidents,│
│  (no se modifica)        │      │  road_edges/nodes (capas servicio)│
└─────────────────────────┘      └──────────────────────────────────┘
```

## 4. Contrato de API

Base: `http://localhost:8000` (dev). Docs OpenAPI en `/docs`.

| Método | Ruta | Estado | Entrada → Salida |
|--------|------|--------|------------------|
| GET | `/health` | real | → estado + conteos |
| POST | `/predict/destination` | **real** | `{points[],type?,topk?}` → `{candidates[]}` |
| GET | `/corridors?bbox=&limit=` | **real** | → FeatureCollection (LineString) |
| GET | `/trajectories/similar?id=` | real | → vecinos Fréchet |
| GET | `/risk/zones?bbox=` | stub | → FeatureCollection (vacío) |
| POST | `/route/safe` | stub | `{origin,dest,risk_weight}` → ruta |
| POST | `/incidents/report` | stub | `{lon,lat,category,description?}` → ack |

El contrato es la única fuente de verdad y está duplicado en dos lugares que deben
mantenerse en sincronía: `services/api/app/models/schemas.py` (Pydantic) y
`packages/shared/src/types.ts` (TypeScript).

## 5. Modelo de datos (PostGIS)

Ver `db/migrations/001_init_postgis.sql`. Solo **capas derivadas** (no los 1.5 M de puntos
crudos, que no caben en el tier free de 500 MB):

- `corridors` — segmentos TRACLUS (OE1).
- `trajectories_sample` — muestra de trayectorias para visualización (OE1).
- `road_nodes` / `road_edges` — grafo vial con columna `risk` (OE3).
- `risk_zones` — hexágonos H3 con `risk_score` (OE2).
- `incidents` — incidentes de datos abiertos + reportes ciudadanos (OE2 / tiempo real).

## 6. Roadmap

### OE2 — Riesgo delictivo por zonas
1. **Ingesta** desde [datos.gov.co](https://www.datos.gov.co) (Policía Nacional / SIEDCO),
   filtrando municipio **Tumaco (DANE 52835)**; complementar con marco geoestadístico DANE.
2. **Geo-referenciación y agregación** a hexágonos **H3** (res ~9) o barrios →
   `risk_score = f(incidentes/área, decaimiento temporal, franja horaria)`.
3. Poblar `incidents` y `risk_zones`; activar `/risk/zones`.
   - **Limitación declarada:** buena parte de los datos abiertos están a nivel municipio, no
     a nivel punto. Se documentará la resolución real obtenida.

### OE3 — Rutas seguras + alertas
1. `build_road_graph.py`: grafo `networkx` desde `tumaco.osm` (cacheado en pickle/Storage).
2. Activar peso de riesgo: `weight = length · (1 + λ·risk(edge))`, con `λ = risk_weight`.
3. Alertas in-app/push al entrar en zonas de riesgo.
4. App móvil **Expo** desde `packages/shared`.

## 7. Despliegue (gratis)

| Componente | Servicio | Notas |
|-----------|----------|-------|
| DB | Supabase (free) | PostGIS incluido; 500 MB DB + 1 GB Storage |
| API | Render / Fly.io (free) | `uvicorn app.main:app`; subir artefactos OE1 o leerlos de Storage |
| Web | Vercel / Netlify (free) | `npm run build:web`; `VITE_API_URL` apuntando a la API |

## 8. Potencial de producto

La navegación consciente del riesgo ("safe routing") tiene mercado: seguros, logística de
última milla, turismo y seguridad ciudadana en ciudades con alta percepción de inseguridad.
El diferencial frente a Google/Waze es la **capa de riesgo georreferenciada local** combinada
con la **predicción de destino**. Tumaco es un caso de validación fuerte.
