# Modelo de Riesgo Urbano (OE2) — Índice de Riesgo Urbano (IRU)

> **NómadaAI** · Trabajo de Grado, MGTIC, Facultad de Ingeniería, Universidad de Nariño. Autor:
> Engler González Prado. Director: PhD. Andrés Oswaldo Calderón Romero. **Citación: IEEE.**
> Documento **canónico** del modelo de riesgo (fusiona la fundamentación científica y la metodología
> del índice). La aplicación consume su salida (`tumaco_riesgo_horario.csv`) en `services/api`.

El **Índice de Riesgo Urbano (IRU)** es la contribución central de OE2: un índice **compuesto,
multivariable, espacio-temporal, configurable y auditable**, construido como una adaptación de
**Risk Terrain Modeling (RTM)** [R1], [R2] — combinar varias *capas* de factores de riesgo, cada una
con respaldo teórico, en una superficie de riesgo por **zona** y **hora**.

![Mapa de riesgo RTM de Tumaco](img/tumaco_riesgo_rtm.png)
*Figura 1. Superficie de riesgo RTM por zona (modelo multivariable). Las zonas periféricas
vulnerables se elevan aunque tengan poco tránsito, por efecto del factor socioeconómico.*

---

## 1. Por qué multivariable (y por qué no basta el delito reportado)

El riesgo basado **solo en delitos reportados** tiene tres sesgos conocidos: (i) **sub-reporte** (no
todo delito se denuncia), (ii) **sesgo de patrullaje** (se reporta más donde más se vigila) y (iii)
es **retrospectivo** (dónde *ocurrió*, no dónde las *condiciones* lo favorecen). RTM corrige esto
modelando el **entorno que produce el riesgo** [R1], [R2]; por eso integramos factores
socioeconómicos y del entorno construido, no solo el conteo de delitos.

El caso de Tumaco lo exige: **IPM = 53,7%**, cobertura de **alcantarillado = 5,5%**, **acueducto =
31,7%**, tasa de **homicidios = 79,4/100k** y de **violencia intrafamiliar = 111,8/100k** (DNP
TerriData, 2018–2021). Es un contexto de privación concentrada donde la teoría predice mayor riesgo
más allá del punto exacto del reporte.

![Tendencias de criminalidad en Tumaco](img/tumaco_tendencias.png)
*Figura 2. Tendencias de criminalidad en Tumaco (contexto que motiva el modelo).*

---

## 2. Definición formal del índice

Para una zona (celda) `z` y una hora `h`:

```
IRU(z,h) = 100 · V_muni · TEMP(h) · Σ_i  w_i · norm( F_i(z) )
```

- `F_i(z)`: valor crudo del factor *i* en la zona *z*.
- `norm(·)`: normalización a [0,1] (min–max por defecto; alternativas: densidad kernel, Jenks),
  para que las capas sean comparables.
- `w_i`: peso del factor *i*, con **Σ w_i = 1** (cada peso es un *porcentaje* del índice).
- `V_muni ∈ [0,1]`: vulnerabilidad socioeconómica municipal (F3) de TerriData (IPM, déficit de
  servicios, deserción). Hoy es **constante dentro de Tumaco** (escala todo el mapa); su valor real
  emerge al comparar **entre municipios** (generaliza el marco).
- `TEMP(h)`: modulador horario (media diaria = 1, no infla el total) [R3].
- Resultado escalado a **0–100** para legibilidad.

El índice es **determinista** (mismos datos → mismo valor) y **trazable**: cada punto del mapa se
descompone en la contribución `w_i·norm(F_i)` de cada variable → se puede explicar *por qué* una
zona es de riesgo alto (no es una caja negra).

---

## 3. Variables (capas) del índice y su fundamento teórico

| # | Factor (capa) | Teoría / evidencia | Ref. | Fuente | Estado |
|---|---|---|---|---|---|
| F1 | Densidad de delito reportado (homicidio, hurto) | Concentración espacial del crimen; "criminalidad del lugar" | [R1],[R2],[R6] | Policía / DANE / TerriData | Disponible (distribuida) |
| F2 | Exposición / convergencia de movilidad | Actividades rutinarias (objetivos + ofensores sin guardián) | [R3] | Trayectorias SUMO | **Disponible** ✓ |
| F3 | Desventaja socioeconómica (IPM, servicios, deserción) | Desorganización social | [R4],[R5] | DANE Censo, SISBÉN, TerriData | Municipal/urbano-rural; **manzana pendiente** |
| F4 | Población / densidad | Actividades rutinarias (objetivos disponibles); vulnerabilidad demográfica | [R3],[R5] | DANE Censo / TerriData (267.010 hab.) | Municipal; manzana pendiente |
| F5 | Generadores/atractores (bares, cajeros, comercio) | Teoría del patrón delictivo | [R6] | OSM / Overpass | Pendiente (descarga) |
| F6 | Diseño ambiental (iluminación, visibilidad) | CPTED; iluminación y delito | [R7],[R8],[R9] | OSM / campo | Pendiente |
| F7 | Modulación temporal (hora/día) | Ritmos de actividad rutinaria | [R3] | Curva (calibrable) | **Disponible** ✓ |
| F8 | Reporte ciudadano (incidentes en la app) | Datos colaborativos / señal en tiempo real | — | App NómadaAI (producto) | Diseñado (§6) |

