# Metodología, modelos y técnicas (guía para sustentación)

> Trabajo de Grado *NómadaAI* — MGTIC, Universidad de Nariño. Autor: Engler González Prado.
> Documento de apoyo para explicar al asesor y al jurado **qué método, qué modelo y qué técnica**
> se usa en cada componente, y **cómo inyectar datos** al sistema (sin la interfaz gráfica).

## 1. Los datos y sus variables

El insumo es el conjunto maestro de trayectorias de la simulación de Tumaco (SUMO). Cada fila es
la posición de un agente en un instante. Las **variables** son:

| Variable | Significado |
|----------|-------------|
| `id` | identificador del agente/viaje (el prefijo indica el tipo: `mot…`, `car…`, `bus…`) |
| `x` | coordenada X (longitud, en metros EPSG:3857 o grados según la capa) |
| `y` | coordenada Y (latitud) |
| `t` | tiempo (segundos desde el inicio del recorrido) |
| `kind` / tipo | clase del vehículo (moto, carro, bus, camión) |

Es decir, una trayectoria = secuencia ordenada por `t` de puntos `(x, y)` para un `id` de cierto
`tipo`. (Estas son las ~5 variables que recordabas: **id, x, y, t, tipo**.)

## 2. Componente A — Caracterización de la movilidad (OE1)

Responde *¿cómo se mueve la ciudad?* Tres técnicas complementarias:

- **Aprendizaje de representaciones — TrajCL / TSMini.** Un modelo basado en **Transformer**,
  entrenado de forma **auto-supervisada (contrastiva)**, convierte cada trayectoria en un vector
  numérico (*embedding*). Trayectorias parecidas quedan cercanas en el espacio vectorial.
  La cercanía se mide con **similitud coseno** (`cos(u,v)=u·v/‖u‖‖v‖`). *Salida:* `embeddings.npy`.
- **Descubrimiento de corredores — TRACLUS.** Algoritmo *partition-and-group*: parte cada
  trayectoria en segmentos y agrupa los segmentos con **DBSCAN** (clustering por densidad, con
  distancia perpendicular/paralela/angular). *Salida:* `traclus_segments_wgs84.geojson` (los
  corredores que se ven en gris en el mapa).
- **Recuperación de similares — distancia de Fréchet.** Métrica clásica para curvas; dada una
  trayectoria, recupera las más parecidas del conjunto. *Salida:* `neighbors_frechet*.csv`.

## 3. Componente B — Predicción de destino (OE1)

Responde *dado el inicio de un recorrido, ¿hacia dónde se dirige?* Método: **predicción por
recuperación / analogía (k-vecinos espaciales + rumbo)** — interpretable y eficiente:

1. Del prefijo observado se toma el **último punto** y el **rumbo** (ángulo de avance).
2. Se busca con un **KDTree** (vecinos más cercanos espaciales) entre los puntos de inicio de
   segmento de las trayectorias **de entrenamiento**, dentro de radios crecientes (25 m, 60 m,
   120 m), filtrando por **mismo tipo** y por **coherencia de rumbo**.
3. La **continuación** de los mejores vecinos se propone como predicción (top-k).
4. **Control anti-sesgo:** se excluye explícitamente la propia trayectoria (`exclude_id`), y la
   evaluación se hace sobre un **conjunto de prueba NO visto** (división train/test 80/20).

> **Nota honesta (declararla en la defensa):** la predicción operativa es por **analogía/vecino
> más cercano + rumbo**, no por una red recurrente. Es una técnica competitiva e interpretable;
> los embeddings de TrajCL/coseno sustentan la *caracterización* y la recuperación de similares.
> Esto ya se anticipó en el Informe de Avance 2.

## 4. Modelo de riesgo (OE2) y alerta anticipada (OE3)

- **Riesgo espacio-temporal `riesgo(zona, hora)`** sobre una **zonificación** en malla (212 zonas).
  Fundamentación criminológica y fuentes reales: ver [`MODELO_RIESGO.md`](MODELO_RIESGO.md).
- **Alerta anticipada (look-ahead):** sobre la ruta predicha se evalúa el riesgo de cada zona a la
  **hora estimada de llegada** (reloj corriendo) y se avisa **antes** de alcanzar una zona de alto
  riesgo, con su distancia y ETA.
- **Ruteo (modo «ruta nueva»):** grafo navegable construido con **networkx** desde la red real;
  camino más corto origen→destino (Dijkstra por distancia), listo para ponderar por riesgo.

## 5. Evaluación de la efectividad

- **Protocolo:** división **train/test** reproducible (semilla fija). El modelo solo indexa
  *train*; se mide sobre *test* **no visto** (evita el sesgo de "predecir algo ya conocido").
- **Métrica:** **FDE** (*Final Displacement Error*) = distancia entre el punto predicho y el real
  al **mismo horizonte de continuación**; se reporta **acierto ≤50 m y ≤100 m**, global y por tipo.
- **Resultado actual (held-out):** ~**90% de acierto ≤50 m**, error mediano ~8 m.
- Endpoint reproducible: `GET /trajectories/evaluate`.

> **Importante (efectividad NO es "dinámica"):** el número es **determinista** — se calcula sobre
> el conjunto de prueba al pulsar el botón y no cambia con el uso. Puede **diferir entre entornos**
> según cuántas trayectorias se carguen (local con tope vs. el Space con las 4.032 completas), pero
> dentro de un mismo entorno es estable y reproducible. Las **rutas nuevas (dibujadas) NO entran en
> esta métrica** porque no tienen "verdad de terreno" (no existe el recorrido real para comparar);
> sirven para la demostración cualitativa, no para medir acierto.

## 6. Cómo inyectar datos al modelo SIN la interfaz (terminal)

La interfaz gráfica es solo un cliente; **el modelo vive en la API**. Puedes inyectarle datos con
`curl` o Python y obtener la predicción + la alerta. La entrada es la **secuencia de ubicaciones
capturadas hasta "ahora"** (lon, lat, t). El modelo NO recibe el destino.

**Predicción online (la que usa la simulación):**
```bash
BASE="https://englergz-nomadaai.hf.space"   # o http://localhost:8000 en local
curl -s -X POST "$BASE/predict/online" -H 'content-type: application/json' -d '{
  "points": [
    {"lon": -78.7855, "lat": 1.7840, "t": 0},
    {"lon": -78.7854, "lat": 1.7841, "t": 1},
    {"lon": -78.7852, "lat": 1.7843, "t": 2},
    {"lon": -78.7850, "lat": 1.7846, "t": 3}
  ],
  "type": "car",          // tipo de vehículo (opcional)
  "t_seconds": 70200,     // reloj: segundos desde medianoche (70200 = 19:30)
  "speed_mps": 8.3,       // velocidad (para la hora de llegada)
  "threshold": 0.7        // umbral de alerta (0..1)
}'
```
Respuesta: `candidates` (ruta probable) + `alert` (zona de riesgo, distancia, hora de llegada).

**Otros endpoints útiles desde terminal:**
```bash
curl -s "$BASE/health"                         # conteos train/test
curl -s "$BASE/trajectories/sample?n=5"        # viajes de prueba (no vistos)
curl -s "$BASE/trajectories/evaluate"          # efectividad sobre test
curl -s "$BASE/risk/zones?hour=20"             # zonas de riesgo a las 20:00
curl -s -X POST "$BASE/route/build" -H 'content-type: application/json' \
     -d '{"origin":[-78.815,1.793],"dest":[-78.76,1.815]}'   # ruta nueva
```

La documentación interactiva completa (probar cada endpoint en el navegador) está en `"$BASE/docs"`.
