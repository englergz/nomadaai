# Hallazgos, desafíos del territorio y generalización

> Este documento consolida los **hallazgos de investigación**, los **desafíos** de trabajar en un
> contexto de datos escasos y uniformidad como Tumaco, y las **técnicas** con que se resolvieron.
> Es la base del capítulo de **Análisis y Discusión** de la tesis. Cada solución va con su respaldo.

## 1. Desafíos del territorio y cómo se resolvieron

| Desafío (hallazgo) | Evidencia | Alternativa/técnica aplicada | Respaldo |
|--------------------|-----------|------------------------------|----------|
| **No hay microdato de delito georreferenciado** | datos.gov.co (`m8fd-ahd9`) solo trae municipio + urbano/rural, sin coordenadas ni hora | **Risk Terrain Modeling**: modelar el riesgo con **factores del territorio**, no con incidentes | Caplan & Kennedy (2011) |
| **Homogeneidad socioeconómica** (sin gradiente) | Censo DANE 2018: **893 de 1 136 manzanas estrato 1; 99,1% de la población es estrato 1** (11 manzanas estrato 2, 2 estrato 3, 1 estrato 4). CEDRE 2024: 83% de hogares estrato 1 | El estrato **no discrimina** → se descarta y se usan **densidad + periferia + guardián + actividad** | Shaw & McKay (1942); CEDRE 2024 |
| **Malla incompleta** (grillas faltantes sobre viviendas) | la malla venía de trayectorias SUMO | Reconstruir la malla desde las **manzanas censales DANE** (cobertura completa, 475 celdas) | DANE CNPV 2018 |
| **Distribución sesgada** (mapa "todo verde/rojo") | dividir por el máximo aplastaba el rango | **Normalización por percentil** espacial + factores en percentil | (método) |
| **Sin dato de hora del delito (local)** | `fecha_hecho` sin hora | **Día** = dato propio (dom/lun picos); **hora** = patrón nacional publicado (18-24h pico) | CEJ *Reloj de la Criminalidad* 2019 · INMLCF |
| **OSM sin iluminación** | 0 luminarias, 0 `lit` en Tumaco | Pendiente: **luces nocturnas satelitales (VIIRS)** como proxy real | Welsh & Farrington (2008) |
| **Validación sin verdad-terreno** | no hay incidentes punto a punto | Caracterización real + **análisis de sensibilidad** (robustez ρ≈0,99) + **reporte ciudadano** futuro | Arteaga Botello (2005) |

## 2. Patrón temporal: DÍA × HORA, ambos respaldados (no supuestos)

El riesgo se modula por **día de la semana** y **hora**, cada uno con soporte:

- **Día — dato propio + cita:** homicidios de Tumaco por día (n=4 045, Policía Nacional / datos.gov.co):
  **domingo 19,7%** y **lunes 16,8%** = picos; martes el más bajo (10,9%). Coincide con la **CEJ
  "Reloj de la Criminalidad" (2019)**: *el domingo es el día con más homicidios en Colombia*. Doble
  respaldo. Ver `img/homicidios_dia_semana.png`.
- **Hora — cita:** **CEJ Reloj de la Criminalidad (2019)** + **INMLCF/Medicina Legal**: los homicidios
  se concentran **18:00–23:59 (hasta 2× el promedio)**, con pico tarde-noche; menor en la
  madrugada/mañana. La curva horaria del sistema **reproduce ese patrón citado** (pico ~20:00), no es
  una suposición propia. `DAY_FACTOR` y `HOUR_REL` documentan la fuente en el código.

Así, la afirmación "a las 20:00 hay más riesgo que a las 03:00" **está sostenida por fuente**, no por
nosotros. Lo único no calibrable con dato local exacto (la forma hora-a-hora precisa *en Tumaco*) se
toma del patrón nacional publicado — que es lo correcto cuando no hay microdato municipal.

## 3. El modelo de riesgo (antes → después)

`img/riesgo_antes_despues.png`: el índice pasó de ser un **mapa de tráfico degenerado** (96% corr con
actividad, 1 sola zona "alto") a un **índice multi-factor con contraste real** — donde las periferias
aisladas y de baja vigilancia se elevan, como corresponde al perfil de violencia dirigida de Tumaco.

## 4. Generalización: ¿"si funciona en Tumaco, funciona en cualquier parte"?

**Sí, con una precisión importante.** Diseñar para el **caso difícil** (datos escasos, homogeneidad,
conflicto armado) obliga a métodos **robustos y poco dependientes de datos** — que **degradan con
elegancia** y por tanto **también sirven donde hay datos ricos**. Eso es cierto y valioso.

**Pero hay que matizarlo (crítica honesta):**
- Lo que generaliza es el **marco/método** (RTM multi-factor + normalización por percentil + config
  por ciudad + reporte participativo), **no** los pesos ni los factores específicos de Tumaco.
- **Cada ciudad requiere re-calibración**: los *drivers* de riesgo cambian (una ciudad europea no
  tiene sicariato; allí pesarían más iluminación, hurto, nodos de transporte). Por eso los pesos son
  **editables** y hay una **columna `city`**.
- Donde SÍ hay microdato, el sistema se **valida directamente** (precisión/recall), algo que en
  Tumaco no se puede. O sea: el marco no solo "sobrevive" a la escasez — **aprovecha** la abundancia
  cuando existe.

**Conclusión defendible:** el aporte no es "un modelo universal", sino un **marco replicable que
funciona en el extremo de escasez y escala hacia contextos con más datos**. Afirmar "funciona en
cualquier parte" sin re-calibrar sería sobre-vender; afirmar "el marco es transferible y se adapta"
es exacto.

## 5. ¿Estamos documentando todo? (índice)

Sí. Trazabilidad de los hallazgos:
- `CUMPLIMIENTO.md` — objetivos vs. resultados (tablero).
- `VALIDACION_RIESGO.md` — validación honesta del riesgo + factores + citas.
- `PLAN_PRODUCTO.md` — modelo robusto por factores + app + roadmap.
- `HALLAZGOS_Y_DESAFIOS.md` — este documento (desafíos, alternativas, generalización).
- `MODELO_PREDICCION.md`, `MODELO_RIESGO.md`, `METODOLOGIA.md` — modelos y método.
- **Figuras:** `img/riesgo_antes_despues.png`, `img/homicidios_dia_semana.png`, y las de Cowork
  (`tumaco_riesgo_rtm.png`, `tumaco_tendencias.png`, evaluación de alerta, etc.).
- **Scripts reproducibles:** `rebuild_risk_full.py`, `oe2_valida_riesgo.py`, `oe4_od_sweep.py`.
