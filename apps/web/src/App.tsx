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
const TIME_SCALES = [
  { v: 1, label: "Tiempo real (×1)" }, { v: 5, label: "×5" }, { v: 15, label: "×15" },
  { v: 30, label: "×30" }, { v: 60, label: "×60" }, { v: 120, label: "×120" },
];
const DRAW_VEHICLES = [
  { key: "", label: "Automático" }, { key: "mot", label: "🏍️ Moto" },
  { key: "car", label: "🚗 Carro" }, { key: "bus", label: "🚌 Bus" },
];
// Velocidad por tipo (m/s) → el tiempo de recorrido depende del vehículo.
const SPEED_BY_TYPE: Record<string, number> = { mot: 10, car: 8.3, bus: 6.5, truck: 5.5, taxi: 8.3 };
const speedOf = (t: string) => SPEED_BY_TYPE[(t || "car").toLowerCase()] ?? 8;

function iconForType(t?: string): string {
  switch ((t ?? "").toLowerCase()) {
    case "mot": return "🏍️"; case "bus": return "🚌"; case "truck": return "🚚";
    case "taxi": return "🚕"; default: return "🚗";
  }
}
function labelForType(t?: string): string {
  switch ((t ?? "").toLowerCase()) {
    case "mot": return "Motocicleta"; case "bus": return "Bus"; case "truck": return "Camión";
    case "taxi": return "Taxi"; case "car": return "Carro"; default: return "Vehículo";
  }
}
const base = () => import.meta.env.VITE_API_URL ?? "";

interface Notif { id: number; title: string; body: string; }

