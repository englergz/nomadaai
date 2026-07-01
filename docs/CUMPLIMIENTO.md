# Cumplimiento de resultados vs. lo propuesto en el anteproyecto

> Autoevaluación **crítica** del estado del proyecto frente a los objetivos, resultados esperados e
> indicadores aprobados. Honesta a propósito: declarar los vacíos **aumenta** la validez de la tesis.
> Leyenda: ✅ cumplido · 🟡 parcial · ⚠️ vacío/riesgo.

## Tablero por objetivo

| OE | Indicador del anteproyecto | Estado | Evidencia / brecha |
|----|----------------------------|--------|--------------------|
| **OE1** | Modelo de IA que predice el destino, **precisión > 85%** | ✅ **Superado** | **90% acierto ≤50 m** (held-out, no visto), error mediano ~8 m. Validado con **comparación de 3 vías**: el modelo (k-vecinos+rumbo) supera al baseline ingenuo (línea recta, +~18 pp) y a una **cadena de Markov que aprende transiciones** — así se justifica la elección del método, no solo la meta. Ver `MODELO_PREDICCION.md`, `/trajectories/evaluate`. |
| OE1 | Informe de caracterización (calidad, patrones) | 🟡 | Caracterización hecha (TrajCL, TRACLUS, Fréchet); falta redactarla como "informe" formal en la tesis. |
| **OE2** | Modelo de IA de riesgo, **precisión > 85%** | ⚠️ **Vacío clave** | El riesgo es un **índice compuesto (RTM)** fundamentado, **no un predictor validado**: no hay precisión medida porque falta **microdato de delito georreferenciado (DIJIN)** para calibrar/validar (RTM/PAI). Hoy no se puede afirmar el 85%. |
| OE2 | Informe de datos de riesgo (calidad, patrones) | 🟡 | Variables reales integradas (TerriData IPM, servicios); incidentes a nivel **municipal**, no punto; socioeconómico **municipal/urbano-rural**, no manzana. |
| **OE3** | Sistema de **recomendación de rutas seguras** (minimiza exposición), **~69%** + tiempo real | ✅ **Cumplido** | **Alerta anticipada** (88.7%) + ruteo **direccional, por tipo y ponderado por riesgo**: `/route/build` calcula el **desvío que minimiza la exposición** y lo compara con la ruta directa (`risk_weight` = λ). |
| OE3 | Panel con **≥3 capas** (riesgo, POIs, rutas) | 🟡 | Tiene riesgo + ruta + recorrido + corredores (≥3). **Falta la capa de POIs** (puntos de interés, F5 pendiente). |
| **OE4** | Evaluación en **≥5 escenarios**, cuali+cuanti | ✅/🟡 | **45 escenarios** (hora×umbral×look-ahead) cuantitativos + efectividad de alerta. Cuantitativo cubierto; falta el componente cualitativo. |
| OE4 | **Mejora de percepción de seguridad ≥30%** | 🟡 **Proxy disponible** | El estudio de percepción (encuesta) no aplica con datos simulados. **Proxy cuantitativo ya implementado:** *% de reducción de exposición al riesgo de la ruta segura vs. la directa* (`/route/build` → `comparison.exposure_reduction_pct`). Falta correrlo sistemáticamente sobre varios O-D y reportarlo. |
| OE4 | Sistema optimizado, **95% funcionalidad sin errores críticos** | 🟡 | App desplegada y operativa (HF Space); falta un **informe de QA** formal (cobertura de pruebas, tasa de errores). |

## Lo que está sólido (fortalezas)

- **OE1 supera la meta** (90% > 85%) y de forma **sin sesgo** (train/test, conjunto no visto).
- **Marco de riesgo replicable y auditable** (RTM multivariable, trazable por factor) con base
  criminológica citada y datos oficiales colombianos.
- **Alerta anticipada caracterizada** (88.7% avisos antes de la zona, ~280 m / 25 s de anticipación).
- **Producto real desplegado** (web + API en la nube), con simulación en vivo y evaluación
  comparativa (no visto vs. rutas nuevas).
- **Documentación** coherente con el anteproyecto y atribución a la base del director.

## Vacíos críticos (lo que falta, por prioridad)

1. **Validación del modelo de riesgo (OE2, el más sensible).** Sin microdato DIJIN no hay precisión
   medida del riesgo. *Acciones:* (a) gestionar el microdato (oficio en `data_sources/`); (b) mientras
   tanto, declarar el riesgo como **índice teórico-fundamentado** y validar la **calibración de pesos**
   por análisis de sensibilidad (ya hecho), no como "predictor 85%".
2. ~~Ruteo ponderado por riesgo (OE3).~~ ✅ **HECHO:** `/route/build` calcula la ruta segura con
   `peso = distancia·(1+λ·riesgo)` sobre el grafo dirigido y la compara con la directa
   (reducción de exposición). Pendiente menor: correr el proxy de OE4 sobre un set de O-D y reportarlo.
3. **Indicador de percepción ≥30% (OE4).** Reformular a un **proxy cuantitativo** (reducción de
   exposición ruta segura vs. directa) y/o declarar el estudio de percepción como trabajo futuro.
4. **Granularidad de datos:** censo DANE por **manzana** (F3), **POIs** OSM (F4/capa del panel),
   **iluminación** (F5). Elevan la robustez intra-urbana.
5. **Validación con datos reales:** todo es simulación SUMO; validar con GPS/delito real = trabajo futuro.

## Qué pulir (calidad)

- Conectar `/route/safe` al riesgo (desvío real) → cierra OE3 y habilita el proxy de OE4.
- Añadir capa de **POIs** al mapa (cumple el indicador de "≥3 capas con puntos de interés").
- Informe de **QA/errores** para el indicador de 95% de funcionalidad.
- Extender la **malla de riesgo** a todo el casco (reproyección de la red).

## Veredicto

**¿Ya cumplimos?** Parcialmente y bien encaminados: **OE1 cumplido y superado**, **OE4 cuantitativo
cumplido**, **OE2/OE3 con base construida pero con vacíos declarables**. El núcleo pendiente para
"cerrar" la promesa central es **(a) el ruteo seguro ponderado por riesgo** y **(b) la validación del
riesgo con microdato**. Ambos están al alcance y, declarados con honestidad, **fortalecen** la defensa.
