# Modelo de riesgo delictivo por zonas (OE2): fundamentación, enriquecimiento y citas

> Documento de avance del Trabajo de Grado *NómadaAI: aplicación inteligente para la gestión
> segura de rutas urbanas mediante análisis de datos en tiempo real en el Distrito de Tumaco,
> Nariño* (Maestría en Gestión de Tecnologías de la Información y del Conocimiento, Universidad
> de Nariño). Autor: Engler González Prado. Director: PhD. Andrés Oswaldo Calderón Romero.

> **Nota de uso.** Las referencias citadas a continuación son obras canónicas y verificables de la
> criminología ambiental; se incluyen para que el autor las contraste y formatee según la norma de
> citación del programa (APA 7.ª) antes de incorporarlas al documento final. Los **pesos** del
> modelo son una decisión de modelado declarada y calibrable; lo que la literatura respalda es la
> **selección y la dirección** de cada factor, no un coeficiente numérico específico.

## 1. Propósito

El segundo objetivo específico (OE2) busca **estimar el riesgo delictivo por zonas** del Distrito
de Tumaco como insumo para la recomendación de rutas seguras (OE3). Este documento fundamenta, con
base en la literatura, por qué el riesgo de una zona depende de variables como la densidad
poblacional, la dotación de infraestructura y servicios, y el momento del día; y describe cómo se
operacionaliza el modelo a partir de **fuentes de datos reales** (no supuestos), declarando con
honestidad sus límites.

## 2. Fundamentación teórica (extiende el marco ya planteado en el anteproyecto)

El anteproyecto aprobado ya enmarca el sistema en las **teorías de actividades rutinarias** y la
**prevención situacional del delito**. Sobre esa base, el modelo de riesgo incorpora de manera
coherente las siguientes corrientes de la **criminología ambiental**:

- **Teoría de las Actividades Rutinarias** (Cohen y Felson, 1979). El delito ocurre cuando
  convergen en el espacio y el tiempo un *ofensor motivado*, un *objetivo adecuado* y la *ausencia
  de un guardián capaz*. Justifica que el riesgo varíe por **zona y por hora** (la convergencia no
  es uniforme en el día) y que la **densidad de actividad/población** eleve la exposición.
- **Teoría de la Desorganización Social** (Shaw y McKay, 1942) y **Eficacia Colectiva** (Sampson,
  Raudenbush y Earls, 1997). Las zonas con menor cohesión social y **déficit de infraestructura,
  servicios e institucionalidad** presentan mayor incidencia delictiva. Fundamenta el uso de
  indicadores socioeconómicos y de cobertura de servicios como variables de riesgo.
- **Teoría del Patrón Delictivo** (Brantingham y Brantingham, 1984) y **puntos calientes / hot
  spots** (Sherman, Gartin y Buerger, 1989). El delito se concentra en lugares y corredores
  específicos; respalda la **zonificación** y el cruce con los corredores de movilidad (OE1).
- **Prevención del delito mediante el diseño ambiental — CPTED** (Jeffery, 1971; Newman, 1972,
  *Defensible Space*) y **Ventanas Rotas** (Wilson y Kelling, 1982). Vinculan el deterioro del
  entorno construido y del espacio público con la probabilidad de incidentes; sustentan la
  inclusión de variables de infraestructura/urbanismo y la lectura del riesgo como algo
  *intervenible*, en línea con la vocación social del proyecto.

## 3. Factores de riesgo y su operacionalización con datos reales

Cada factor se justifica en la teoría (sección 2) y toma su **valor de una fuente verificable**:

| Factor | Sustento teórico | Fuente de dato real | Dirección |
|--------|------------------|---------------------|-----------|
| Historial de incidentes por zona | Hot spots; patrón delictivo | Policía Nacional / datos.gov.co (homicidios, hurtos; municipio Tumaco 52835) | + |
| Densidad poblacional | Actividades rutinarias | DANE — Marco Geoestadístico Nacional (secciones/zonas urbanas) y Censo | + |
| Déficit de servicios e infraestructura | Desorganización social; CPTED | DNP — TerriData (cobertura de servicios, NBI/pobreza, indicadores de desarrollo) | + |
| Hora del día | Actividades rutinarias (convergencia temporal) | Curva horaria (ver §5) | modula |

**Forma del índice (transparente y calibrable):**

