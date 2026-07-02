# Crítica dura y puntos de mejora (sin sesgo)

> Autocrítica **objetiva** del trabajo, científico-analítica y como producto comercial. El objetivo
> es **encontrar las grietas**, no defenderlas. Declararlas con honestidad fortalece la tesis y ordena
> el producto. Política: cada afirmación que sostenemos con literatura debe apoyarse en **2-4
> referencias (IEEE)**, no una sola (ver §4).

---

## 1. Críticas científico-analíticas (las que más duelen)

1. **El modelo de riesgo NO está validado contra verdad-terreno.** Es un índice teórico-compuesto;
   no hay precisión/recall contra incidentes reales (no hay microdato georreferenciado). El análisis
   de sensibilidad prueba que el *ranking* es **robusto**, no que sea **correcto**. Es la debilidad #1.
2. **Los pesos de los factores son fijados a mano** (0,35/0,30/0,20/0,15). "Editables por CLI" no los
   hace correctos: los hace **suposiciones parametrizadas**. No hay ajuste guiado por datos.
3. **La hipótesis "periferia = más riesgo" no está validada** y podría estar invertida. Pasamos de
   "densidad" a "periferia" por teoría + intuición local, pero **ambas son hipótesis sin probar**.
   Elegimos entre teorías rivales sin dato que arbitre.
4. **El 90% de OE1 está probablemente inflado.** Es sobre trayectorias **SUMO simuladas**, mucho más
   regulares y repetitivas que GPS real. Un k-vecinos sobre un corpus pequeño y repetitivo
   "memoriza" rutas. En calle real, con ruido GPS y rutas nuevas, **bajaría**. No hay validación con
   datos reales.
5. **Casi todo deriva de un solo dataset sintético (SUMO).** La predicción, el grafo de rutas y el
   factor "actividad" del riesgo salen de las mismas trayectorias. Hay **circularidad**: se evalúa el
   sistema con el mundo que el propio dataset define.
6. **El patrón horario es nacional, transferido a Tumaco.** El día sí es local (dato propio), pero la
   curva por hora asume que Tumaco sigue el promedio colombiano — la violencia de conflicto armado
   puede tener otra dinámica horaria que el homicidio nacional (riñas, etc.).
7. **OE4 (−6,8%) es un proxy de un proxy.** Mide reducción de exposición contra una superficie de
   riesgo **no validada**. Es internamente consistente, no externamente válido.
8. **Sin estadística inferencial.** Todo son estimaciones puntuales: no hay **intervalos de confianza**
   ni **pruebas de significancia** en el 90%, el 6,8% ni las correlaciones.
9. **Una sola ciudad, sin validación externa.** La "replicabilidad" se **afirma**, no se demuestra:
   nunca se corrió en una segunda ciudad.
10. **Datos desactualizados/limitados.** Censo DANE 2018 (7 años); homicidios sin hora ni coordenadas;
    OSM sin iluminación. La base empírica intra-urbana es débil.

## 2. Críticas como producto comercial

1. **Cero usuarios reales / cero validación de mercado.** La "efectividad" y el BI corren sobre datos
   simulados o auto-generados. No hay un solo viaje real de un usuario.
2. **La propuesta de valor entrega ~7% de reducción de exposición.** ¿Alcanza para que alguien cambie
   de ruta o pague? Dudoso *product-market fit* con ese margen.
3. **Riesgo ético/legal serio.** Pintar una zona de "verde/seguro" cuando no lo es puede crear **falsa
   seguridad** (daño real, responsabilidad legal). Etiquetar el riesgo por barrio puede **estigmatizar**
   comunidades o ser usado en su contra. En una ciudad en conflicto, es delicado.
4. **El dato es estático** (censo 2018, homicidios históricos). Un producto necesita **actualización
   viva** → depende del bucle de **reporte ciudadano**, que aún no existe.
5. **No hay foso competitivo (moat).** RTM y k-vecinos son estándar. ¿Qué es defendible frente a un
   competidor con más datos?
6. **Costo de onboarding por ciudad.** Cada ciudad requiere ensamblar a mano trayectorias + DANE +
   OSM + policía. No está automatizado → no escala barato.
7. **Privacidad/regulación.** Rastrear movimiento + perfilar riesgo toca Ley 1581/2012; el manejo de
   datos de criminalidad es sensible. Falta el marco de cumplimiento.
8. **La app no existe.** Es una demo web; el producto real (Android/iOS, navegación, reporte) está sin
   construir.
9. **Adopción/confianza sin evidencia.** No hay investigación con usuarios ni con autoridades: no
   sabemos si lo usarían o confiarían.

