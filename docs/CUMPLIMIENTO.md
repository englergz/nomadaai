# Cumplimiento de resultados vs. lo propuesto en el anteproyecto

> Autoevaluación **crítica** del estado del proyecto frente a los objetivos, resultados esperados e
> indicadores aprobados. Honesta a propósito: declarar los vacíos **aumenta** la validez de la tesis.
> Leyenda: ✅ cumplido · 🟡 parcial · ⚠️ vacío/riesgo.

## Tablero por objetivo

| OE | Indicador del anteproyecto | Estado | Evidencia / brecha |
|----|----------------------------|--------|--------------------|
| **OE1** | Modelo de IA que predice el destino, **precisión > 85%** | ✅ **Superado** | **90% acierto ≤50 m** (held-out, no visto), error mediano ~8 m. Ver `MODELO_PREDICCION.md`, `/trajectories/evaluate`. |
| OE1 | Informe de caracterización (calidad, patrones) | 🟡 | Caracterización hecha (TrajCL, TRACLUS, Fréchet); falta redactarla como "informe" formal en la tesis. |
| **OE2** | Modelo de IA de riesgo, **precisión > 85%** | ⚠️ **Vacío clave** | El riesgo es un **índice compuesto (RTM)** fundamentado, **no un predictor validado**: no hay precisión medida porque falta **microdato de delito georreferenciado (DIJIN)** para calibrar/validar (RTM/PAI). Hoy no se puede afirmar el 85%. |
| OE2 | Informe de datos de riesgo (calidad, patrones) | 🟡 | Variables reales integradas (TerriData IPM, servicios); incidentes a nivel **municipal**, no punto; socioeconómico **municipal/urbano-rural**, no manzana. |
| **OE3** | Sistema de **recomendación de rutas seguras** (minimiza exposición), **~69%** + tiempo real | 🟡 **Parcial** | Hay **alerta anticipada** (avisa antes, 88.7%) + ruteo **direccional y por tipo**. **Falta:** el ruteo **ponderado por riesgo** (calcular el desvío que *minimiza* la exposición); `/route/safe` aún es por distancia. |
| OE3 | Panel con **≥3 capas** (riesgo, POIs, rutas) | 🟡 | Tiene riesgo + ruta + recorrido + corredores (≥3). **Falta la capa de POIs** (puntos de interés, F5 pendiente). |
| **OE4** | Evaluación en **≥5 escenarios**, cuali+cuanti | ✅/🟡 | **45 escenarios** (hora×umbral×look-ahead) cuantitativos + efectividad de alerta. Cuantitativo cubierto; falta el componente cualitativo. |
| OE4 | **Mejora de percepción de seguridad ≥30%** | ⚠️ **Vacío** | No hay estudio de percepción (requiere usuarios/encuesta; con datos simulados no aplica directo). **Propuesta:** reemplazar por un proxy **cuantitativo** defendible: *% de reducción de exposición al riesgo de la ruta recomendada vs. la directa* (requiere OE3 ponderado por riesgo). |
| OE4 | Sistema optimizado, **95% funcionalidad sin errores críticos** | 🟡 | App desplegada y operativa (HF Space); falta un **informe de QA** formal (cobertura de pruebas, tasa de errores). |

## Lo que está sólido (fortalezas)

- **OE1 supera la meta** (90% > 85%) y de forma **sin sesgo** (train/test, conjunto no visto).
- **Marco de riesgo replicable y auditable** (RTM multivariable, trazable por factor) con base
  criminológica citada (IEEE) y datos oficiales colombianos.
- **Alerta anticipada caracterizada** (88.7% avisos antes de la zona, ~280 m / 25 s de anticipación).
- **Producto real desplegado** (web + API en la nube), con simulación en vivo y evaluación
  comparativa (no visto vs. rutas nuevas).
- **Documentación IEEE** coherente con el anteproyecto y atribución a la base del director.

## Vacíos críticos (lo que falta, por prioridad)

1. **Validación del modelo de riesgo (OE2, el más sensible).** Sin microdato DIJIN no hay precisión
   medida del riesgo. *Acciones:* (a) gestionar el microdato (oficio en `data_sources/`); (b) mientras
   tanto, declarar el riesgo como **índice teórico-fundamentado** y validar la **calibración de pesos**
   por análisis de sensibilidad (ya hecho), no como "predictor 85%".
2. **Ruteo ponderado por riesgo (OE3).** Hoy se **avisa** pero no se **calcula la ruta más segura**.
   *Acción:* aplicar `peso = distancia·(1+λ·riesgo)` en el grafo dirigido (ya existe la estructura) y
   devolver la ruta alternativa; con eso nace el proxy de OE4.
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