```
riesgo(zona, hora) = curva_horaria(hora) · ( w1·incidentes_norm
                                            + w2·densidad_norm
                                            + w3·deficit_servicios_norm
                                            + w4·deterioro_urbano_norm )
```

Los pesos `w1..w4` se declaran explícitamente y se calibran; las variables se normalizan a [0,1].
La estructura es **interpretable y defendible**: cada término rastrea a una teoría y a una fuente.

## 4. Zonificación

La unidad de análisis es la **zona** (malla regular sobre la red de Tumaco), generada por
`Research/analysis_v2/build_zonification.py`, parametrizable mediante `--cell`. Para "el mayor
detalle posible" se reduce el tamaño de celda (más zonas), respetando que cada zona conserve un
mínimo de soporte de datos para que el índice sea estable. La capa se publica como polígonos
(GeoJSON, EPSG:4326) para su despliegue sobre el mapa.

> **Pendiente de coordinación (línea de modelo / Cowork):** unificar el identificador `cell_id`
> entre la malla de polígonos y la tabla de riesgo horario (hoy difieren), para poder representar
> el mapa de calor **por polígonos de zona** y no solo por centroides.

## 5. La dimensión temporal y su honestidad metodológica

El riesgo no es estático: el modelo emplea una **curva horaria** `riesgo(zona, hora)` que modula el
índice según el momento del día (coherente con la teoría de actividades rutinarias). A la fecha,
esta curva es un **supuesto informado por la literatura**, no un dato microlocal de Tumaco, porque
las bases públicas no publican la hora del hecho. Se declara abiertamente como supuesto y queda
**aislada en una sola función**, lista para recalibrarse si se obtiene el microdato con hora (p. ej.
vía DIJIN). Esta transparencia es parte de la validez del trabajo.

## 6. Articulación con OE1 y OE3 (alerta anticipada)

El riesgo por zona y hora se integra con la **predicción de desplazamiento** (OE1) para producir la
contribución central del sistema: la **alerta anticipada**. A medida que se capta la trayectoria en
tiempo real, el sistema predice la ruta probable hacia adelante (*look-ahead*), evalúa el riesgo de
las zonas que se alcanzarán a la hora estimada de llegada y **avisa antes** de ingresar a una zona
de alto riesgo, sugiriendo un desvío. Esto materializa lo prometido en el anteproyecto
(«recomienda rutas más seguras y emite alertas en tiempo real cuando una trayectoria cruza zonas y
horarios críticos»).

## 7. Carácter replicable

El procedimiento —red vial → trayectorias → zonificación → superficie de riesgo a partir de datos
locales → ruteo anticipatorio— es **independiente de la ciudad**. Tumaco es el caso de estudio que
delimita la investigación; el mismo marco aplica a cualquier territorio que disponga de (a)
cartografía/red vial, (b) trayectorias o GPS y (c) datos locales de incidentes. Se propone declarar
esta generalidad como **contribución metodológica** (un marco replicable), no como una solución
particular.

## Referencias (verificar y formatear en APA 7.ª)

- Brantingham, P. J., & Brantingham, P. L. (1984). *Patterns in Crime*. Macmillan.
- Cohen, L. E., & Felson, M. (1979). Social Change and Crime Rate Trends: A Routine Activity
  Approach. *American Sociological Review, 44*(4), 588–608.
- Jeffery, C. R. (1971). *Crime Prevention Through Environmental Design*. Sage.
- Newman, O. (1972). *Defensible Space: Crime Prevention Through Urban Design*. Macmillan.
- Sampson, R. J., Raudenbush, S. W., & Earls, F. (1997). Neighborhoods and Violent Crime: A
  Multilevel Study of Collective Efficacy. *Science, 277*(5328), 918–924.
- Shaw, C. R., & McKay, H. D. (1942). *Juvenile Delinquency and Urban Areas*. University of Chicago Press.
- Sherman, L. W., Gartin, P. R., & Buerger, M. E. (1989). Hot Spots of Predatory Crime: Routine
  Activities and the Criminology of Place. *Criminology, 27*(1), 27–56.
- Wilson, J. Q., & Kelling, G. L. (1982). Broken Windows: The Police and Neighborhood Safety.
  *The Atlantic Monthly, 249*(3), 29–38.

> **Recomendación:** complementar con fuentes **locales y nacionales** (estudios sobre violencia
> urbana en Colombia y en Tumaco/Nariño) para anclar el marco al contexto; dejar dichas entradas
> como pendientes a documentar y no incluir ninguna referencia que no haya sido verificada.
