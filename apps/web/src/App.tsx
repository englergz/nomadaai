import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
  FeatureCollection as ApiFC,
  HealthResponse,
  TripSummary,
} from "@nomadaai/shared";
import { api } from "./lib/api";
import { osmStyle, TUMACO_CENTER, TUMACO_ZOOM } from "./lib/mapStyle";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

// El ícono/animación depende del TIPO REAL del viaje (una moto circula por calles
// donde no entran carros; eso ya lo respeta la trayectoria real de ese tipo).
function iconForType(t?: string): string {
  switch ((t ?? "").toLowerCase()) {
    case "mot": return "🏍️";
    case "bus": return "🚌";
    case "truck": return "🚚";
    case "taxi": return "🚕";
    default: return "🚗";
  }
}
function labelForType(t?: string): string {
  switch ((t ?? "").toLowerCase()) {
    case "mot": return "Motocicleta";
    case "bus": return "Bus";
    case "truck": return "Camión";
    case "taxi": return "Taxi";
    case "car": return "Carro";
    default: return t ?? "Vehículo";
  }
}

export default function App() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const vehMarkerRef = useRef<maplibregl.Marker | null>(null);
  // refs del bucle en vivo
  const coordsRef = useRef<[number, number][]>([]);
  const idxRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const lastPredRef = useRef(0);
  const alertedRef = useRef(false);
  const runningRef = useRef(false);
  const typeRef = useRef("car");
  const clockRef = useRef(0); // segundos desde medianoche (reloj de la simulación)
  const speedRef = useRef(8.3); // m/s (~30 km/h)

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [tripId, setTripId] = useState("");
  const [hour, setHour] = useState(20);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [predInfo, setPredInfo] = useState<string>("—");
  const [clock, setClock] = useState<number>(20 * 3600);
  const [liveRisk, setLiveRisk] = useState<number | null>(null);
  const [notif, setNotif] = useState<{ title: string; body: string } | null>(null);
  const [finished, setFinished] = useState(false);

  const selectedTrip = trips.find((t) => t.id === tripId);
  const vehIcon = iconForType(selectedTrip?.type);

  // init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: osmStyle,
      center: TUMACO_CENTER,
      zoom: TUMACO_ZOOM,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "bottom-right");

    map.on("load", async () => {
      try {
        const fc = (await api.corridors(undefined, 8000)) as ApiFC;
        map.addSource("corridors", { type: "geojson", data: fc as never });
        map.addLayer({
          id: "corridors",
          type: "line",
          source: "corridors",
          paint: { "line-color": "#9aa7b2", "line-width": 1, "line-opacity": 0.22 },
        });
      } catch (e) {
        console.error(e);
      }
      // capa de riesgo (heatmap espacio-temporal, cambia con la hora)
      map.addSource("risk", { type: "geojson", data: emptyFC() as never });
      map.addLayer({
        id: "risk",
        type: "heatmap",
        source: "risk",
        paint: {
          "heatmap-weight": ["get", "risk_norm"],
          "heatmap-radius": 38,
          "heatmap-intensity": 1.1,
          "heatmap-opacity": 0.6,
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(0,0,0,0)",
            0.3, "#2dd4bf",
            0.55, "#fde047",
            0.78, "#fb923c",
            1, "#ef4444",
          ],
        },
      } as never);
      addLine(map, "observed", { "line-color": "#2f81f7", "line-width": 5 });
      addLine(map, "pred", { "line-color": "#f97316", "line-width": 4, "line-dasharray": [1.5, 1] });
      // zona de incidencia DINÁMICA (se reubica/actualiza en cada paso)
      addPoint(map, "danger", {
        "circle-radius": 16,
        "circle-color": "#ef4444",
        "circle-opacity": 0.28,
        "circle-stroke-color": "#ef4444",
        "circle-stroke-width": 2,
      });
      loadRisk(map, hour);
    });

    api.health().then(setHealth).catch(console.error);
    api.tripsSample(40).then((r) => { setTrips(r.trips); if (r.trips[0]) setTripId(r.trips[0].id); }).catch(console.error);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      map.remove();
    };
  }, []);

  async function loadRisk(map: maplibregl.Map, h: number) {
    try {
      const base = import.meta.env.VITE_API_URL ?? "";
      const data = await fetch(`${base}/risk/zones?hour=${h}`).then((r) => r.json());
      (map.getSource("risk") as maplibregl.GeoJSONSource | undefined)?.setData(data);
    } catch (e) {
      console.error("risk:", e);
    }
  }

  function stopSim() {
    runningRef.current = false;
    setRunning(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function startSim() {
    const map = mapRef.current;
    if (!map || !tripId) return;
    stopSim();
    setFinished(false);
    setNotif(null);
    setLiveRisk(null);
    setPredInfo("Detectando movimiento…");
    alertedRef.current = false;
    lastPredRef.current = 0;
    idxRef.current = 0;
    typeRef.current = selectedTrip?.type ?? "car";
    clockRef.current = hour * 3600;
    setClock(clockRef.current);
    setLine(map, "observed", []);
    setLine(map, "pred", []);
    setPoint(map, "danger", null);

    let coords: [number, number][] = [];
    try {
      const t = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/trajectories/${encodeURIComponent(tripId)}/track`).then((r) => r.json());
      coords = t.coords;
    } catch (e) {
      alert("No pude cargar el recorrido: " + (e as Error).message);
      return;
    }
    if (coords.length < 4) return;
    coordsRef.current = coords;
    await loadRisk(map, hour);
    map.flyTo({ center: coords[0], zoom: 15, duration: 800 });

    // marcador del vehículo (ícono según el tipo real del viaje)
    if (!vehMarkerRef.current) {
      const el = document.createElement("div");
      el.className = "veh-marker";
      vehMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat(coords[0]).addTo(map);
    }
    vehMarkerRef.current.getElement().textContent = iconForType(typeRef.current);
    vehMarkerRef.current.setLngLat(coords[0]);

    runningRef.current = true;
    setRunning(true);
    const step = Math.max(1, Math.floor(coords.length / 180)); // ~180 ticks
    timerRef.current = window.setInterval(() => tick(step), 70);
  }

  async function tick(step: number) {
    const map = mapRef.current;
    if (!map || !runningRef.current) return;
    const coords = coordsRef.current;
    const prev = idxRef.current;
    idxRef.current = Math.min(coords.length, idxRef.current + step);
    const i = idxRef.current;
    const acc = coords.slice(0, i);
    setProgress(Math.round((i / coords.length) * 100));
    // el reloj avanza con la distancia recorrida (a la velocidad del vehículo)
    let moved = 0;
    for (let k = Math.max(1, prev); k < i; k++) moved += haversine(coords[k - 1], coords[k]);
    clockRef.current += moved / speedRef.current;
    setClock(clockRef.current);
    // el sistema "detecta movimiento" y va capturando la trayectoria
    vehMarkerRef.current?.setLngLat(coords[i - 1]);
    setLine(map, "observed", acc);

    // re-predicción ONLINE cada ~450 ms con lo capturado hasta ahora
    const now = performance.now();
    if (acc.length >= 4 && now - lastPredRef.current > 450) {
      lastPredRef.current = now;
      try {
        const res = await api_online(acc, typeRef.current, clockRef.current, tripId, speedRef.current);
        const cand = res.candidates?.[0];
        if (cand) setLine(map, "pred", cand.geometry.coordinates as [number, number][]);
        const a = res.alert;
        if (a) {
          setLiveRisk(a.risk_norm);
          setPredInfo(
            `Ruta probable: ${cand ? cand.length_m.toFixed(0) : "?"} m · riesgo de la zona ${(a.risk_norm * 100).toFixed(0)}%`
          );
          // zona de incidencia DINÁMICA: se reubica en cada paso según la predicción
          if (a.is_high) {
            setPoint(map, "danger", [a.lon, a.lat]);
            if (!alertedRef.current) {
              alertedRef.current = true;
              const eta = `${String(a.hour).padStart(2, "0")}:${String(a.arrival_min ?? 0).padStart(2, "0")}`;
              setNotif({
                title: "⚠️ Alerta de seguridad — NómadaAI",
                body: `Tu ruta probable entra en una zona de alto riesgo a ~${a.distance_m.toFixed(0)} m; llegarías a las ${eta} (${(a.eta_s ?? 0).toFixed(0)} s). Considera un desvío.`,
              });
            }
          } else {
            setPoint(map, "danger", null);
          }
        }
      } catch (e) {
        console.error("online:", e);
      }
    }

    if (i >= coords.length) {
      stopSim();
      setFinished(true);
      setProgress(100);
    }
  }

  return (
    <>
      <div id="map" ref={containerRef} />

      {/* Panel de control */}
      <div className="panel">
        <h1>NómadaAI</h1>
        <p className="subtitle">Simulación de navegación · Tumaco, Nariño</p>
        <div className="status">
          {health
            ? `${(health.n_test ?? 0).toLocaleString()} viajes NO vistos por el modelo · riesgo dinámico`
            : "Conectando…"}
        </div>

        {running && (
          <div className="clock">🕒 {fmtClock(clock)}</div>
        )}

        <h2>Recorrido simulado</h2>
        <label className="lbl">Viaje no visto (se reproduce como tu GPS en vivo)</label>
        <select className="select" value={tripId} onChange={(e) => setTripId(e.target.value)} disabled={running}>
          {trips.map((t) => (
            <option key={t.id} value={t.id}>{iconForType(t.type)} {labelForType(t.type)} · {t.id} ({t.n_points} pts)</option>
          ))}
        </select>
        {selectedTrip && (
          <p className="hint" style={{ marginTop: 6 }}>
            <b>{vehIcon} {labelForType(selectedTrip.type)}</b> · <span className="tag-unseen">no visto</span> — el modelo nunca indexó este viaje (prueba sin sesgo).
          </p>
        )}

        <label className="lbl">Hora del día (riesgo dinámico)</label>
        <select className="select" value={hour} onChange={(e) => { const h = Number(e.target.value); setHour(h); if (mapRef.current) loadRisk(mapRef.current, h); }} disabled={running}>
          {HOURS.map((h) => (
            <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
          ))}
        </select>

        {!running ? (
          <button onClick={startSim} disabled={!tripId}>▶ Iniciar simulación</button>
        ) : (
          <button className="secondary" onClick={stopSim}>■ Detener</button>
        )}

        <div className="progress"><div className="bar" style={{ width: `${progress}%` }} /></div>
        <p className="hint">{predInfo}</p>
        {finished && <p className="badge">✓ Recorrido finalizado</p>}

        <p className="legend">
          <span className="dot blue" /> capturado &nbsp;
          <span className="dot orange" /> predicho &nbsp;
          <span className="dot red" /> zona de riesgo
        </p>
      </div>

      {/* Simulador de móvil */}
      <div className="phone">
        <div className="phone-notch" />
        <div className="phone-screen">
          <div className="phone-status">{running || finished ? fmtClock(clock) : `${String(hour).padStart(2, "0")}:00`} · NómadaAI</div>
          <div className="phone-veh">{vehIcon}</div>
          <div className="phone-sub">
            {running ? "Navegando…" : finished ? "Recorrido finalizado" : "En espera"}
          </div>
          {liveRisk != null && (
            <div className={`risk-pill ${liveRisk >= 0.5 ? "hi" : ""}`}>
              Riesgo de la zona: {(liveRisk * 100).toFixed(0)}%
            </div>
          )}
          {notif && (
            <div className="push">
              <div className="push-title">{notif.title}</div>
              <div className="push-body">{notif.body}</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Llamada directa al endpoint de predicción online (streaming)
async function api_online(
  acc: [number, number][],
  type: string,
  tSeconds: number,
  tripId: string,
  speedMps: number
) {
  const base = import.meta.env.VITE_API_URL ?? "";
  const res = await fetch(`${base}/predict/online`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      points: acc.map(([lon, lat], i) => ({ lon, lat, t: i })),
      type,
      t_seconds: tSeconds,
      speed_mps: speedMps,
      threshold: 0.7,
      exclude_id: tripId,
      topk: 1,
    }),
  });
  if (!res.ok) throw new Error(`online ${res.status}`);
  return res.json();
}

function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function fmtClock(sec: number): string {
  const s = ((sec % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

// ---------- helpers de mapa ----------
function addLine(map: maplibregl.Map, id: string, paint: Record<string, unknown>) {
  map.addSource(id, { type: "geojson", data: emptyFC() as never });
  map.addLayer({ id, type: "line", source: id, layout: { "line-cap": "round", "line-join": "round" }, paint } as never);
}
function addPoint(map: maplibregl.Map, id: string, paint: Record<string, unknown>) {
  map.addSource(id, { type: "geojson", data: emptyFC() as never });
  map.addLayer({ id, type: "circle", source: id, paint } as never);
}
function emptyFC() {
  return { type: "FeatureCollection", features: [] };
}
function setLine(map: maplibregl.Map, id: string, coords: [number, number][]) {
  const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  src?.setData(
    coords.length >= 2
      ? ({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} } as never)
      : (emptyFC() as never)
  );
}
function setPoint(map: maplibregl.Map, id: string, coord: [number, number] | null) {
  const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  src?.setData(
    coord
      ? ({ type: "Feature", geometry: { type: "Point", coordinates: coord }, properties: {} } as never)
      : (emptyFC() as never)
  );
}
