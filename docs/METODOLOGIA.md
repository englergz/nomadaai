# Metodología, modelos y técnicas (coherente con el anteproyecto)

> Trabajo de Grado *NómadaAI: aplicación inteligente para la gestión segura de rutas urbanas
> mediante análisis de datos en tiempo real en el Distrito de Tumaco, Nariño*. MGTIC, Facultad de
> Ingeniería, Universidad de Nariño. Autor: Engler González Prado. Director: PhD. Andrés Oswaldo
> Calderón Romero. **Citación: IEEE.** La numeración de referencias `[n]` coincide con la del
> anteproyecto aprobado para facilitar el mapeo en el documento final.

Este documento describe **qué método, modelo y técnica** se emplea en cada componente, de forma
coherente con el paradigma, los objetivos, la metodología y los resultados esperados del
anteproyecto, y precisa qué está implementado en el repositorio/aplicación.

## 1. Paradigma y enfoque (según el anteproyecto)

La investigación se desarrolla bajo el **paradigma positivista**, con **enfoque cuantitativo** y
**método empírico-analítico**, de carácter **descriptivo y correlacional**: por un lado caracteriza
la movilidad urbana y los patrones delictivos, y por otro analiza su relación para optimizar la
toma de decisiones en seguridad [1], [52]. El trabajo se organiza en **cuatro fases**, una por cada
objetivo específico.

## 2. Datos y variables

El insumo es el conjunto maestro de trayectorias de la simulación de Tumaco (SUMO). Cada registro
es la posición de un agente en un instante; sus **variables** son:

| Variable | Significado |
|----------|-------------|
| `id` | identificador del viaje/agente (el prefijo indica el tipo: `mot…`, `car…`, `bus…`) |
| `x` | coordenada X (longitud) |
| `y` | coordenada Y (latitud) |
| `t` | tiempo (segundos desde el inicio del recorrido) |
| `kind`/tipo | clase del vehículo (moto, carro, bus, camión) |

Una **trayectoria** = secuencia ordenada por `t` de puntos `(x, y)` de un `id` de cierto `tipo`.

## 3. Fase 1 — OE1: Caracterización y predicción de destino

> *Caracterizar datos de desplazamiento … para desarrollar un modelo de IA que prediga su destino.*

**Caracterización de la movilidad.** Tres técnicas complementarias:
- **Aprendizaje de representaciones** mediante un modelo **Transformer auto-supervisado
  (contrastivo)** que codifica cada trayectoria en un *embedding*; trayectorias similares quedan
  cercanas y su cercanía se mide por **similitud coseno** [33], [36]. (Implementación: TrajCL/TSMini
  [T1], [T2]; salida `embeddings.npy`.)
- **Descubrimiento de corredores** con **TRACLUS** (*partition-and-group*): segmenta cada
  trayectoria y agrupa los segmentos con **DBSCAN** (clustering por densidad) [T3], [T4]. La
  agrupación espacial de eventos para descubrir estructuras es coherente con la minería de datos
  espacio-temporal [52] y con técnicas de agrupamiento aplicadas en el contexto nariñense [50].
- **Recuperación de trayectorias similares** mediante **distancia de Fréchet** [T5].

**Predicción de destino.** Método por **recuperación/analogía**: a partir del último punto observado
y el **rumbo**, se buscan con un **KDTree** (k-vecinos más cercanos) las trayectorias de
*entrenamiento* que pasan por la misma zona en el mismo sentido, y su continuación se propone como
predicción [31], [38]. Es interpretable y competitivo.

> **Coherencia con el anteproyecto (declaración honesta):** el anteproyecto previó redes neuronales
> recurrentes (RNN) para OE1; la implementación operativa es por analogía (KNN + rumbo). Es una
> técnica de aprendizaje supervisado basado en instancias, defendible y reproducible; se documenta
> la desviación y queda abierta la incorporación de un modelo neuronal supervisado para comparación.

## 4. Fase 2 — OE2: Modelo de riesgo delictivo por zonas

> *Implementar un modelo predictivo de riesgos delictivos … técnicas de aprendizaje automático y
> análisis de datos históricos.*

