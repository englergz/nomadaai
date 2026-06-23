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

type Vehicle = { key: string; label: string; emoji: string };
const VEHICLES: Vehicle[] = [
  { key: "moto", label: "Moto", emoji: "🏍️" },
  { key: "carro", label: "Carro", emoji: "🚗" },
  { key: "rappi", label: "Rappi", emoji: "🛵" },
  { key: "indriver", label: "inDriver/Uber", emoji: "🚙" },
];

const HOURS = Array.from({ length: 24 }, (_, h) => h);

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

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [tripId, setTripId] = useState("");
  const [vehicle, setVehicle] = useState<Vehicle>(VEHICLES[0]);
  const [hour, setHour] = useState(20);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [predInfo, setPredInfo] = useState<string>("—");
  const [notif, setNotif] = useState<{ title: string; body: string } | null>(null);
  const [finished, setFinished] = useState(false);

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
          paint: { "line-color": "#9aa7b2", "line-width": 1, "line-opacity": 0.25 },
        });
      } catch (e) {
        console.error(e);
      }
      // capa de riesgo (heatmap por hora)
      map.addSource("risk", { type: "geojson", data: emptyFC() as never });
      map.addLayer({
        id: "risk",
        type: "heatmap",
        source: "risk",
        paint: {
          "heatmap-weight": ["get", "risk_norm"],
          "heatmap-radius": 34,
          "heatmap-opacity": 0.55,
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
      addPoint(map, "danger", { "circle-radius": 12, "circle-color": "#ef4444", "circle-opacity": 0.35, "circle-stroke-color": "#ef4444", "circle-stroke-width": 2 });
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
    setPredInfo("Detectando movimiento…");
    alertedRef.current = false;
    lastPredRef.current = 0;
    idxRef.current = 0;
    // limpiar capas
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

    // marcador del vehículo
    if (!vehMarkerRef.current) {
      const el = document.createElement("div");
      el.className = "veh-marker";
      vehMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat(coords[0]).addTo(map);
    }
    vehMarkerRef.current.getElement().textContent = vehicle.emoji;
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
    idxRef.current = Math.min(coords.length, idxRef.current + step);
    const i = idxRef.current;
    const acc = coords.slice(0, i);
    setProgress(Math.round((i / coords.length) * 100));
    // mover vehículo + dibujar recorrido observado (lo que el sistema ha "capturado")
    vehMarkerRef.current?.setLngLat(coords[i - 1]);
    setLine(map, "observed", acc);

    // re-predecir cada ~500ms una vez que hay suficiente movimiento
    const now = performance.now();
    if (acc.length >= 4 && now - lastPredRef.current > 500) {
      lastPredRef.current = now;
      try {
        const res = await api_online(acc, vehicle, hour, tripId);
        const cand = res.candidates?.[0];
        if (cand) setLine(map, "pred", cand.geometry.coordinates as [number, number][]);
        const a = res.alert;
        if (a) {
          setPredInfo(
            `Ruta probable: ${cand ? cand.length_m.toFixed(0) : "?"} m · riesgo ${(a.risk_norm * 100).toFixed(0)}%`
          );
          if (a.is_high && !alertedRef.current) {
            alertedRef.current = true;
            setPoint(map, "danger", [a.lon, a.lat]);
            setNotif({
              title: "⚠️ Alerta de seguridad — NómadaAI",
              body: `Zona de alto riesgo en tu ruta a ~${a.distance_m.toFixed(0)} m (~${(a.eta_s ?? 0).toFixed(0)} s) a las ${String(a.hour).padStart(2, "0")}:00. Considera un desvío.`,
            });
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
        <p className="subtitle">Simulación en vivo · Tumaco, Nariño</p>
        <div className="status">
          {health ? `${health.n_trajectories.toLocaleString()} viajes · riesgo por hora` : "Conectando…"}
        </div>

        <h2>Recorrido simulado</h2>
        <label className="lbl">Viaje (GPS en vivo)</label>
        <select className="select" value={tripId} onChange={(e) => setTripId(e.target.value)} disabled={running}>
          {trips.map((t) => (
            <option key={t.id} value={t.id}>{t.type} · {t.id} ({t.n_points} pts)</option>
          ))}
        </select>

        <label className="lbl">Vehículo</label>
        <div className="veh-row">
          {VEHICLES.map((v) => (
            <button
              key={v.key}
              className={`veh-btn ${vehicle.key === v.key ? "on" : ""}`}
              onClick={() => setVehicle(v)}
              disabled={running}
            >
              <span>{v.emoji}</span>{v.label}
            </button>
          ))}
        </div>

        <label className="lbl">Hora del día (riesgo)</label>
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
          <span className="dot red" /> riesgo
        </p>
      </div>

      {/* Simulador de móvil */}
      <div className="phone">
        <div className="phone-notch" />
        <div className="phone-screen">
          <div className="phone-status">{String(hour).padStart(2, "0")}:00 · NómadaAI</div>
          <div className="phone-veh">{vehicle.emoji}</div>
          <div className="phone-sub">{running ? "Recorrido en curso…" : finished ? "Recorrido finalizado" : "En espera"}</div>
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

// Llamada directa al endpoint online (el cliente compartido aún no lo expone)
async function api_online(
  acc: [number, number][],
  vehicle: Vehicle,
  hour: number,
  tripId: string
) {
  const base = import.meta.env.VITE_API_URL ?? "";
  const res = await fetch(`${base}/predict/online`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      points: acc.map(([lon, lat], i) => ({ lon, lat, t: i })),
      type: vehicle.key,
      hour,
      exclude_id: tripId,
      topk: 1,
    }),
  });
  if (!res.ok) throw new Error(`online ${res.status}`);
  return res.json();
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
