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

// Ícono cenital del vehículo (estilo Uber/Rappi). Apunta hacia ARRIBA (norte) en rotación 0;
// el marcador se rota al rumbo. El parabrisas claro marca el frente.
function vehicleSVG(t?: string): string {
  const ty = (t ?? "car").toLowerCase();
  const sh = `<defs><filter id="vs" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1" stdDeviation="1.3" flood-color="#000" flood-opacity="0.5"/></filter></defs>`;
  if (ty === "mot" || ty === "moto" || ty === "bike") {
    return `<svg width="26" height="26" viewBox="0 0 40 40">${sh}<g filter="url(#vs)"><rect x="16.5" y="10" width="7" height="20" rx="3.5" fill="#f97316" stroke="#fff" stroke-width="1.4"/><circle cx="20" cy="13.5" r="2.8" fill="#111827"/></g></svg>`;
  }
  if (ty === "bus") {
    return `<svg width="32" height="32" viewBox="0 0 40 40">${sh}<g filter="url(#vs)"><rect x="12.5" y="5" width="15" height="30" rx="3.5" fill="#2563eb" stroke="#fff" stroke-width="1.4"/><rect x="15" y="7" width="10" height="5" rx="1.5" fill="#cfe5ff"/><rect x="15" y="15" width="10" height="3.5" rx="1" fill="#93c5fd"/><rect x="15" y="21" width="10" height="3.5" rx="1" fill="#93c5fd"/></g></svg>`;
  }
  if (ty === "truck") {
    return `<svg width="32" height="32" viewBox="0 0 40 40">${sh}<g filter="url(#vs)"><rect x="13.5" y="4.5" width="13" height="10" rx="2.5" fill="#374151" stroke="#fff" stroke-width="1.4"/><rect x="15.5" y="6.5" width="9" height="5" rx="1.5" fill="#cbd5e1"/><rect x="13" y="14.5" width="14" height="21" rx="2" fill="#9ca3af" stroke="#fff" stroke-width="1.4"/></g></svg>`;
  }
  // carro (estilo Uber): cuerpo oscuro, parabrisas claro al frente
  return `<svg width="30" height="30" viewBox="0 0 40 40">${sh}<g filter="url(#vs)"><rect x="12.5" y="6" width="15" height="28" rx="6.5" fill="#1f2937" stroke="#fff" stroke-width="1.5"/><path d="M15 13 Q20 9.5 25 13 L25 17 L15 17 Z" fill="#9cd2ff"/><rect x="15" y="25.5" width="10" height="5.5" rx="2.5" fill="#4b5563"/></g></svg>`;
}

interface Notif { id: number; title: string; body: string; time: string; }
interface LiveStats { n: number; fde: number; h50: number; h100: number; alerts: number; }
interface LiveBuckets { test: LiveStats; draw: LiveStats; }
const emptyStats = (): LiveStats => ({ n: 0, fde: 0, h50: 0, h100: 0, alerts: 0 });
const emptyBuckets = (): LiveBuckets => ({ test: emptyStats(), draw: emptyStats() });