export default function App() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const vehMarkerRef = useRef<maplibregl.Marker | null>(null);
  const coordsRef = useRef<[number, number][]>([]);
  const cumRef = useRef<number[]>([]);
  const distRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const lastPredRef = useRef(0);
  const lastCellRef = useRef("");
  const runningRef = useRef(false);
  const typeRef = useRef("car");
  const excludeRef = useRef<string | null>(null);
  const clockRef = useRef(0);
  const speedRef = useRef(8.3);
  const scaleRef = useRef(60);
  const thrRef = useRef(0.7);
  const modeRef = useRef<"test" | "draw">("test");
  const drawRef = useRef<{ origin?: [number, number]; dest?: [number, number] }>({});
  const notifIdRef = useRef(0);

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [tripId, setTripId] = useState("");
  const [mode, setMode] = useState<"test" | "draw">("test");
  const [drawVeh, setDrawVeh] = useState("");
  const [hour, setHour] = useState(20);
  const [threshold, setThreshold] = useState(70);
  const [timeScale, setTimeScale] = useState(60);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [predInfo, setPredInfo] = useState("—");
  const [clock, setClock] = useState(20 * 3600);
  const [liveRisk, setLiveRisk] = useState<number | null>(null);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const [drawMsg, setDrawMsg] = useState("Haz clic en el mapa: 1) dónde estás, 2) a dónde vas.");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [sat, setSat] = useState(false);
  const [evalRes, setEvalRes] = useState<any>(null);
  const [evalLoading, setEvalLoading] = useState(false);

  const selectedTrip = trips.find((t) => t.id === tripId);
  const vehType = mode === "draw" ? (drawVeh || "car") : (selectedTrip?.type ?? "car");
  const vehIcon = iconForType(vehType);

  useEffect(() => { thrRef.current = threshold / 100; }, [threshold]);
  useEffect(() => { scaleRef.current = timeScale; }, [timeScale]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { document.body.className = theme === "light" ? "light" : ""; }, [theme]);

  function pushLog(line: string) {
    setLog((prev) => [`${fmtClock(clockRef.current)} · ${line}`, ...prev].slice(0, 8));
  }

  // init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current, style: osmStyle, center: TUMACO_CENTER, zoom: TUMACO_ZOOM,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "bottom-right");

    map.on("load", async () => {
      try {
        const fc = (await api.corridors(undefined, 8000)) as ApiFC;
        map.addSource("corridors", { type: "geojson", data: fc as never });
        map.addLayer({ id: "corridors", type: "line", source: "corridors",
          paint: { "line-color": "#9aa7b2", "line-width": 1, "line-opacity": 0.18 } });
      } catch (e) { console.error(e); }

      map.addSource("risk", { type: "geojson", data: emptyFC() as never });
      map.addLayer({
        id: "risk-fill", type: "fill", source: "risk",
        paint: {
          "fill-color": ["interpolate", ["linear"], ["get", "risk_norm"],
            0, "#16a34a", 0.4, "#facc15", 0.7, "#f97316", 1, "#ef4444"],
          "fill-opacity": ["interpolate", ["linear"], ["get", "risk_norm"], 0, 0.12, 1, 0.6],
        },
      } as never);
      map.addLayer({ id: "risk-line", type: "line", source: "risk",
        paint: { "line-color": "#0b0e12", "line-width": 0.4, "line-opacity": 0.3 } } as never);
      addLine(map, "observed", { "line-color": "#2f81f7", "line-width": 5 });
      addLine(map, "pred", { "line-color": "#f97316", "line-width": 4, "line-dasharray": [1.5, 1] });
      addPoint(map, "endpoints", { "circle-radius": 6, "circle-color": "#a855f7", "circle-stroke-color": "#fff", "circle-stroke-width": 2 });
      addPoint(map, "danger", { "circle-radius": 16, "circle-color": "#ef4444", "circle-opacity": 0.3, "circle-stroke-color": "#ef4444", "circle-stroke-width": 2.5 });
      loadRisk(map, hour);

      map.on("click", "risk-fill", (e) => {
        const p = e.features?.[0]?.properties as Record<string, unknown> | undefined;
        if (!p) return;
        new maplibregl.Popup({ closeButton: false }).setLngLat(e.lngLat)
          .setHTML(`<b>Zona ${p.cell_id}</b><br/>Riesgo: ${p.risk} (${Math.round(Number(p.risk_norm) * 100)}%)<br/>Nivel: ${p.level}`).addTo(map);
      });
      map.on("click", (e) => {
        if (modeRef.current !== "draw" || runningRef.current) return;
        const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        const d = drawRef.current;
        if (!d.origin || (d.origin && d.dest)) {
          drawRef.current = { origin: pt }; setDrawMsg("Origen fijado. Ahora marca a dónde vas (destino).");
        } else {
          drawRef.current = { ...d, dest: pt }; setDrawMsg("Origen y destino listos. Pulsa «Generar ruta y simular».");
        }
        const dd = drawRef.current;
        setPoints(map, "endpoints", [dd.origin, dd.dest].filter(Boolean) as [number, number][]);
      });
    });

    fetch(`${base()}/health`).then((r) => r.json()).then(setHealth).catch(console.error);
    api.tripsSample(40).then((r) => { setTrips(r.trips); if (r.trips[0]) setTripId(r.trips[0].id); }).catch(console.error);
    return () => { if (timerRef.current) clearInterval(timerRef.current); map.remove(); };
  }, []);

  function toggleSat(next: boolean) {
    setSat(next);
    const map = mapRef.current; if (!map) return;
    map.setLayoutProperty("satellite", "visibility", next ? "visible" : "none");
    map.setLayoutProperty("osm", "visibility", next ? "none" : "visible");
  }

  async function loadRisk(map: maplibregl.Map, h: number) {
    try {
      const data = await fetch(`${base()}/risk/zones?hour=${h}`).then((r) => r.json());
      (map.getSource("risk") as maplibregl.GeoJSONSource | undefined)?.setData(data);
    } catch (e) { console.error("risk:", e); }
  }

  async function runEval() {
    setEvalLoading(true);
    try {
      const r = await fetch(`${base()}/trajectories/evaluate`).then((x) => x.json());
      setEvalRes(r);
    } catch (e) { alert("Error: " + (e as Error).message); }
    finally { setEvalLoading(false); }
  }

  function stopSim() {
    runningRef.current = false; setRunning(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  async function startTest() {
    if (!tripId) return;
    let coords: [number, number][] = [];
    try {
      const t = await fetch(`${base()}/trajectories/${encodeURIComponent(tripId)}/track`).then((r) => r.json());
      coords = t.coords;
    } catch (e) { alert("No pude cargar el recorrido: " + (e as Error).message); return; }
    excludeRef.current = tripId; typeRef.current = selectedTrip?.type ?? "car";
    startStream(coords);
  }

  async function startDraw() {
    const d = drawRef.current;
    if (!d.origin || !d.dest) { setDrawMsg("Marca primero origen y destino en el mapa."); return; }
    setDrawMsg("Generando ruta sobre la red vial…");
    let coords: [number, number][] = [];
    try {
      const r = await fetch(`${base()}/route/build`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ origin: d.origin, dest: d.dest, type: drawVeh || null }),
      });
      if (!r.ok) { setDrawMsg("No se pudo trazar la ruta (puntos lejos de la red)."); return; }
      coords = (await r.json()).coords;
    } catch (e) { setDrawMsg("Error: " + (e as Error).message); return; }
    excludeRef.current = null; typeRef.current = drawVeh || "car";
    setDrawMsg("Ruta generada. Simulando…");
    startStream(coords);
  }

  function startStream(coords: [number, number][]) {
    const map = mapRef.current;
    if (!map || coords.length < 4) return;
    stopSim();
    setFinished(false); setNotifs([]); setLiveRisk(null); setLog([]);
    setPredInfo("Detectando movimiento…");
    lastPredRef.current = 0; lastCellRef.current = ""; distRef.current = 0;
    clockRef.current = hour * 3600; setClock(clockRef.current);

    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
    coordsRef.current = coords; cumRef.current = cum;
    speedRef.current = speedOf(typeRef.current); // el tiempo depende del tipo de vehículo

    setLine(map, "observed", []); setLine(map, "pred", []); setPoint(map, "danger", null);
    map.flyTo({ center: coords[0], zoom: 15, duration: 700 });

    if (!vehMarkerRef.current) {
      const el = document.createElement("div"); el.className = "veh-marker";
      vehMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat(coords[0]).addTo(map);
    }
    vehMarkerRef.current.getElement().textContent = iconForType(typeRef.current);
    vehMarkerRef.current.setLngLat(coords[0]);

    runningRef.current = true; setRunning(true);
    pushLog(`🟢 Movimiento detectado (${labelForType(typeRef.current)}, ${(speedRef.current * 3.6).toFixed(0)} km/h)`);
    timerRef.current = window.setInterval(tick, 70);
  }

  async function tick() {
    const map = mapRef.current;
    if (!map || !runningRef.current) return;
    const coords = coordsRef.current, cum = cumRef.current;
    const total = cum[cum.length - 1];
    const simDt = scaleRef.current * 0.07;
    distRef.current = Math.min(total, distRef.current + speedRef.current * simDt);
    clockRef.current += simDt; setClock(clockRef.current);
    const d = distRef.current;
    setProgress(Math.round((d / total) * 100));

    let idx = cum.findIndex((c) => c >= d);
    if (idx < 0) idx = coords.length - 1;
    const pos = interpAt(coords, cum, d);
    const acc = coords.slice(0, Math.max(2, idx + 1));
    acc[acc.length - 1] = pos;
    vehMarkerRef.current?.setLngLat(pos);
    setLine(map, "observed", acc);

    const now = performance.now();
    if (acc.length >= 4 && now - lastPredRef.current > 450) {
      lastPredRef.current = now;
      pushLog(`📡 ${acc.length} ubicaciones → modelo de predicción`);
      try {
        const res = await onlineCall(acc);
        const cand = res.candidates?.[0];
        if (cand) {
          setLine(map, "pred", cand.geometry.coordinates as [number, number][]);
          pushLog(`🧭 Ruta probable ~${cand.length_m.toFixed(0)} m (vecino ${cand.neighbor_id})`);
        }
        const a = res.alert;
        if (a) {
          setLiveRisk(a.risk_norm);
          setPredInfo(`Ruta probable: ${cand ? cand.length_m.toFixed(0) : "?"} m · riesgo de la zona ${(a.risk_norm * 100).toFixed(0)}%`);
          if (a.is_high) {
            setPoint(map, "danger", [a.lon, a.lat]);
            if (a.cell_id && a.cell_id !== lastCellRef.current) {
              lastCellRef.current = a.cell_id;
              const eta = `${String(a.hour).padStart(2, "0")}:${String(a.arrival_min ?? 0).padStart(2, "0")}`;
              const id = ++notifIdRef.current;
              setNotifs((prev) => [{
                id,
                title: "⚠️ Alerta de seguridad",
                body: `Zona ${a.cell_id} de alto riesgo (${(a.risk_norm * 100).toFixed(0)}%) a ~${a.distance_m.toFixed(0)} m · llegarías ${eta}. Considera desvío.`,
              }, ...prev].slice(0, 6));
              pushLog(`⚠️ ALERTA zona ${a.cell_id} (${(a.risk_norm * 100).toFixed(0)}%) a ${a.distance_m.toFixed(0)} m`);
            }
          } else { setPoint(map, "danger", null); }
        }
      } catch (e) { console.error("online:", e); }
    }
    if (d >= total) { stopSim(); setFinished(true); setProgress(100); pushLog("🏁 Recorrido finalizado"); }
  }

  async function onlineCall(acc: [number, number][]) {
    const body: Record<string, unknown> = {
      points: acc.map(([lon, lat], i) => ({ lon, lat, t: i })),
      type: typeRef.current, t_seconds: clockRef.current,
      speed_mps: speedRef.current, threshold: thrRef.current, topk: 1,
    };
    if (excludeRef.current) body.exclude_id = excludeRef.current;
    const r = await fetch(`${base()}/predict/online`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`online ${r.status}`);
    return r.json();
  }

  return (
    <>
      <div id="map" ref={containerRef} />

      {/* Barra superior: tema + mapa */}
      <div className="topbar">
        <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "☀️ Claro" : "🌙 Oscuro"}</button>
        <button onClick={() => toggleSat(!sat)}>{sat ? "🗺️ Plano" : "🛰️ Satelital"}</button>
      </div>

      <div className="panel">
        <h1>NómadaAI</h1>
        <p className="subtitle">Navegación consciente del riesgo · Tumaco</p>

        {health && (
          <div className="counts">
            <div><b>{(health.n_trajectories ?? 0).toLocaleString()}</b><span>total</span></div>
            <div><b>{(health.n_train ?? 0).toLocaleString()}</b><span>entrenamiento</span></div>
            <div><b>{(health.n_test ?? 0).toLocaleString()}</b><span>no vistas</span></div>
          </div>
        )}

        <button className="eval-btn" onClick={runEval} disabled={evalLoading}>
          {evalLoading ? "Midiendo…" : "📊 Medir efectividad (test no visto)"}
        </button>
        {evalRes && (
          <div className="evalcard">
            <div className="evalbig">{evalRes.overall.acc_50m_pct}% <span>acierto ≤50 m</span></div>
            <div className="evalrow">≤100 m: <b>{evalRes.overall.acc_100m_pct}%</b> · error mediano: <b>{evalRes.overall.fde_median_m} m</b></div>
            <div className="evalrow">evaluadas: <b>{evalRes.evaluated}</b> no vistas (de {evalRes.n_test})</div>
            {Object.entries(evalRes.by_type).map(([t, v]: any) => (
              <div className="evalrow" key={t}>{labelForType(t)}: {v.acc_50m_pct}% ≤50 m (n={v.n})</div>
            ))}
          </div>
        )}

        <div className="tabs">
          <button className={mode === "test" ? "on" : ""} onClick={() => setMode("test")} disabled={running}>Viaje no visto</button>
          <button className={mode === "draw" ? "on" : ""} onClick={() => setMode("draw")} disabled={running}>Ruta nueva (yo elijo)</button>
        </div>

        {mode === "test" ? (
          <>
            <label className="lbl">Viaje de prueba (el modelo no lo conoce)</label>
            <select className="select" value={tripId} onChange={(e) => setTripId(e.target.value)} disabled={running}>
              {trips.map((t) => (
                <option key={t.id} value={t.id}>{iconForType(t.type)} {labelForType(t.type)} · {t.id} ({t.n_points} pts)</option>
              ))}
            </select>
          </>
        ) : (
          <>
            <label className="lbl">Vehículo (opcional)</label>
            <select className="select" value={drawVeh} onChange={(e) => setDrawVeh(e.target.value)} disabled={running}>
              {DRAW_VEHICLES.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
            <p className="hint" style={{ marginTop: 6 }}>{drawMsg}</p>
          </>
        )}

        <label className="lbl">Hora de salida (riesgo dinámico)</label>
        <select className="select" value={hour} onChange={(e) => { const h = Number(e.target.value); setHour(h); if (mapRef.current) loadRisk(mapRef.current, h); }} disabled={running}>
          {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
        </select>

        <label className="lbl">Velocidad del reloj</label>
        <select className="select" value={timeScale} onChange={(e) => setTimeScale(Number(e.target.value))}>
          {TIME_SCALES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>

        <label className="lbl">Umbral de alerta: <b>{threshold}%</b></label>
        <input className="range" type="range" min={0} max={100} step={5} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />

        {!running ? (
          mode === "test"
            ? <button onClick={startTest} disabled={!tripId}>▶ Iniciar simulación</button>
            : <button onClick={startDraw}>▶ Generar ruta y simular</button>
        ) : (
          <button className="secondary" onClick={stopSim}>■ Detener</button>
        )}

        {(running || finished) && <div className="clock">🕒 {fmtClock(clock)} · {timeScale === 1 ? "tiempo real" : `×${timeScale}`}</div>}
        <div className="progress"><div className="bar" style={{ width: `${progress}%` }} /></div>
        <p className="hint">{predInfo}</p>

        {log.length > 0 && (
          <div className="console">
            <div className="console-h">Actividad del sistema</div>
            {log.map((l, i) => <div key={i} className="console-l">{l}</div>)}
          </div>
        )}

        <p className="legend">
          <span className="dot blue" /> capturado &nbsp; <span className="dot orange" /> predicho &nbsp; <span className="dot red" /> zona alerta
        </p>
      </div>

      {/* Simulador de móvil con notificaciones apiladas */}
      <div className="phone">
        <div className="phone-notch" />
        <div className="phone-screen">
          <div className="phone-status">{running || finished ? fmtClock(clock) : `${String(hour).padStart(2, "0")}:00`} · NómadaAI</div>
          <div className="phone-veh">{vehIcon}</div>
          <div className="phone-sub">{running ? "Navegando…" : finished ? "Finalizado" : "En espera"}</div>
          {liveRisk != null && (
            <div className={`risk-pill ${liveRisk >= thrRef.current ? "hi" : ""}`}>Riesgo de la zona: {(liveRisk * 100).toFixed(0)}%</div>
          )}
          <div className="notif-stack">
            {notifs.map((n) => (
              <div className="push" key={n.id}>
                <div className="push-title">{n.title}</div>
                <div className="push-body">{n.body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------- geometría ----------
function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]), dLon = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function interpAt(coords: [number, number][], cum: number[], d: number): [number, number] {
  if (d <= 0) return coords[0];
  const total = cum[cum.length - 1];
  if (d >= total) return coords[coords.length - 1];
  let i = cum.findIndex((c) => c >= d);
  if (i <= 0) i = 1;
  const seg = cum[i] - cum[i - 1] || 1;
  const f = (d - cum[i - 1]) / seg;
  return [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * f, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * f];
}
function fmtClock(sec: number): string {
  const s = ((sec % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60);
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
function emptyFC() { return { type: "FeatureCollection", features: [] }; }
function setLine(map: maplibregl.Map, id: string, coords: [number, number][]) {
  const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  src?.setData(coords.length >= 2
    ? ({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} } as never)
    : (emptyFC() as never));
}
function setPoint(map: maplibregl.Map, id: string, coord: [number, number] | null) {
  const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  src?.setData(coord
    ? ({ type: "Feature", geometry: { type: "Point", coordinates: coord }, properties: {} } as never)
    : (emptyFC() as never));
}
function setPoints(map: maplibregl.Map, id: string, coords: [number, number][]) {
  const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  src?.setData({ type: "FeatureCollection", features: coords.map((c) => ({ type: "Feature", geometry: { type: "Point", coordinates: c }, properties: {} })) } as never);
}
