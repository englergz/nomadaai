# Plan para perfeccionar Nómada.AI (modelo robusto + producto)

> Hoja de ruta para: (1) un **modelo de riesgo defendible y citable**, y (2) el **producto/app**
> (Android/iOS) escalable y replicable a otras ciudades. Cada factor de riesgo va con su respaldo.

---

## Parte A — Modelo de riesgo robusto y defendible

### A.1 Principio: Risk Terrain Modeling (RTM)
Combinamos **factores del territorio** (no incidentes puntuales, que no tenemos) en un índice por
celda. Marco: **Caplan & Kennedy (2011)**. Esto es lo correcto ante escasez de microdato.

### A.2 Factores propuestos (cada uno con evidencia)
| Factor | Señal | Efecto | Respaldo citable | Fuente de dato |
|--------|-------|--------|------------------|----------------|
| **Iluminación** | calles con poca/nula luz | ↑ riesgo | **Welsh & Farrington (2008)** meta-análisis Cochrane: mejor alumbrado ↓ delito ~21% | OSM `highway=street_lamp`, `lit=yes/no` (Overpass) |
| **Periferia / aislamiento** | lejos del centro, baja vigilancia | ↑ riesgo | **Jacobs (1961)** "ojos en la calle"; **Newman (1972)** espacio defendible | distancia al centroide (ya) |
| **Densidad poblacional** | más gente/objetivos | ↑ exposición | **Cohen & Felson (1979)** actividades rutinarias; Brender (2012) | DANE manzana (ya) |
| **Actividad/tráfico** | concurrencia | ± (matiz) | actividades rutinarias | trayectorias SUMO (ya) |
| **Generadores/atractores** | bares, expendios, cantinas | ↑ riesgo | **Brantingham & Brantingham (1995)** crime generators/attractors | OSM `amenity=bar/pub/nightclub` (ya bajamos POIs) |
| **Presencia estatal** | lejos de policía/instituciones | ↑ riesgo | CEDRE (2024): débil presencia estatal en periferia | OSM `amenity=police`; distancia |
| **Infraestructura precaria** | paredes madera, hacinamiento, sin servicios | ↑ vulnerabilidad | **Shaw & McKay (1942)** desorganización social; CEDRE (2024) NBI | CEDRE por zona (7 zonas) / DANE |
| **Temporal (hora/día)** | noche/madrugada, fines de semana | ↑ riesgo | **INMLCF – Forensis** (patrón horario de homicidios en Colombia) ← *conseguir y citar* | Forensis (Medicina Legal) |

### A.3 Índice y calibración
- Índice = Σ wᵢ · norm(Fᵢ), pesos **editables por CLI** (`rebuild_risk_full.py --w-…`); hoy densidad
  0.40 / actividad 0.25 / periferia 0.35. Se añadirán iluminación, POIs de riesgo, distancia a policía.
- **Normalización por percentil espacial** (evita que todo se vea rojo) + modulación temporal.
- **Análisis de sensibilidad** (ya) para robustez del ranking.

### A.4 Curva temporal (pendiente clave)
Hoy es **supuesto**. Acciones: (a) obtener el patrón horario/diario de **Forensis (INMLCF)** o un
estudio revisado por pares y citarlo; (b) si no, dejarla como **parámetro de escenario** explícito,
sin afirmar una curva validada. Piso nocturno ya aplicado (la violencia no se anula de madrugada).

### A.5 Validación
- **Con lo que hay:** caracterización real (arma/modalidad), sensibilidad, coherencia con CEDRE.
- **Cuando llegue DIJIN:** precisión/recall/F1 espacial → cierra el ≥85%.
- **Reporte ciudadano** (app): calibración continua con datos comunitarios (participativo).

---

## Parte B — Producto / App móvil (Android · iOS)

### B.1 Stack
- **Expo / React Native**, reutilizando la **API FastAPI** y **Clerk** (SDK móvil). Un solo backend
  para web y móvil. Mapas: MapLibre Native.

### B.2 Vista principal
- Mapa en vivo + **navegación segura** (turn-by-turn), capa de riesgo (toggle), ruta segura vs directa.
- Barra inferior: destino, prioridad de seguridad, hora. Botón grande "Ir seguro".

### B.3 Notificaciones (3 tipos, no confundir)
1. **Alertas de proximidad (locales):** al acercarse a una zona de alto riesgo en la ruta.
   **Una sola vez por zona** (ya corregido en web). Silencio configurable.
2. **Push (servidor):** incidente reportado cerca, cambio de riesgo por hora, alerta comunitaria.
3. **Banners flotantes in-app:** estado ("generando ruta", "ruta segura −X%"), no intrusivos.

### B.4 Reporte de incidentes (clave)
- El usuario reporta: tipo (robo, riña, iluminación dañada, presencia sospechosa), ubicación, foto,
  hora. → alimenta el modelo (**participativo**, Arteaga Botello 2005) y **llena el vacío de datos**.
- Moderación/anti-abuso: rate-limit, verificación, agregación (no exponer reportes crudos).

### B.5 Escalable / replicable a otras ciudades
- **Config por ciudad** (`city`): dataset de trayectorias + malla de riesgo + POIs + bbox. Cambiar de
  ciudad = cambiar datos, no código. La DB ya tiene columna `city`.
- Onboarding de una ciudad nueva: (1) trayectorias/OD, (2) DANE manzana, (3) OSM (luz, POIs, policía),
  (4) rebuild del índice, (5) publicar.

### B.6 Validaciones y seguridad (implementar bien desde ya)
- **Entrada:** validar todos los payloads (Pydantic en API; esquemas en cliente).
- **Auth:** Clerk (verificación de token en escritura — ya). Roles a futuro (usuario/moderador).
- **Permisos móviles:** ubicación (en uso/segundo plano), notificaciones — pedir en contexto.
- **Datos:** integridad de reportes, deduplicación, rate-limit, RLS/row-level en DB por usuario.
- **Privacidad:** anonimizar, cumplir Ley 1581/2012; no rastrear sin consentimiento.

---

## Roadmap por fases
1. **Modelo v2 (corto):** añadir **iluminación** (OSM) + POIs de riesgo + distancia a policía; recalibrar.
   Conseguir la curva temporal de Forensis o declararla escenario.
2. **Cierre tesis:** validación (sensibilidad + caracterización), documentar, defender.
3. **App MVP:** Expo + API + Clerk; vista principal, navegación, alertas de proximidad, reporte de incidentes.
4. **Producto:** push server, moderación de reportes, multi-ciudad, panel BI, validaciones completas.

## Referencias nuevas a citar
- Welsh, B. C., & Farrington, D. P. (2008). *Effects of improved street lighting on crime.* Campbell/Cochrane.
- Brantingham, P. & Brantingham, P. (1995). *Criminality of place: crime generators and crime attractors.*
- INMLCF — *Forensis: Datos para la vida* (patrón temporal de homicidios en Colombia).
- (Ya en `VALIDACION_RIESGO.md`): Caplan & Kennedy 2011; Jacobs 1961; Newman 1972; Cohen & Felson 1979;
  Shaw & McKay 1942; Bámaca/Brender 2014; CEDRE 2024.