Índice de **riesgo espacio-temporal `riesgo(zona, hora)`** sobre una **zonificación** en malla,
fundamentado en la criminología ambiental y en variables socioeconómicas. Fundamentación, factores,
fuentes y referencias completas en [`MODELO_RIESGO.md`](MODELO_RIESGO.md): teoría de actividades
rutinarias y prevención situacional [6], [7]; desorganización social y eficacia colectiva
[2], [22], [23]; factores sociodemográficos del delito en Colombia [21]; hot spots [13]; minería
espacio-temporal [52].

## 5. Fase 3 — OE3: Recomendación de rutas seguras y alerta

> *Diseñar un sistema de recomendaciones … integrando ambos modelos … ubicación, horarios de mayor
> riesgo y características del entorno.*

- **Alerta anticipada (look-ahead):** sobre la ruta predicha (OE1) se evalúa el riesgo (OE2) de cada
  zona a la **hora estimada de llegada** (reloj de simulación corriendo) y se avisa **antes** de
  alcanzar una zona de alto riesgo, con su distancia y ETA. Un **umbral configurable** controla
  sensibilidad/especificidad del aviso.
- **Ruteo:** grafo navegable construido con **networkx** sobre la red vial real; camino más corto
  (Dijkstra) origen→destino, preparado para ponderar por riesgo.
- **Panel de visualización** con al menos tres capas (zonas de riesgo, recorrido y ruta predicha),
  según el indicador del anteproyecto.

## 6. Fase 4 — OE4: Evaluación de la efectividad

> *Evaluar la efectividad mediante simulaciones … ajustando parámetros para mejorar su precisión.*

- **Protocolo sin sesgo:** división **train/test** reproducible (semilla fija). El modelo solo
  indexa *train*; la evaluación se realiza sobre el conjunto **test no visto** (evita medir sobre
  trayectorias ya conocidas). Adicionalmente se admiten **rutas nuevas** generadas por el grafo vial
  (combinaciones origen→destino inéditas) para análisis cualitativo.
- **Métrica de predicción:** **FDE** (*Final Displacement Error*) = distancia entre el punto
  predicho y el real al mismo horizonte de continuación; se reporta **acierto ≤50 m y ≤100 m**,
  global y por tipo. Endpoint reproducible `GET /trajectories/evaluate`.
- **Resultado actual (held-out):** **acierto ≈90% a ≤50 m**, error mediano ≈8 m, superando la meta
  del **85%** fijada como indicador de OE1 en el anteproyecto.
- **Caracterización del motor de alerta (OE3/OE4):** análisis de sensibilidad sobre múltiples
  escenarios (hora × umbral × horizonte), reportando cobertura de rutas, anticipación (m/s) y la
  respuesta del riesgo a la hora del día.

## 7. Inyección de datos al modelo desde terminal (sin la interfaz)

La interfaz gráfica es solo un cliente; el modelo reside en la API. Se le inyecta la **secuencia de
ubicaciones** capturadas hasta "ahora" (no el destino):

```bash
BASE="https://englergz-nomadaai.hf.space"   # o http://localhost:8000
curl -s -X POST "$BASE/predict/online" -H 'content-type: application/json' -d '{
  "points":[{"lon":-78.7855,"lat":1.7840,"t":0},{"lon":-78.7854,"lat":1.7841,"t":1},
            {"lon":-78.7852,"lat":1.7843,"t":2},{"lon":-78.7850,"lat":1.7846,"t":3}],
  "type":"car","t_seconds":70200,"speed_mps":8.3,"threshold":0.7
}'
```
Respuesta: `candidates` (ruta probable) + `alert` (zona, distancia, hora de llegada). Documentación
interactiva en `"$BASE/docs"`.

## Referencias (IEEE; numeración del anteproyecto)