export default function App() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const vehMarkerRef = useRef<maplibregl.Marker | null>(null);
  const lastPosRef = useRef<[number, number] | null>(null);
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
  const followRef = useRef(true);
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
  const [liveStats, setLiveStats] = useState<LiveBuckets | null>(null);
  const liveRef = useRef<LiveBuckets>(emptyBuckets());
  const [log, setLog] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const [drawMsg, setDrawMsg] = useState("Haz clic en el mapa: 1) dónde estás, 2) a dónde vas.");
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches
      ? "light" : "dark"
  );
  const [sat, setSat] = useState(false);
  const [riskOn, setRiskOn] = useState(true);
  const [follow, setFollow] = useState(true);
  const [evalRes, setEvalRes] = useState<any>(null);
  const [evalAlerts, setEvalAlerts] = useState<any>(null);
  const [evalScn, setEvalScn] = useState<any[] | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);

  const selectedTrip = trips.find((t) => t.id === tripId);
  const vehType = mode === "draw" ? (drawVeh || "car") : (selectedTrip?.type ?? "car");
  const vehIcon = iconForType(vehType);

  useEffect(() => { thrRef.current = threshold / 100; }, [threshold]);
  useEffect(() => { scaleRef.current = timeScale; }, [timeScale]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { document.body.className = theme === "light" ? "light" : ""; }, [theme]);
  useEffect(() => { followRef.current = follow; }, [follow]);

  function pushLog(line: string) {
    setLog((prev) => [`${fmtClock(clockRef.current)} · ${line}`, ...prev].slice(0, 200));
  }
  function toggleRisk(next: boolean) {
    setRiskOn(next);
    const map = mapRef.current; if (!map || !map.getLayer("risk-fill")) return;
    const v = next ? "visible" : "none";
    try {
      map.setLayoutProperty("risk-fill", "visibility", v);
      map.setLayoutProperty("risk-line", "visibility", v);
    } catch (e) { console.error(e); }
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
        map.addLayer({
          id: "corridors", type: "line", source: "corridors",
          paint: { "line-color": "#9aa7b2", "line-width": 1, "line-opacity": 0.18 }
        });
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
      map.addLayer({
        id: "risk-line", type: "line", source: "risk",
        paint: { "line-color": "#0b0e12", "line-width": 0.4, "line-opacity": 0.3 }
      } as never);
      addLine(map, "observed", { "line-color": "#2f81f7", "line-width": 5 });
      addLine(map, "pred", { "line-color": "#f97316", "line-width": 4, "line-dasharray": [1.5, 1] });
      addPoint(map, "endpoints", { "circle-radius": 6, "circle-color": "#a855f7", "circle-stroke-color": "#fff", "circle-stroke-width": 2 });
      addPoint(map, "danger", { "circle-radius": 16, "circle-color": "#ef4444", "circle-opacity": 0.3, "circle-stroke-color": "#ef4444", "circle-stroke-width": 2.5 });
      loadRisk(map, hour);

      map.on("click", "risk-fill", (e) => {
        const p = e.features?.[0]?.properties as Record<string, unknown> | undefined;
        if (!p) return;
        const ll = `${e.lngLat.lat.toFixed(6)}, ${e.lngLat.lng.toFixed(6)}`;
        new maplibregl.Popup({ closeButton: true }).setLngLat(e.lngLat)
          .setHTML(`<b>Zona ${p.cell_id}</b><br/>Riesgo: ${p.risk} (${Math.round(Number(p.risk_norm) * 100)}%)<br/>Nivel: ${p.level}<br/>Centroide: ${Number(p.lat).toFixed(6)}, ${Number(p.lon).toFixed(6)}<br/>Clic: ${ll}`).addTo(map);
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
    try {
      map.setLayoutProperty("satellite", "visibility", next ? "visible" : "none");
      map.setLayoutProperty("osm", "visibility", next ? "none" : "visible");
    } catch (e) { console.error(e); }
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
      const [pred, alerts, scn] = await Promise.all([
        fetch(`${base()}/trajectories/evaluate`).then((x) => x.json()),
        fetch(`${base()}/evaluate/alerts`).then((x) => x.json()),
        fetch(`${base()}/evaluate/scenarios`).then((x) => x.json()),
      ]);
      setEvalRes(pred);
      setEvalAlerts(alerts?.available ? alerts : null);
      setEvalScn((scn?.scenarios || []).filter((s: any) => s.lookahead_m === 300));
    } catch (e) { alert("Error: " + (e as Error).message); }
    finally { setEvalLoading(false); }
  }

  function stopSim() {
    runningRef.current = false; setRunning(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  function clearAll() {
    stopSim();
    const map = mapRef.current;
    if (map) {
      try {
        setLine(map, "observed", []); setLine(map, "pred", []);
        setPoint(map, "danger", null); setPoints(map, "endpoints", []);
      } catch (e) { console.error(e); }
    }
    if (vehMarkerRef.current) { vehMarkerRef.current.remove(); vehMarkerRef.current = null; }
    drawRef.current = {};
    setFinished(false); setNotifs([]); setLog([]); setLiveRisk(null);
    liveRef.current = emptyBuckets(); setLiveStats(null);
    setProgress(0); setPredInfo("—"); lastCellRef.current = ""; distRef.current = 0;
    setDrawMsg("Haz clic en el mapa: 1) dónde estás, 2) a dónde vas.");
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
      const j = await r.json();
      coords = j.coords;
      const adapted = j.vehicle_restricted ? `adaptada a ${labelForType(drawVeh || "car")}` : "red general";
      const dir = j.directional ? "respeta sentidos" : "sin sentido estricto";
      setDrawMsg(`Ruta ${(j.distance_m / 1000).toFixed(2)} km · ${adapted} · ${dir}. Simulando…`);
    } catch (e) { setDrawMsg("Error: " + (e as Error).message); return; }
    excludeRef.current = null; typeRef.current = drawVeh || "car";
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
    lastPosRef.current = null;
    map.flyTo({ center: coords[0], zoom: 15, duration: 700 });

    // marcador cenital (estilo Uber/Rappi): el sprite apunta al rumbo
    if (vehMarkerRef.current) { vehMarkerRef.current.remove(); vehMarkerRef.current = null; }
    const el = document.createElement("div"); el.className = "veh-sprite";
    el.innerHTML = vehicleSVG(typeRef.current);
    vehMarkerRef.current = new maplibregl.Marker({ element: el, rotationAlignment: "map" })
      .setLngLat(coords[0]).addTo(map);

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
    // orientar el vehículo hacia su dirección de avance (coherente con la calle)
    const prevPos = lastPosRef.current;
    if (prevPos && (prevPos[0] !== pos[0] || prevPos[1] !== pos[1])) {
      vehMarkerRef.current?.setRotation(bearing(prevPos, pos));
    }
    lastPosRef.current = pos;
    setLine(map, "observed", acc);
    // la cámara sigue al vehículo
    if (followRef.current) map.setCenter(pos);

    const now = performance.now();
    if (acc.length >= 4 && now - lastPredRef.current > 450) {
      lastPredRef.current = now;
      pushLog(`→ POST /predict/online · pts=${acc.length} · pos=${pos[1].toFixed(5)},${pos[0].toFixed(5)} · t=${fmtClock(clockRef.current)}`);
      try {
        const res = await onlineCall(acc);
        const cand = res.candidates?.[0];
        if (cand) {
          setLine(map, "pred", cand.geometry.coordinates as [number, number][]);
          pushLog(`← pred: vecino ${cand.neighbor_id} · ${cand.length_m.toFixed(0)} m · conf ${(cand.confidence * 100).toFixed(0)}%`);
          // EFECTIVIDAD EN VIVO: comparar el punto predicho con el punto REAL del recorrido
          // que se está siguiendo (sirve para test y para rutas nuevas).
          const predEnd = cand.geometry.coordinates[cand.geometry.coordinates.length - 1] as [number, number];
          const realAhead = interpAt(coords, cum, Math.min(total, d + cand.length_m));
          const fde = haversine(predEnd, realAhead);
          const L = excludeRef.current ? liveRef.current.test : liveRef.current.draw;
          L.n += 1; L.fde += fde; if (fde <= 50) L.h50 += 1; if (fde <= 100) L.h100 += 1;
          setLiveStats({ test: { ...liveRef.current.test }, draw: { ...liveRef.current.draw } });
          pushLog(`   efectividad: error ${fde.toFixed(0)} m (${excludeRef.current ? "no visto" : "ruta nueva"}, acum ${L.n})`);
        }
        const a = res.alert;
        if (a) {
          setLiveRisk(a.risk_norm);
          setPredInfo(`Ruta probable: ${cand ? cand.length_m.toFixed(0) : "?"} m · riesgo de la zona ${(a.risk_norm * 100).toFixed(0)}%`);
          pushLog(`← riesgo: zona ${a.cell_id} · ${(a.risk_norm * 100).toFixed(0)}% · d=${a.distance_m.toFixed(0)} m · llegada ${String(a.hour).padStart(2, "0")}:${String(a.arrival_min ?? 0).padStart(2, "0")} · ${a.is_high ? "ALTO" : "ok"}`);
          if (a.is_high) {
            setPoint(map, "danger", [a.lon, a.lat]);
            if (a.cell_id && a.cell_id !== lastCellRef.current) {
              lastCellRef.current = a.cell_id;
              (excludeRef.current ? liveRef.current.test : liveRef.current.draw).alerts += 1;
              const id = ++notifIdRef.current;
              setNotifs((prev) => [{
                id,
                title: "⚠️ Alerta de seguridad",
                time: fmtClock(clockRef.current).slice(0, 5),
                body: `Zona ${a.cell_id} de alto riesgo (${(a.risk_norm * 100).toFixed(0)}%) a ~${a.distance_m.toFixed(0)} m. Considera un desvío.`,
              }, ...prev].slice(0, 20));
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
        <button className={riskOn ? "on" : ""} onClick={() => toggleRisk(!riskOn)}>{riskOn ? "🟥 Riesgo: ON" : "⬜ Riesgo: OFF"}</button>
        <button className={follow ? "on" : ""} onClick={() => setFollow(!follow)}>{follow ? "🎯 Seguir: ON" : "🧭 Seguir: OFF"}</button>
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
          {evalLoading ? "Midiendo…" : "📊 Medir efectividad"}
        </button>
        {evalRes && (
          <div className="evalcard">
            <div className="evalsub">Predicción de destino (test no visto)</div>
            <div className="evalbig">{evalRes.overall.acc_50m_pct}% <span>acierto ≤50 m</span></div>
            <div className="evalrow">≤100 m: <b>{evalRes.overall.acc_100m_pct}%</b> · error mediano: <b>{evalRes.overall.fde_median_m} m</b> · {evalRes.evaluated} viajes</div>
            {Object.entries(evalRes.by_type).map(([t, v]: any) => (
              <div className="evalrow" key={t}>{labelForType(t)}: {v.acc_50m_pct}% ≤50 m (n={v.n})</div>
            ))}

            {evalAlerts && (
              <>
                <div className="evalsub">Protección — la alerta avisa a tiempo (OE4)</div>
                <div className="evalbig">{evalAlerts.pct_anticipadas}% <span>avisos ANTES de la zona</span></div>
                <div className="evalrow">{evalAlerts.pct_con_alerta}% de viajes con alerta · anticipación media <b>{evalAlerts.anticipacion_media_m} m</b> (~{evalAlerts.anticipacion_media_s} s)</div>
              </>
            )}

            {evalScn && evalScn.length > 0 && (
              <>
                <div className="evalsub">Escenarios (look-ahead 300 m)</div>
                <table className="scn">
                  <thead><tr><th>Hora</th><th>Umbral</th><th>% riesgo</th><th>% a tiempo</th></tr></thead>
                  <tbody>
                    {evalScn.map((s, i) => (
                      <tr key={i}><td>{String(s.hora).padStart(2, "0")}:00</td><td>{s.umbral}</td><td>{s.pct_con_riesgo}%</td><td>{s.pct_anticipadas}%</td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

        <div className="tabs">
          <button className={mode === "test" ? "on" : ""} onClick={() => setMode("test")} disabled={running}>Viaje no visto</button>
          <button className={mode === "draw" ? "on" : ""} onClick={() => setMode("draw")} disabled={running}>Ruta nueva</button>
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
          <div className="row">
            {mode === "test"
              ? <button onClick={startTest} disabled={!tripId}>▶ Iniciar simulación</button>
              : <button onClick={startDraw}>▶ Generar ruta y simular</button>}
            <button className="secondary" onClick={clearAll}>Limpiar</button>
          </div>
        ) : (
          <button className="secondary" onClick={stopSim}>■ Detener</button>
        )}

        {(running || finished) && <div className="clock">🕒 {fmtClock(clock)} · {timeScale === 1 ? "tiempo real" : `×${timeScale}`}</div>}
        <div className="progress"><div className="bar" style={{ width: `${progress}%` }} /></div>
        <p className="hint">{predInfo}</p>

        {liveStats && (liveStats.test.n > 0 || liveStats.draw.n > 0) && (
          <div className="livecard">
            <div className="livecard-h">Efectividad en vivo · comparativa (esta sesión)</div>
            <table className="scn">
              <thead><tr><th></th><th>No visto</th><th>Ruta nueva</th></tr></thead>
              <tbody>
                <tr><td>acierto ≤50 m</td>
                  <td>{liveStats.test.n ? Math.round((100 * liveStats.test.h50) / liveStats.test.n) + "%" : "—"}</td>
                  <td>{liveStats.draw.n ? Math.round((100 * liveStats.draw.h50) / liveStats.draw.n) + "%" : "—"}</td></tr>
                <tr><td>error medio</td>
                  <td>{liveStats.test.n ? (liveStats.test.fde / liveStats.test.n).toFixed(0) + " m" : "—"}</td>
                  <td>{liveStats.draw.n ? (liveStats.draw.fde / liveStats.draw.n).toFixed(0) + " m" : "—"}</td></tr>
                <tr><td>nº predicciones</td>
                  <td>{liveStats.test.n || "—"}</td><td>{liveStats.draw.n || "—"}</td></tr>
                <tr><td>alertas</td>
                  <td>{liveStats.test.alerts || "—"}</td><td>{liveStats.draw.alerts || "—"}</td></tr>
              </tbody>
            </table>
            <div className="livecard-row" style={{ marginTop: 4 }}>Corre viajes <b>no vistos</b> y <b>rutas nuevas</b> para comparar la generalización.</div>
          </div>
        )}

        <div className="legend">
          <span className="leg"><span className="dot blue" /> capturado</span>
          <span className="leg"><span className="dot orange" /> predicho</span>
          <span className="leg"><span className="dot red" /> zona alerta</span>
        </div>
      </div>

      {/* Telemetría flotante (las "entrañas" en tiempo real) */}
      {log.length > 0 && (
        <div className="telemetry">
          <div className="telemetry-h">● ACTIVIDAD DEL SISTEMA · entradas/salidas del modelo</div>
          <div className="telemetry-body">
            {log.map((l, i) => <div key={i} className="telemetry-l">{l}</div>)}
          </div>
        </div>
      )}

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
                <div className="push-head"><span className="push-title">{n.title}</span><span className="push-time">{n.time}</span></div>
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
function bearing(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b[0] - a[0])) * Math.cos(toRad(b[1]));
  const x = Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) -
    Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[0] - a[0]));
  return (Math.atan2(y, x) * 180) / Math.PI; // 0 = norte, horario
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