## 3. ¿Estamos "bien"? Veredicto honesto
- **Como tesis de maestría:** sí, **con la honestidad por delante**. OE1 cumple (con la salvedad del
  dato simulado), OE3 cumple, OE4 tiene proxy medido, y el **aporte real** es el *marco replicable en
  contexto de escasez* + la discusión metodológica. **Declarar las 10 grietas de §1 la fortalece.**
- **Como producto comercial:** **todavía no.** Falta usuarios reales, validación del valor, bucle de
  datos vivo, marco ético/legal y la app. Hoy es un **prototipo de investigación**, no un producto.

## 4. Política de citación (2-4 fuentes por afirmación, IEEE)
Varias afirmaciones hoy penden de **una sola** cita. Hay que **reforzarlas**. Estado:

| Afirmación | Cita actual | Reforzar con (candidatos verificables) |
|------------|-------------|----------------------------------------|
| Densidad/actividad → oportunidad de delito | Cohen & Felson [1] | Brantingham & Brantingham [2]; Sampson et al. [3] |
| Aislamiento/baja vigilancia → violencia | Jacobs [4]; Newman [5] | Shaw & McKay [6]; Sampson et al. [3] |
| Iluminación → delito | Welsh & Farrington [7] | *(reforzar: Painter; Farrington & Welsh; Chalfin et al. — verificar)* |
| RTM como marco ante escasez | Caplan & Kennedy [8] | *(reforzar: Kennedy et al.; Drawve — verificar)* |
| Patrón temporal (noche/domingo) | CEJ 2019 [9]; INMLCF [10] | *(reforzar con 1-2 artículos académicos — verificar)* |
| Pesos locales por zona (GWR) | Fotheringham et al. [11] | *(reforzar: Brunsdon; Cahill & Mulligan — verificar)* |

> **Regla:** no inventar referencias. Las marcadas "verificar" se buscan y confirman antes de citar.

## 5. Mejoras priorizadas (qué atacar y en qué orden)
1. **Reforzar citación** (2-4 por afirmación) en todos los docs — barato, sube el rigor de inmediato.
2. **Intervalos de confianza / significancia** en OE1 y OE4 (bootstrap sobre el held-out y el barrido).
3. **Declarar explícitamente** en la tesis la no-validación del riesgo y el sesgo del dato simulado
   (ya iniciado en `VALIDACION_RIESGO.md` — reforzar).
4. **Prueba de replicabilidad mínima**: correr el pipeline en una 2ª ciudad (aunque sea con datos
   parciales) para pasar de "afirmar" a "demostrar".
5. **Marco ético** (falsa seguridad, estigmatización, privacidad) como sección de la tesis.
6. **Bucle de datos vivo** (reporte ciudadano) + **validación con usuarios** → convierte prototipo en
   producto y habilita GWR/calibración real.

## Referencias (IEEE)
[1] L. E. Cohen and M. Felson, "Social change and crime rate trends: A routine activity approach," *American Sociological Review*, vol. 44, no. 4, pp. 588–608, 1979.
[2] P. L. Brantingham and P. J. Brantingham, "Criminality of place: Crime generators and crime attractors," *European Journal on Criminal Policy and Research*, vol. 3, no. 3, pp. 5–26, 1995.
[3] R. J. Sampson, S. W. Raudenbush, and F. Earls, "Neighborhoods and violent crime: A multilevel study of collective efficacy," *Science*, vol. 277, no. 5328, pp. 918–924, 1997.
[4] J. Jacobs, *The Death and Life of Great American Cities*. New York, NY, USA: Random House, 1961.
[5] O. Newman, *Defensible Space: Crime Prevention Through Urban Design*. New York, NY, USA: Macmillan, 1972.
[6] C. R. Shaw and H. D. McKay, *Juvenile Delinquency and Urban Areas*. Chicago, IL, USA: Univ. of Chicago Press, 1942.
[7] B. C. Welsh and D. P. Farrington, "Effects of improved street lighting on crime: A systematic review," *Campbell Systematic Reviews*, vol. 4, no. 1, pp. 1–51, 2008.
[8] J. M. Caplan, L. W. Kennedy, and J. Miller, "Risk terrain modeling: Brokering criminological theory and GIS methods for crime forecasting," *Justice Quarterly*, vol. 28, no. 2, pp. 360–381, 2011.
[9] Corporación Excelencia en la Justicia, "Reloj de la Criminalidad," Bogotá, Colombia, 2019.
[10] Instituto Nacional de Medicina Legal y Ciencias Forenses, *Forensis: Datos para la Vida*. Bogotá, Colombia.
[11] A. S. Fotheringham, C. Brunsdon, and M. Charlton, *Geographically Weighted Regression*. Chichester, UK: Wiley, 2002.
