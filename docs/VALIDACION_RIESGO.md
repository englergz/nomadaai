# Validación y reconstrucción del modelo de riesgo (OE2)

> Resultados reproducibles con `services/api/scripts/oe2_valida_riesgo.py` (validación) y
> `services/api/scripts/rebuild_risk.py` (reconstrucción con datos DANE).

## 1. Alcance honesto

Los datos abiertos de homicidios de Tumaco (Policía Nacional, **datos.gov.co**, dataset
`m8fd-ahd9`) tienen granularidad **municipio + zona URBANA/RURAL + fecha + arma + modalidad**;
**no traen coordenadas ni hora**. Por tanto **no es posible** una precisión/recall espacial punto a
punto del mapa intra-urbano sin **microdato georreferenciado** (DIJIN, derecho de petición radicado).

## 2. Caracterización real del fenómeno (datos.gov.co, 4 045 homicidios)

| Dimensión | Resultado | Lectura |
|-----------|-----------|---------|
| Arma | **85,8%** arma de fuego | Violencia armada, no delito de oportunidad. |
| Modalidad | **56,6%** sicariato | Violencia **dirigida/organizada** (economías ilegales). |
| Zona | URBANA 44,8% · RURAL 55,2% | El ruteo urbano incide sobre ~45% de la violencia letal. |
| Tendencia | 216 (2019) → 40 (2025) | Descenso sostenido. |

**Consecuencia teórica clave:** la violencia en Tumaco es de tipo **conflicto armado / sicariato**,
no delito urbano común. Este patrón **no** se explica por los gradientes socioeconómicos clásicos de
la criminología urbana.

## 3. Diagnóstico crítico del índice inicial y su reconstrucción

**Diagnóstico (evidencia).** El índice RTM inicial resultó **degenerado**:

- Estaba explicado en un **96%** por la densidad de tráfico (`n_points`) → era, de facto, un **mapa
  de actividad/tráfico**, no de peligro.
- Su factor socioeconómico era **casi constante**: el censo DANE 2018 muestra que **el 99% de la
  población de Tumaco es estrato 1** (893 de 1 136 manzanas). Sin gradiente socioeconómico, ese
  factor —aunque tuviera un peso alto— **no aportaba contraste espacial** (offset plano).
- Clasificación inservible: **1 sola zona "alto"** de 425.

**Reconstrucción con datos DANE reales.** Se descargó la **población por manzana** (censo DANE 2018,
servicio Esri Colombia; 813 manzanas urbanas, 65 568 hab.) y se reconstruyó el índice como mezcla de
**densidad poblacional real (0,65)** + exposición de actividad (0,35), **descartando** el factor
socioeconómico por homogéneo. Resultado antes/después:

| Métrica | Antes | Después |
|---------|-------|---------|
| corr(índice, tráfico `n_points`) | 0,96 | **0,68** |
| corr(índice, población DANE) | 0,28 | **0,80** |
| Niveles bajo / medio / **alto** | 342 / 82 / **1** | 213 / 149 / **63** |

El mapa dejó de ser un mapa de tráfico, ahora lo gobierna la **densidad poblacional real** y los
niveles son utilizables. La curva temporal (pico 20:00 ×1,79) se preservó.

## 4. Qué es y qué no es (honestidad metodológica)

- **Es:** un **índice de exposición/vulnerabilidad** fundamentado (teoría de actividades rutinarias:
  más población = más objetivos potenciales), calibrado con **datos censales reales** y modulado por
  una curva temporal. Útil para priorizar zonas y ponderar rutas.
- **No es:** un **predictor de crimen validado** con precisión ≥85%. Dos razones estructurales, ambas
  **hallazgos de la investigación**, no defectos de implementación:
  1. Tumaco es **socioeconómicamente homogéneo** (estrato 1) → el gradiente socioeconómico clásico
     no discrimina.
  2. Su violencia es de **conflicto armado/sicariato**, cuyo patrón espacial requiere **microdato
     georreferenciado de incidentes** (DIJIN, en trámite), inexistente en datos abiertos.

Declarar esto es lo correcto: convierte una limitación de datos en una **contribución analítica**
(los modelos de riesgo urbano estándar tienen alcance limitado en contextos de conflicto armado y
homogeneidad socioeconómica como Tumaco).

## Referencias

- Caplan, J. M., & Kennedy, L. W. (2011). *Risk Terrain Modeling.* Justice Quarterly.
- Cohen, L., & Felson, M. (1979). *Social Change and Crime Rate Trends: A Routine Activity Approach.*
- Shaw, C., & McKay, H. (1942). *Juvenile Delinquency and Urban Areas.*
- DANE (2018). *Censo Nacional de Población y Vivienda* — población por manzana (servicio Esri Colombia).
- Policía Nacional de Colombia — datos.gov.co, dataset `m8fd-ahd9` (homicidios).
