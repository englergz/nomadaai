# Modelo de riesgo delictivo por zonas (OE2): fundamentación y variables

> Trabajo de Grado *NómadaAI* — MGTIC, Facultad de Ingeniería, Universidad de Nariño. Autor: Engler
> González Prado. Director: PhD. Andrés Oswaldo Calderón Romero. **Citación: IEEE.** La numeración
> `[n]` coincide con la del anteproyecto aprobado.

Este documento fundamenta el **modelo predictivo de riesgo delictivo por zonas** (Objetivo
Específico 2). El riesgo de una zona no depende únicamente del **historial de incidentes
reportados**: la criminología ambiental sostiene que está condicionado por la **estructura
socioeconómica y física del territorio** (densidad, dotación de servicios e infraestructura,
cohesión social) y por el **momento del día**. El modelo, por tanto, es **multivariable** y se
soporta en literatura verificada.

## 1. Fundamentación teórica

- **Actividades rutinarias y prevención situacional del delito.** El delito surge de la
  convergencia espacio-temporal de un ofensor motivado, un objetivo adecuado y la ausencia de un
  guardián capaz; la incidencia se estructura en patrones espaciales y temporales [6], [7]. Justifica
  que el riesgo varíe por **zona y por hora** y que la **densidad de actividad/población** eleve la
  exposición.
- **Desorganización social y eficacia colectiva.** Las zonas con menor cohesión social y
  **déficit de servicios, infraestructura e institucionalidad** presentan mayor incidencia
  delictiva [2], [22], [23]. Fundamenta el uso de variables socioeconómicas y de cobertura de
  servicios como predictores de riesgo.
- **Factores sociodemográficos del delito en Colombia.** Evidencia nacional sobre la relación entre
  variables sociodemográficas y el comportamiento delictivo [21], en línea con el análisis de la
  criminalidad urbana colombiana [19].
- **Concentración del delito (hot spots) y minería espacio-temporal.** El delito se concentra en
  lugares y corredores específicos [13]; su detección y modelado se apoya en minería de datos
  espacio-temporal [52] y en técnicas de **agrupamiento** aplicadas en el contexto nariñense [50].

## 2. Variables del modelo y su operacionalización con fuentes reales

Cada variable se justifica en la teoría (§1) y toma su valor de una **fuente verificable**; los
**pesos** son una decisión de modelado declarada y **calibrable** (lo que la literatura respalda es
la **selección y la dirección** de cada factor, no un coeficiente numérico específico):

| Variable | Sustento | Fuente de dato | Dir. |
|----------|----------|----------------|------|
| Historial de incidentes por zona | Hot spots [13]; minería ET [52] | Policía Nacional / datos.gov.co (Tumaco 52835) | + |
| Densidad poblacional | Actividades rutinarias [6], [7] | DANE — Marco Geoestadístico Nacional, Censo | + |
| Déficit de servicios / infraestructura | Desorganización social [2], [22], [23] | DNP — TerriData (cobertura de servicios, NBI) | + |
| Privación socioeconómica (pobreza/NBI) | Desorganización social [23]; sociodemografía [21] | DNP — TerriData; DANE | + |
| Hora del día | Convergencia temporal [6], [7] | Curva horaria (§4) | modula |

**Índice (transparente y calibrable):**

```
riesgo(zona, hora) = c(hora) · ( w1·incidentes + w2·densidad + w3·deficit_servicios
                                 + w4·privacion_socioeconomica )       [variables normalizadas a 0..1]
```

La estructura es **interpretable y defendible**: cada término rastrea a una teoría [2], [6], [7],
[13], [21], [22], [23] y a una fuente de dato oficial.

## 3. Zonificación

La unidad de análisis es la **zona** (malla regular sobre la red de Tumaco). Para mayor detalle se
reduce el tamaño de celda (más zonas), conservando un soporte mínimo de datos por zona para que el
índice sea estable. La capa se publica como **polígonos** (GeoJSON, EPSG:4326).

> **Pendiente (línea de modelo):** ampliar la malla para cubrir **todo el territorio del Distrito**
> (no solo donde existen trayectorias) y unificar el identificador de zona entre capas, de modo que
> el mapa de calor por polígonos cubra la totalidad del área de estudio.

## 4. Dimensión temporal y honestidad metodológica

El riesgo es **dinámico**: una curva horaria `c(hora)` modula el índice según el momento del día,
coherente con la teoría de actividades rutinarias [6], [7]. A la fecha, esta curva es un **supuesto
informado por la literatura**, no un microdato local (las bases públicas no publican la hora del
hecho); se declara abiertamente y queda **aislada en una sola función**, lista para recalibrarse si
se obtiene el microdato con hora (p. ej., vía DIJIN). El análisis de sensibilidad muestra que el
riesgo responde a la hora (mínimo nocturno, máximo en la franja de mayor convergencia), lo que
sustenta el motor de alerta de OE3.

