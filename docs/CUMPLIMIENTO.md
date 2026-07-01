# Cumplimiento de resultados vs. lo propuesto en el anteproyecto

> Autoevaluación **crítica** del estado del proyecto frente a los objetivos, resultados esperados e
> indicadores aprobados. Honesta a propósito: declarar los vacíos **aumenta** la validez de la tesis.
> Leyenda: ✅ cumplido · 🟡 parcial · ⚠️ vacío/riesgo.

## Tablero por objetivo

| OE | Indicador del anteproyecto | Estado | Evidencia / brecha |
|----|----------------------------|--------|--------------------|
| **OE1** | Modelo de IA que predice el destino, **precisión > 85%** | ✅ **Superado** | **90% acierto ≤50 m** (held-out, no visto), error mediano ~8 m. Validado con **comparación de 3 vías**: el modelo (k-vecinos+rumbo) supera al baseline ingenuo (línea recta, +~18 pp) y a una **cadena de Markov que aprende transiciones** — así se justifica la elección del método, no solo la meta. Ver `MODELO_PREDICCION.md`, `/trajectories/evaluate`. |
| OE1 | Informe de caracterización (calidad, patrones) | 🟡 | Caracterización hecha (TrajCL, TRACLUS, Fréchet); falta redactarla como "informe" formal en la tesis. |
| **OE2** | Modelo de IA de riesgo, **precisión > 85%** | 🟡 **Validable con lo que hay** | El anteproyecto **no** compromete microdato DIJIN: el objetivo general es sobre **datos simulados** y OE2 dice *"identifique y **simule** eventos… con análisis de datos históricos… reportes policiales y denuncias"* (genérico). El riesgo es un **índice RTM** construido con **datos reales abiertos** (homicidios datos.gov.co georreferenciados, DANE, TerriData). **Acción para el 85%:** validar el mapa RTM contra los **homicidios georreferenciados** que ya se tienen (¿las zonas de alto riesgo capturan dónde ocurrieron? → precisión/recall/F1). El microdato **DIJIN es un *plus*** (petición ya radicada), no un requisito. |
| OE2 | Informe de datos de riesgo (calidad, patrones) | 🟡 | Variables reales integradas (TerriData IPM, servicios); incidentes a nivel **municipal**, no punto; socioeconómico **municipal/urbano-rural**, no manzana. |
| **OE3** | Sistema de **recomendación de rutas seguras** (minimiza exposición), **~69%** + tiempo real | ✅ **Cumplido** | **Alerta anticipada** (88.7%) + ruteo **direccional, por tipo y ponderado por riesgo**: `/route/build` calcula el **desvío que minimiza la exposición** y lo compara con la ruta directa (`risk_weight` = λ). |
| OE3 | Panel con **≥3 capas** (riesgo, POIs, rutas) | ✅ **Cumplido** | Riesgo + ruta segura + ruta directa + recorrido + corredores + **capa de POIs** (OSM: policía, salud, educación, transporte…; `/pois`, toggle "Lugares"). Supera las 3 capas con puntos de interés. |
| **OE4** | Evaluación en **≥5 escenarios**, cuali+cuanti | ✅/🟡 | **45 escenarios** (hora×umbral×look-ahead) cuantitativos + efectividad de alerta. Cuantitativo cubierto; falta el componente cualitativo. |
| OE4 | **Mejora de percepción de seguridad ≥30%** | 🟡 **Proxy medido** | La encuesta de percepción no aplica con datos simulados → se usa un **proxy objetivo**. **Barrido O-D sistemático hecho** (`scripts/oe4_od_sweep.py`, 40 O-D × 5 horas = 200 rutas): la ruta segura **reduce la exposición en el 85% de los casos**, con **+1.9%** de distancia; magnitud **media 3.4%** (máx 12.2%). Honesto: la reducción media es **modesta** porque el mapa de riesgo es relativamente uniforme; el efecto es consistente pero pequeño. El "≥30%" de *percepción* queda como estudio con usuarios (trabajo futuro). CSV: `artifacts/eval/oe4_od_sweep.csv`. |
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

1. **Validación del modelo de riesgo (OE2).** *No depende de DIJIN* (el anteproyecto no lo compromete).
   *Acción concreta:* validar el mapa RTM contra los **homicidios georreferenciados abiertos** ya
   disponibles (precisión/recall/F1 de "zona de alto riesgo" vs. hechos reales). DIJIN (petición ya
   radicada) sería granularidad extra, no un bloqueante.
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

## Ruta a 100% (checklist para cerrar la tesis)

> Lo que falta para poder marcar cada indicador como ✅ y pasar a **documentar**. Ordenado por impacto.

- [ ] **OE2 — validación del riesgo (SIN depender de DIJIN).** Validar el mapa RTM contra los
      **homicidios georreferenciados abiertos** (datos.gov.co) que ya se tienen: ¿coinciden las zonas
      de alto riesgo con los hechos reales? → reportar **precisión/recall/F1** del mapa de riesgo.
      El anteproyecto lo permite (habla de "análisis de datos históricos" y "eventos simulados", no de
      DIJIN). El microdato DIJIN (petición radicada) sería un refuerzo de mayor granularidad, no un
      requisito para cerrar OE2.
- [ ] **OE4 — barrido O-D del proxy.** Correr la ruta segura vs. directa sobre un conjunto fijo de
      ~30–50 pares origen-destino y reportar la **reducción media de exposición** (el motor ya la
      calcula; falta el script batch y la tabla). Cierra el indicador de "≥30%".
- [ ] **OE3 — capa de POIs.** Añadir una capa de puntos de interés al mapa para cumplir "≥3 capas
      con POIs" de forma literal.
- [ ] **OE1 — informe de caracterización.** Redactar en la tesis (TrajCL/TRACLUS/Fréchet ya hechos).
- [ ] **OE4 — informe de QA.** Cobertura de pruebas + tasa de errores para el "95% de funcionalidad".
- [ ] **Componente cualitativo de OE4.** Declararlo como trabajo futuro o mini-encuesta de usabilidad.

### Sobre "¿el modelo aprende con el uso?" (aclaración honesta)

El indicador de OE1 es **precisión >85%**, y está **cumplido (90%)**. El modelo es de **recuperación
incremental**: no reentrena, pero su base de conocimiento **crece con cada trayectoria observada**
(añadir un viaje = más cobertura). En el **producto** (app real) cada viaje de la comunidad lo mejora;
en la **demo** los datos son simulados (SUMO), así que ese "aprendizaje con el uso" es una capacidad
del producto, no un indicador de la tesis. Declararlo así es correcto y no infla resultados.

## Veredicto

**¿Ya cumplimos?** Parcialmente y bien encaminados: **OE1 cumplido y superado**, **OE4 cuantitativo
cumplido**, **OE2/OE3 con base construida pero con vacíos declarables**. El núcleo pendiente para
"cerrar" la promesa central es **(a) el ruteo seguro ponderado por riesgo** y **(b) la validación del
riesgo con microdato**. Ambos están al alcance y, declarados con honestidad, **fortalecen** la defensa.
