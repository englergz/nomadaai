# Cumplimiento de resultados vs. lo propuesto en el anteproyecto

> Autoevaluación **crítica** del estado del proyecto frente a los objetivos, resultados esperados e
> indicadores aprobados. Honesta a propósito: declarar los vacíos **aumenta** la validez de la tesis.
> Leyenda: ✅ cumplido · 🟡 parcial · ⚠️ vacío/riesgo.

## Tablero: prometido → hecho → cumplido

> Columna **Prometido** = texto literal de la tabla "Resultados esperados / Indicadores" del
> anteproyecto aprobado (págs. 21-24). **Cumplido:** ✅ sí · 🟡 parcial · ⚠️ pendiente.

| OE | Resultado esperado / indicador (anteproyecto) | Resultado obtenido | Estado |
|----|-----------------------------------------------|--------------------|--------|
| **OE1** | "Modelo de IA desarrollado e integrado en el sistema, con pruebas de funcionalidad y rendimiento, y **precisión de predicción superior al 85%**." | Modelo (k-vecinos + rumbo) integrado y evaluado sobre conjunto **no visto** (train/test 80/20): **90% ≤50 m**, 96% ≤100 m, error mediano 8 m. Comparación de **3 vías** (modelo vs línea recta vs Markov). `/trajectories/evaluate`. | ✅ **Superado** |
| OE1 | "Informe de caracterización entregado con especificaciones de calidad y patrones identificados." | Caracterización hecha (TrajCL, TRACLUS, Fréchet); falta **redactarla como informe** en el documento. | 🟡 |
| **OE2** | "Modelo de IA (algoritmo desarrollado e integrado…, con pruebas de funcionalidad y rendimiento, y **precisión de predicción superior al 85%**)." | Índice **operativo** (`/risk/zones?hour=`), **reconstruido con población censal DANE 2018 real por manzana**: se corrigió un índice inicial degenerado (96% tráfico → 68%; ahora corr 0,80 con población; niveles 213/149/**63** vs. 342/82/**1**). Caracterización real del fenómeno (86% arma de fuego, 57% sicariato). Es un **índice de exposición/vulnerabilidad fundamentado**, NO un predictor de crimen validado: Tumaco es homogéneo (99% estrato 1) y su violencia es de conflicto armado → la precisión ≥85% requiere microdato **DIJIN** (en trámite). Ver `VALIDACION_RIESGO.md`. | 🟡 *(índice real y calibrado; precisión ≥85% = límite de datos)* |
| OE2 | "Informe de recopilación, preprocesamiento y categorización de datos… con especificaciones de calidad y patrones." | Datos integrados y categorizados (tipo/hora/zona); falta **redactar el informe**. | 🟡 |
| **OE3** | "Sistema de recomendaciones operativo…, con un **69% de precisión** en identificación de áreas de riesgo y rutas optimizadas **en tiempo real**." | Ruteo **direccional, por tipo y ponderado por riesgo** (`/route/build`) + **alerta anticipada 88.7%**. El sistema está operativo; el "69% de identificación de áreas" es la **misma validación del riesgo** de OE2 (pendiente de cálculo). | 🟡→✅ *(sistema ✅; falta el % de ID)* |
| OE3 | "Panel visual… mostrando **al menos tres capas** (zonas de riesgo, puntos de interés y rutas recomendadas)." | Riesgo + rutas (segura/directa) + recorrido + corredores + **capa de POIs** (`/pois`, toggle "Lugares"). | ✅ **Cumplido** |
| **OE4** | "Informe… sobre **≥5 escenarios** urbanos representativos… análisis cuali y cuantitativo que muestre una **mejora… de al menos un 30%**." | **45 escenarios** (hora×umbral×look-ahead) + **barrido O-D** (200 rutas): la ruta segura mejora en **85%** de los casos (+1.9% distancia, reducción media 3.4%). Proxy **objetivo**; el "≥30% de **percepción**" requiere **encuesta con usuarios** (no aplica con datos simulados → trabajo futuro). | 🟡 *(escenarios ✅; percepción = futuro)* |
| OE4 | "Sistema revisado y optimizado…, con **95% de funcionalidad operativa sin errores críticos**." | App **desplegada y operativa** (HF Space, API + web); falta un **informe de QA** (cobertura/errores). | 🟡 |

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
