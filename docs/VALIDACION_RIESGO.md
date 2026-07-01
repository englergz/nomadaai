# Validación del modelo de riesgo (OE2)

> Documento de resultados de validación del índice de riesgo (Risk Terrain Modeling, RTM).
> Reproducible con `services/api/scripts/oe2_valida_riesgo.py`.

## Alcance honesto de la validación

Los datos abiertos de homicidios de Tumaco (Policía Nacional — MinDefensa, portal
**datos.gov.co**, dataset `m8fd-ahd9`) tienen granularidad **municipio + zona (URBANA/RURAL) +
fecha + arma + modalidad**. **No incluyen coordenadas ni hora del hecho.** En consecuencia, **no
es metodológicamente posible** calcular una precisión/recall espacial *punto a punto* del mapa de
riesgo intra-urbano con datos abiertos. Ese nivel requiere **microdato georreferenciado**, cuya
entrega se solicitó formalmente a la DIJIN (derecho de petición radicado, `Solicitud_DIJIN_microdato`).

Por tanto, el modelo de riesgo se valida —con la evidencia disponible— en dos frentes: (1) la
**caracterización real** del fenómeno que fundamenta sus factores y (2) la **robustez** del índice.

## 1. Caracterización real del riesgo (datos.gov.co, 2003–2026)

Total: **4 045 homicidios** en el municipio de San Andrés de Tumaco (4 027 registros).

| Dimensión | Resultado | Lectura |
|-----------|-----------|---------|
| **Arma** | **85,8%** con arma de fuego | Violencia armada, no delito de oportunidad. |
| **Modalidad** | **56,6%** sicariato (luego agresión 14%, riñas 9%) | Violencia **dirigida/organizada**, coherente con el contexto de economías ilegales. |
| **Zona** | URBANA **44,8%** · RURAL **55,2%** | El ruteo urbano incide sobre ~45% de la violencia letal; la mitad rural (corredores) queda fuera del alcance urbano — **límite de encuadre declarado**. |
| **Tendencia** | 216 (2019) → 40 (2025) | Descenso sostenido en el período reciente. |

**Interpretación (validez de contenido).** El perfil —arma de fuego + sicariato— confirma que el
riesgo relevante en Tumaco es **estructural y espacialmente condicionado** (presencia de actores,
exposición, factores socioeconómicos), no aleatorio. Esto respalda la elección de factores del RTM
(teoría de las actividades rutinarias y prevención situacional del delito) frente a un enfoque de
puro conteo de incidentes. CSV: `artifacts/eval/oe2_homicidios_tumaco.csv`.

## 2. Análisis de sensibilidad del índice RTM (robustez)

Técnica estándar en RTM: si la **jerarquía de zonas por riesgo** se mantiene ante cambios en los
pesos de los factores, el modelo es robusto (no depende de una calibración arbitraria).

- Zonas analizadas: **425**. Factores: exposición (actividad), socioeconómico, población.
- Reconstrucción del índice desde los factores normalizados vs. el índice publicado:
  **ρ de Spearman = 0,865** (la reconstrucción refleja fielmente el índice del modelo).
- **Perturbando los pesos ±50%** (1 000 combinaciones aleatorias, renormalizadas):
  - Correlación de rangos con el ranking base: **ρ medio = 0,994** (percentil 5 = 0,983; mínimo = 0,967).
  - **Top-10% de zonas de mayor riesgo preservado: 96,4%.**

**Interpretación.** El ordenamiento de zonas de riesgo es **altamente estable**: identificar las
zonas prioritarias **no depende** de la elección exacta de pesos. El índice está dominado por el
factor **socioeconómico** (peso relativo ≈ 0,88), lo que es consistente con la literatura
(desorganización social; Shaw & McKay, 1942) y explica parte de la estabilidad.

## Conclusión y límites

- **Lo validado:** el RTM es un **índice fundamentado** (perfil real del fenómeno) y **robusto**
  (ranking estable, ρ≈0,99). Sirve para priorizar zonas y ponderar rutas.
- **Lo no validable con datos abiertos:** una **precisión espacial punto a punto (≥85%)** del mapa
  intra-urbano; requiere microdato georreferenciado (**DIJIN**, en trámite). Declararlo es parte de
  la honestidad metodológica, no una debilidad del diseño.
- **Encuadre:** el sistema es de ámbito **urbano**; la violencia rural (55%) excede su alcance.

## Referencias

- Caplan, J. M., & Kennedy, L. W. (2011). *Risk Terrain Modeling: Brokering Criminological Theory
  and GIS Methods for Crime Forecasting.* Justice Quarterly.
- Shaw, C., & McKay, H. (1942). *Juvenile Delinquency and Urban Areas.*
- Cohen, L., & Felson, M. (1979). *Social Change and Crime Rate Trends: A Routine Activity Approach.*
- Policía Nacional de Colombia — datos.gov.co, dataset `m8fd-ahd9` (homicidios).
