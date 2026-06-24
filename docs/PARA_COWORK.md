# Insumo para la redacción del Trabajo de Grado (estado, resultados y límites)

> Documento puente: consolida **qué se construyó, qué se midió y qué falta**, para redactar las
> secciones de la tesis (resultados, discusión, conclusiones). Citación IEEE; numeración `[n]` = la
> del anteproyecto. La redacción final del documento la hace el autor con su propia voz; esto es la
> materia técnica de soporte.

## 1. Estado por objetivo específico

| OE | Qué se logró | Dónde verificarlo |
|----|--------------|-------------------|
| OE1 — Predicción de destino | Predicción por analogía (KNN espacial + rumbo) sobre 4.032 trayectorias | `/predict/online`, `/predict/destination` |
| OE2 — Riesgo por zonas | Índice espacio-temporal `riesgo(zona,hora)`; 212 zonas; curva horaria | `/risk/zones?hour=` |
| OE3 — Rutas seguras + alerta | Alerta anticipada (look-ahead a hora de llegada) + ruteo por tipo de vehículo | `/predict/online`, `/route/build` |
| OE4 — Evaluación | Protocolo train/test sin sesgo; métrica FDE | `/trajectories/evaluate` |

## 2. Resultados medibles (para la sección de resultados)

- **División de datos:** 4.032 trayectorias → 3.226 entrenamiento (80%) + 806 prueba **no vistas** (20%).
- **Predicción de destino (sobre el conjunto NO visto):**
  - Acierto a **≤50 m: ~90%** · a **≤100 m: ~96%** · **error mediano ~8 m**.
  - Por tipo: Bus ~91%, Carro ~90% (muestra evaluada: 160 viajes de los 806).
  - Supera la meta del **85%** fijada como indicador de OE1 en el anteproyecto.
- **Riesgo temporal:** mínimo nocturno, máximo en la franja de mayor convergencia (coherente con
  actividades rutinarias [6], [7]).
- **Motor de alerta (sensibilidad):** la cobertura de rutas alertadas y la anticipación dependen del
  **umbral** (dial de sensibilidad/especificidad) y del horizonte de *look-ahead*.

## 3. Límites y supuestos (declararlos en la discusión — dan validez)

1. **Datos simulados (SUMO).** Las trayectorias provienen de simulación; muchos agentes comparten
   rutas, lo que favorece la predicción por analogía. La validación con GPS real queda como trabajo
   futuro.
2. **Método de predicción.** Es **recuperación/analogía (KNN + rumbo)**, no una red recurrente como
   sugería el anteproyecto. Es una técnica de IA basada en instancias, interpretable y competitiva;
   se declara la desviación. (Ya anticipado en el Informe de Avance 2.)
3. **Curva horaria del riesgo = supuesto** informado por la literatura, no microdato local (las
   bases públicas no traen la hora del hecho). Aislada y **calibrable** si se obtiene el dato (DIJIN).
4. **Sentido de las calles.** Las trayectorias reales **sí respetan el sentido** (son movimientos
   SUMO reales). El grafo para **rutas nuevas** es hoy **no direccional** (no impone sentido único);
   incorporarlo desde `tumaco.net.xml` (que sí trae direccionalidad) es trabajo en curso.
5. **Cobertura territorial.** La zonificación de riesgo cubre el área con trayectorias; ampliarla a
   todo el Distrito es pendiente de la línea de modelo.
6. **Rutas nuevas y la métrica de acierto.** Las rutas dibujadas por el usuario **no tienen verdad
   de terreno**, por lo que **no entran en la medición de precisión** (FDE); sirven para la
   demostración cualitativa del comportamiento.

## 4. Métrica de efectividad — explicación

**FDE (Final Displacement Error)** = distancia, en metros, entre **el punto que el sistema predijo**
y **el punto real** del recorrido, medidos al **mismo horizonte** (la misma distancia recorrida).
- "**Acierto ≤50 m: 90%**" → en el 90% de los viajes de prueba, el sistema predijo el punto a **50 m
  o menos** del lugar real.
- "**error mediano 8 m**" → la mitad de los viajes tuvieron un error de **8 m o menos**.
- "**160 no vistas (de 806)**" → se evaluó sobre 160 viajes que **el modelo nunca vio**.
- Es **determinista** (mismo dato → mismo número); no cambia con el uso.

Comparaciones válidas (posibles "vs" para la tesis): **por tipo de vehículo** (bus vs carro vs moto),
**por hora**, o **con/sin** una variable del riesgo. La comparación NO válida es "no vistas vs rutas
nuevas" en precisión, porque las rutas nuevas no tienen recorrido real con qué comparar.

## 5. Procedencia de los datos / atribución

La base de simulación (red vial de Tumaco + generación de trayectorias con SUMO) parte del trabajo
del director PhD. Andrés Oswaldo Calderón Romero [T0]. Citarlo en la tesis y en el repositorio.

## 6. Cómo publicar la investigación (`Research/`, 1.8 GB)

GitHub no admite archivos grandes (gpkg 464 MB, geojsons de 250/79 MB). Recomendado:
- Subir a un repositorio (p. ej. GitHub) **solo el código y los artefactos pequeños** (scripts
  `algos/`, `analysis_v2/`, `.sql`, CSV pequeños, `.npy` de embeddings), con un README que **cite la
  base del director** [T0].
- Los **datos pesados** (gpkg, geojson, parquet grandes): publicarlos como **Hugging Face Dataset**
  (gratis, admite GB) o enlace a almacenamiento (Drive/Zenodo para un DOI citable). Excluir del git
  los `.tsv/.csv` regenerables por los scripts.

## 7. Referencias

Ver listas IEEE completas en [METODOLOGIA.md](METODOLOGIA.md) y [MODELO_RIESGO.md](MODELO_RIESGO.md).
Incluir [T0] (repo base del director) en la bibliografía y en los agradecimientos.