Contexto colombiano que respalda F1+F3 (correlación espacial pobreza–violencia): [R10], [R11].

![Zonificación de Tumaco](img/tumaco_zonas.png)
*Figura 3. Zonificación en malla (~150 m, 425 zonas) sobre el área urbana simulada.*

---

## 4. Asignación de pesos (núcleo metodológico: el "cómo" y el "porqué")

El peso `w_i` se asigna por **una de tres vías**, en orden creciente de rigor; la tesis declara cuál
se usa.

### 4.1 Vía A — Pesos informados por teoría (por defecto, *cold start*)
Sin delito georreferenciado para calibrar, los pesos se fijan según la fuerza de la evidencia:

| Factor | Peso por defecto | Justificación (resumen) |
|---|---|---|
| F2 Exposición | 0.30 | La oportunidad es condición necesaria del delito [R3]; señal espacial más confiable hoy. |
| F3 Socioeconómico | 0.25 | Asociación robusta privación–crimen [R4],[R5]; Tumaco IPM 53,7%. |
| F1 Delito reportado | 0.20 | Señal directa pero con sub-reporte/sesgo de patrullaje [R2]. |
| F5 POIs | 0.15 | Atractores elevan el riesgo local [R6]; sube cuando exista el dato. |
| F4 Población | 0.10 | Modula objetivos disponibles; evita sobre-pesar zonas vacías. |
| F6 Diseño/iluminación | 0.00 hoy | Se activa cuando exista el dato [R9]. |

Σ = 1.00. Son **supuestos declarados**, no verdades; su efecto se prueba en §5.

### 4.2 Vía B — Pesos calibrados con datos (recomendada; al llegar el microdato DIJIN)
Método propio de RTM [R2]: el **valor de riesgo relativo** de cada factor = razón entre la densidad
de delito donde el factor está presente vs. ausente; el peso es proporcional (normalizado).
Alternativa: regresión de conteo (Poisson/binomial negativa) o *gradient boosting* → coeficientes/
importancias normalizados a Σ=1. Validación: validación cruzada espacial, *Predictive Accuracy
Index* (PAI), precision/recall/F1.

### 4.3 Vía C — Pesos configurables (operativo)
Viven en `risk_weights.json`; se modifican sin tocar código. El motor `build_risk_rtm.py` los lee y
**re-normaliza a Σ=1** sobre las capas presentes → otras ciudades/énfasis reconfiguran el índice.

---

## 5. Análisis de sensibilidad (obligatorio para validez)

Como los pesos por defecto son supuestos, se reporta **cuánto cambia el mapa al variarlos** (barrido
de `w_i` y de los parámetros del motor de alerta), identificando si los resultados son robustos.

![Barrido de parámetros de alerta](img/sweep_alerta.png)
*Figura 4. Barrido de sensibilidad (hora × umbral × horizonte): caracteriza el motor de alerta y la
robustez del índice.*

---

## 6. Dimensión temporal (F6/F7)

El riesgo es **dinámico**: la curva horaria `TEMP(h)` modula el índice según el momento del día
[R3]. Hoy es un **supuesto informado por la literatura** (las bases públicas no traen la hora del
hecho); está aislado y **calibrable** con el microdato (DIJIN). El barrido muestra que el riesgo
responde a la hora (mínimo nocturno, máximo en la franja de mayor convergencia), lo que sustenta la
alerta anticipada de OE3.

![Curva horaria del riesgo](img/risk_hour_curve.png)
*Figura 5. Modulador horario `TEMP(h)`: el riesgo de cada zona varía con la hora de llegada.*

---

## 7. Reporte ciudadano de incidentes (F8 — para el PRODUCTO)

En investigación el dato es simulado; en el producto, los usuarios **reportan incidentes** desde la
app, alimentando una capa dinámica:

```
F8(z,t) = Σ_r  c_r · decay(t − t_r) · verif_r
```
- `c_r`: severidad del reporte; `decay(Δt)`: decaimiento temporal (los recientes pesan más);
  `verif_r`: factor de verificación (auto-reporte < confirmado < validado por autoridad).