## 5. Articulación con OE1, OE3 y OE4

El riesgo `riesgo(zona, hora)` se integra con la predicción de desplazamiento (OE1) para producir la
**alerta anticipada** (OE3): avisar antes de ingresar a una zona de alto riesgo a la hora de
llegada. Su efectividad se caracteriza en OE4 (cobertura, anticipación, respuesta horaria).

## 6. Carácter replicable y contribución

El procedimiento —red vial → trayectorias → zonificación → superficie de riesgo multivariable desde
datos locales → ruteo/alerta anticipatoria— es **independiente de la ciudad**. Tumaco es el caso de
estudio que delimita la investigación; se propone declarar esta generalidad como **contribución
metodológica** (un marco replicable de seguridad urbana basado en datos [1], [19], [29], [30], [51]).

## Referencias (IEEE; numeración del anteproyecto)

- [1] A. Ristea y M. Leitner, "Urban Crime Mapping and Analysis Using GIS," *ISPRS Int. J. Geoinf.*, vol. 9, p. 511, ago. 2020, doi: 10.3390/ijgi9090511.
- [2] C. R. Shaw y H. D. McKay, *Juvenile Delinquency and Urban Areas*. 1942.
- [6] L. Zhang, S. F. Messner y J. Liu, "A Multilevel Analysis of the Risk of Household Burglary in the City of Tianjin, China," *Br. J. Criminol.*, vol. 47, no. 6, pp. 918–937, jul. 2007, doi: 10.1093/bjc/azm026.
- [7] Z. Mao, J. Wu, Z. Zheng, R. Sang y C. Jin, "An empirical study of social disorganization theory in China," *Int. J. Law Crime Justice*, vol. 74, p. 100608, sep. 2023, doi: 10.1016/J.IJLCJ.2023.100608.
- [13] A. A. Braga, A. V. Papachristos y D. M. Hureau, "The Effects of Hot Spots Policing on Crime: An Updated Systematic Review and Meta-Analysis," *Justice Q.*, vol. 31, no. 4, pp. 633–673, jul. 2014, doi: 10.1080/07418825.2012.673632.
- [19] D. Mejía, D. Ortega y K. Ortiz, "Un análisis de la criminalidad urbana en Colombia," CAF, ene. 2015. [En línea]. Disponible: https://scioteca.caf.com/handle/123456789/810
- [21] L. C. Núñez Rivera, F. Tolentino Pulido y H. Rodríguez Barrios, "Factores sociodemográficos en la dinámica del comportamiento delictivo: análisis descriptivo de criminalidad en Colombia, año 2022," *Rev. Criminalidad*, vol. 65, no. 3, pp. 161–185, ene. 2024, doi: 10.47741/17943108.525.
- [22] R. Wickes, "Social Disorganization Theory: Its History and Relevance to Crime Prevention," en *Preventing Crime and Violence*, Cham: Springer, 2017, pp. 57–67, doi: 10.1007/978-3-319-44124-5_6.
- [23] R. J. Sampson y W. B. Groves, "Community Structure and Crime: Testing Social-Disorganization Theory," *Am. J. Sociol.*, vol. 94, no. 4, pp. 774–802, ene. 1989, doi: 10.1086/229068.
- [29] L. E. Sandoval Garrido, C. A. Velásquez Monroy y L. C. Riaño Bermúdez, "Análisis de redes policiales aplicado al control de la delincuencia callejera en Bogotá," *Rev. Econ. Inst.*, vol. 26, no. 50, pp. 145–173, dic. 2023, doi: 10.18601/01245996.v26n50.07.
- [30] R. A. Jiménez Toledo, Á. A. Martínez Navarro, D. E. Cisneros Chamorro y J. C. Cuastumal Rosero, "Sistema de georreferenciación aplicado al Sistema de Gestión de Información y Apoyo … Tránsito y Transporte de Pasto," Pasto, 2016.
- [50] S. R. Timarán-Pereira, G. J. Hernández-Garzón y N. E. Quemá-Taimbud, "Identificación de lesiones no fatales en la cartografía del municipio de Pasto con la técnica de agrupamiento," *Rev. Investig. Desarro. Innov.*, vol. 8, no. 1, pp. 147–159, dic. 2017, doi: 10.19053/20278306.v8.n1.2017.5793.
- [51] J. A. Albaladejo-García y M. Campos-Cotanda, "Descripción del fenómeno delictivo en la ciudad de Murcia a partir de herramientas SIG," *Investig. Geogr.*, no. 67, p. 215, jun. 2017, doi: 10.14198/INGEO2017.67.12.
- [52] S. Shekhar et al., "Spatiotemporal Data Mining: A Computational Perspective," *ISPRS Int. J. Geoinf.*, vol. 4, no. 4, pp. 2306–2338, oct. 2015, doi: 10.3390/ijgi4042306.