- [1] A. Ristea y M. Leitner, "Urban Crime Mapping and Analysis Using GIS," *ISPRS Int. J. Geoinf.*, vol. 9, p. 511, ago. 2020, doi: 10.3390/ijgi9090511.
- [2] C. R. Shaw y H. D. McKay, *Juvenile Delinquency and Urban Areas*. 1942.
- [6] L. Zhang, S. F. Messner y J. Liu, "A Multilevel Analysis of the Risk of Household Burglary in the City of Tianjin, China," *Br. J. Criminol.*, vol. 47, no. 6, pp. 918–937, jul. 2007, doi: 10.1093/bjc/azm026.
- [7] Z. Mao, J. Wu, Z. Zheng, R. Sang y C. Jin, "An empirical study of social disorganization theory in China," *Int. J. Law Crime Justice*, vol. 74, p. 100608, sep. 2023, doi: 10.1016/J.IJLCJ.2023.100608.
- [13] A. A. Braga, A. V. Papachristos y D. M. Hureau, "The Effects of Hot Spots Policing on Crime: An Updated Systematic Review and Meta-Analysis," *Justice Q.*, vol. 31, no. 4, pp. 633–673, jul. 2014, doi: 10.1080/07418825.2012.673632.
- [21] L. C. Núñez Rivera, F. Tolentino Pulido y H. Rodríguez Barrios, "Factores sociodemográficos en la dinámica del comportamiento delictivo: análisis descriptivo de criminalidad en Colombia, año 2022," *Rev. Criminalidad*, vol. 65, no. 3, pp. 161–185, ene. 2024, doi: 10.47741/17943108.525.
- [22] R. Wickes, "Social Disorganization Theory: Its History and Relevance to Crime Prevention," en *Preventing Crime and Violence*, Cham: Springer, 2017, pp. 57–67, doi: 10.1007/978-3-319-44124-5_6.
- [23] R. J. Sampson y W. B. Groves, "Community Structure and Crime: Testing Social-Disorganization Theory," *Am. J. Sociol.*, vol. 94, no. 4, pp. 774–802, ene. 1989, doi: 10.1086/229068.
- [31] S. Russell y P. Norvig, *Artificial Intelligence: A Modern Approach*, 4.ª ed. Pearson, 2020.
- [33] I. Goodfellow, Y. Bengio y A. Courville, *Deep Learning*. MIT Press, 2016.
- [36] C. M. Bishop, *Pattern Recognition and Machine Learning*. Springer, 2006.
- [38] T. M. Mitchell, *Machine Learning*. McGraw-Hill, 1997.
- [50] S. R. Timarán-Pereira, G. J. Hernández-Garzón y N. E. Quemá-Taimbud, "Identificación de lesiones no fatales en la cartografía del municipio de Pasto con la técnica de agrupamiento," *Rev. Investig. Desarro. Innov.*, vol. 8, no. 1, pp. 147–159, dic. 2017, doi: 10.19053/20278306.v8.n1.2017.5793.
- [52] S. Shekhar et al., "Spatiotemporal Data Mining: A Computational Perspective," *ISPRS Int. J. Geoinf.*, vol. 4, no. 4, pp. 2306–2338, oct. 2015, doi: 10.3390/ijgi4042306.

### Referencias técnicas adicionales (verificar formato/inclusión con el director)

- [T1] X. Chang, E. Tanin, J. Qi et al., "Contrastive Trajectory Similarity Learning with Dual-Feature Attention (TrajCL)," *ICDE*, 2023.
- [T2] Y. Chang, X. Cai, C. S. Jensen y J. Qi, "K Nearest Neighbor-Guided Trajectory Similarity Learning (TSMini)," *arXiv:2502.00285*, 2025. *(implementación base en `Research/TSMini`).*
- [T3] J.-G. Lee, J. Han y K.-Y. Whang, "Trajectory Clustering: A Partition-and-Group Framework (TRACLUS)," en *Proc. ACM SIGMOD*, 2007, pp. 593–604.
- [T4] M. Ester, H.-P. Kriegel, J. Sander y X. Xu, "A Density-Based Algorithm for Discovering Clusters (DBSCAN)," en *Proc. KDD*, 1996, pp. 226–231.
- [T5] H. Alt y M. Godau, "Computing the Fréchet distance between two polygonal curves," *Int. J. Comput. Geom. Appl.*, vol. 5, pp. 75–91, 1995.