- **Cold start:** el índice arranca con datos oficiales (F1–F6); F8 aporta señal local casi en tiempo
  real a medida que llegan reportes (cierra el ciclo del producto).
- **Sesgos a declarar:** zonas con más usuarios reportan más → mitigado con normalización por
  población/uso y con `verif_r`.

---

## 8. Estado actual vs. meta (honesto, para la discusión)

- **Hoy:** la discriminación intra-urbana viene de F2 (exposición) × F6 (hora) × V_muni (F3
  municipal). F1 se distribuye por exposición (tiende a seguir la actividad).
- **Para robustez plena:** (a) censo DANE a nivel **manzana** para F3 espacial; (b) **POIs** de
  OSM/Overpass para F4; (c) **iluminación** para F5; (d) **microdato DIJIN** para calibrar pesos con
  RTM y romper la circularidad F1≈F2.
- Declararlo **aumenta** la validez: es un marco RTM correctamente especificado cuya precisión crece
  con la granularidad del dato.

![Riesgo base de Tumaco](img/tumaco_riesgo.png)
*Figura 6. Capa de riesgo (versión base) para comparación visual con el modelo RTM (Figura 1).*

---

## 9. Limitaciones de validez y ética

- Datos de movilidad **simulados** (SUMO): exposición realista, no GPS real.
- Curva horaria = **supuesto** [R3], no microdato local.
- F3 socioeconómico **municipal**: no discrimina barrios *todavía*; válido como multiplicador y para
  generalización entre ciudades.
- **Correlación ≠ causalidad:** el índice señala *condiciones de riesgo del entorno*, no culpa a
  territorios ni personas; uso **preventivo**, evitando estigmatización [R5], [R8]. Tratamiento de
  datos conforme a la **Ley 1581 de 2012** (habeas data); reportes ciudadanos anonimizados.

---

## 10. Aporte a la tesis

El IRU es un **índice compuesto, multivariable, espacio-temporal, configurable y auditable**,
fundamentado en criminología ambiental (RTM, actividades rutinarias, desorganización social, patrón
delictivo, CPTED) y operacionalizado con datos oficiales colombianos (Policía, DANE/TerriData) y, en
el producto, con reporte ciudadano. Su valor está en el **marco replicable** (cualquier ciudad) y en
la **trazabilidad** de cada decisión de riesgo.

---

## Referencias (IEEE)

- [R1] J. M. Caplan y L. W. Kennedy, *Risk Terrain Modeling Compendium*. Newark, NJ: Rutgers Center on Public Security, 2011.
- [R2] J. M. Caplan, L. W. Kennedy y J. Miller, "Risk terrain modeling: Brokering criminological theory and GIS methods for crime forecasting," *Justice Quarterly*, vol. 28, no. 2, pp. 360–381, 2011.
- [R3] L. E. Cohen y M. Felson, "Social change and crime rate trends: A routine activity approach," *American Sociological Review*, vol. 44, no. 4, pp. 588–608, 1979.
- [R4] C. R. Shaw y H. D. McKay, *Juvenile Delinquency and Urban Areas*. Chicago, IL: Univ. of Chicago Press, 1942.
- [R5] R. J. Sampson, S. W. Raudenbush y F. Earls, "Neighborhoods and violent crime: A multilevel study of collective efficacy," *Science*, vol. 277, no. 5328, pp. 918–924, 1997.
- [R6] P. L. Brantingham y P. J. Brantingham, "Criminality of place: Crime generators and crime attractors," *European J. on Criminal Policy and Research*, vol. 3, no. 3, pp. 5–26, 1995.
- [R7] C. R. Jeffery, *Crime Prevention Through Environmental Design*. Beverly Hills, CA: Sage, 1971.
- [R8] P. Cozens y T. Love, "A review and current status of Crime Prevention through Environmental Design (CPTED)," *J. of Planning Literature*, vol. 30, no. 4, pp. 393–412, 2015.
- [R9] B. C. Welsh y D. P. Farrington, "Effects of improved street lighting on crime: A systematic review," *Campbell Systematic Reviews*, vol. 4, no. 1, pp. 1–51, 2008.
- [R10] "Pobreza y violencia en la Región Caribe colombiana: un enfoque espacial," *Ensayos sobre Política Económica*, Banco de la República, 2017.
- [R11] Instituto Igarapé, *Un análisis de la criminalidad urbana en Colombia*, 2014.
- [T0] A. O. Calderón Romero, *Base de simulación de movilidad (red vial de Tumaco + generación de trayectorias SUMO)*, Universidad de Nariño. https://github.com/aocalderon/Research/tree/master/Scripts/SUMO

> Indicadores de Tumaco: DNP, TerriData, entidad 52835 (`Research/.../TerriData52835f.xlsx`).
