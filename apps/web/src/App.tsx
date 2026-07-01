import { useEffect, useRef, useState } from "react";
import { SignedIn, SignedOut, SignInButton, UserButton, useAuth, useUser } from "@clerk/clerk-react";
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
// Acumulado de un viaje en curso: predicción del modelo vs baseline (línea recta) + alertas.
interface TripAgg { n: number; modelErr: number; baseErr: number; modelHit50: number; baseHit50: number; alerts: number; }
const emptyTripAgg = (): TripAgg => ({ n: 0, modelErr: 0, baseErr: 0, modelHit50: 0, baseHit50: 0, alerts: 0 });
// Comparación de protección de un viaje 'ruta nueva': ruta segura vs ruta directa.
interface Protection { exposure_reduction_pct: number; safe_exposure: number; direct_exposure: number; safe_dist_m: number; direct_dist_m: number; }
// Histórico local (respaldo cuando no hay DB): mismas dos comparaciones agregadas.
interface HistLocal {
  trips: number; alerts: number; since: number | null; updated: number | null;
  pred: { n: number; modelErrSum: number; baseErrSum: number; modelHit50: number; baseHit50: number };
  prot: { n: number; redSum: number };
}
const emptyHist = (): HistLocal => ({
  trips: 0, alerts: 0, since: null, updated: null,
  pred: { n: 0, modelErrSum: 0, baseErrSum: 0, modelHit50: 0, baseHit50: 0 },
  prot: { n: 0, redSum: 0 },
});

// Login opcional: activo solo si hay clave publicable de Clerk. Si no, todo es modo invitado.
const CLERK_ENABLED = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// Barra de sesión (usa hooks de Clerk; solo se monta cuando Clerk está habilitado).
function AuthBar({ onUser, setGetToken }: {
  onUser: (id: string | null) => void;
  setGetToken: (fn: (() => Promise<string | null>) | null) => void;
}) {
  const { user, isSignedIn } = useUser();
  const { getToken } = useAuth();
  useEffect(() => { onUser(isSignedIn && user ? user.id : null); }, [isSignedIn, user, onUser]);
  useEffect(() => { setGetToken(() => getToken()); return () => setGetToken(null); }, [getToken, setGetToken]);
  return (
    <>
      <SignedOut>
        <SignInButton mode="modal"><button className="help-btn">Iniciar sesión</button></SignInButton>
      </SignedOut>
      <SignedIn><UserButton afterSignOutUrl="/" /></SignedIn>
    </>
  );
}

// Identidad anónima del usuario (persistente en este navegador). Habilita histórico por usuario,
// personalización y BI. Más adelante se puede enlazar a un login real sin cambiar el esquema.
function getUid(): string {
  try {
    let u = localStorage.getItem("nomadaai_uid");
    if (!u) {
      u = (crypto?.randomUUID?.() ?? `u_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      localStorage.setItem("nomadaai_uid", u);
    }
    return u;
  } catch { return "anon"; }
}

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
  const [riskWeight, setRiskWeight] = useState(50); // prioridad de seguridad (0-100) → λ
  const [safeMsg, setSafeMsg] = useState<string>("");
  const [timeScale, setTimeScale] = useState(60);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [predInfo, setPredInfo] = useState("—");
  const [clock, setClock] = useState(20 * 3600);
  const [liveRisk, setLiveRisk] = useState<number | null>(null);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const tripAggRef = useRef<TripAgg>(emptyTripAgg());
  const protectionRef = useRef<Protection | null>(null);
  const tripMetaRef = useRef<{ mode: string; vehicle: string; hour: number }>({ mode: "test", vehicle: "car", hour: 20 });
  const uidRef = useRef<string>(getUid());
  const sessionRef = useRef<string>(`s_${Date.now()}`);
  const [authUid, setAuthUid] = useState<string | null>(null);          // id de Clerk si hay sesión
  const authGetTokenRef = useRef<null | (() => Promise<string | null>)>(null);
  const effUidRef = useRef<string>(uidRef.current);                     // usuario efectivo (sesión o anónimo)
  const histLocalRef = useRef<HistLocal>(emptyHist());
  const [histLocal, setHistLocal] = useState<HistLocal | null>(null);   // respaldo (navegador)
  const [histSummary, setHistSummary] = useState<any>(null);            // agregados del usuario (DB)
  const [histGlobal, setHistGlobal] = useState<any>(null);              // contexto global (BI)
  const [showHelp, setShowHelp] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const [drawMsg, setDrawMsg] = useState("Haz clic en el mapa: 1) dónde estás, 2) a dónde vas.");
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches
      ? "light" : "dark"
  );
  const [sat, setSat] = useState(false);
  const [riskOn, setRiskOn] = useState(true);
  const [poisOn, setPoisOn] = useState(false);
  const [follow, setFollow] = useState(true);
  const [evalRes, setEvalRes] = useState<any>(null);
  const [evalAlerts, setEvalAlerts] = useState<any>(null);
  const [evalScn, setEvalScn] = useState<any[] | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [busy, setBusy] = useState("");  // aviso mientras se prepara la simulación

  const selectedTrip = trips.find((t) => t.id === tripId);
  const vehType = mode === "draw" ? (drawVeh || "car") : (selectedTrip?.type ?? "car");
  const vehIcon = iconForType(vehType);

  useEffect(() => { thrRef.current = threshold / 100; }, [threshold]);
  useEffect(() => { scaleRef.current = timeScale; }, [timeScale]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { document.body.className = theme === "light" ? "light" : ""; }, [theme]);
  useEffect(() => { followRef.current = follow; }, [follow]);
  // Histórico: cargar respaldo local y traer agregados de la DB (si está configurada).
  useEffect(() => {
    try {
      const s = localStorage.getItem("nomadaai_hist");
      if (s) { const p = JSON.parse(s) as HistLocal; histLocalRef.current = p; setHistLocal(p); }
    } catch { /* ignore */ }
    refreshSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Precalentar la medición de efectividad: el backend cachea el cálculo pesado y dejamos el
  // resultado listo en este navegador, así "Medir efectividad" responde al instante.
  useEffect(() => {
    const t = setTimeout(() => { fetchEval().catch(() => { /* silencioso */ }); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cuando cambia la sesión (login/logout) se recalcula el usuario efectivo y se recarga.
  useEffect(() => {
    effUidRef.current = authUid ?? uidRef.current;
    refreshSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUid]);

  async function authHeader(): Promise<Record<string, string>> {
    try {
      const t = authGetTokenRef.current ? await authGetTokenRef.current() : null;
      return t ? { Authorization: `Bearer ${t}` } : {};
    } catch { return {}; }
  }

  async function refreshSummary() {
    try {
      const h = await authHeader();
      const [mine, global] = await Promise.all([
        fetch(`${base()}/history/summary?user_id=${encodeURIComponent(effUidRef.current)}`, { headers: h }).then((r) => r.json()),
        fetch(`${base()}/history/summary`).then((r) => r.json()),  // sin sesión → contexto global
      ]);
      setHistSummary(mine?.available ? mine : null);
      setHistGlobal(global?.available ? global : null);
    } catch { setHistSummary(null); setHistGlobal(null); }
  }

  // Al terminar un viaje: consolida sus dos comparaciones (predicción y protección), las guarda
  // en la DB (producto real) y en un respaldo local, y refresca los agregados.
  async function finishTrip() {
    const a = tripAggRef.current;
    if (a.n === 0 && !protectionRef.current) return;
    const p = protectionRef.current;
    // respaldo local (para que el histórico funcione aunque no haya DB configurada)
    const H = histLocalRef.current;
    const now = Date.now();
    if (!H.since) H.since = now;
    H.updated = now; H.trips += 1; H.alerts += a.alerts;
    H.pred.n += a.n; H.pred.modelErrSum += a.modelErr; H.pred.baseErrSum += a.baseErr;
    H.pred.modelHit50 += a.modelHit50; H.pred.baseHit50 += a.baseHit50;
    if (p) { H.prot.n += 1; H.prot.redSum += p.exposure_reduction_pct; }
    setHistLocal({ ...H });
    try { localStorage.setItem("nomadaai_hist", JSON.stringify(H)); } catch { /* ignore */ }
    // DB
    const m = tripMetaRef.current;
    try {
      await fetch(`${base()}/history/trip`, {
        method: "POST", headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({
          user_id: effUidRef.current, session_id: sessionRef.current,
          mode: m.mode, vehicle: m.vehicle, hour: m.hour,
          n_pred: a.n, model_err_sum: a.modelErr, base_err_sum: a.baseErr,
          model_hit50: a.modelHit50, base_hit50: a.baseHit50, alerts: a.alerts,
          exposure_reduction_pct: p?.exposure_reduction_pct ?? null,
          safe_exposure: p?.safe_exposure ?? null, direct_exposure: p?.direct_exposure ?? null,
          safe_dist_m: p?.safe_dist_m ?? null, direct_dist_m: p?.direct_dist_m ?? null,
        }),
      });
      refreshSummary();
    } catch { /* silencioso: la simulación no depende de la DB */ }
  }

  async function resetHist() {
    histLocalRef.current = emptyHist();
    setHistLocal(null);
    try { localStorage.removeItem("nomadaai_hist"); } catch { /* ignore */ }
    try { await fetch(`${base()}/history?user_id=${encodeURIComponent(effUidRef.current)}`, { method: "DELETE", headers: await authHeader() }); } catch { /* ignore */ }
    refreshSummary();
  }

  // Vista unificada del histórico: prioriza la DB; si no hay, usa el respaldo local.
  function histView() {
    if (histSummary?.available && histSummary.trips > 0) {
      const P = histSummary.prediccion, R = histSummary.proteccion;
      return {
        source: "db" as const, trips: histSummary.trips, alerts: histSummary.alerts ?? 0,
        pred: P ? { model50: P.model_acc50_pct, base50: P.base_acc50_pct, mejora: P.mejora_pp, modelErr: P.model_err_mean_m, baseErr: P.base_err_mean_m, n: P.n } : null,
        prot: R ? { n: R.n, red: R.exposure_reduction_avg_pct } : null,
        since: fmtDate(histSummary.since ? Date.parse(histSummary.since) : null),
        updated: fmtDate(histSummary.updated ? Date.parse(histSummary.updated) : null),
      };
    }
    const H = histLocal;
    if (H && H.trips > 0) {
      const pn = H.pred.n, r1 = (x: number) => Math.round(x * 10) / 10;
      return {
        source: "local" as const, trips: H.trips, alerts: H.alerts,
        pred: pn ? { model50: r1(100 * H.pred.modelHit50 / pn), base50: r1(100 * H.pred.baseHit50 / pn), mejora: r1(100 * (H.pred.modelHit50 - H.pred.baseHit50) / pn), modelErr: r1(H.pred.modelErrSum / pn), baseErr: r1(H.pred.baseErrSum / pn), n: pn } : null,
        prot: H.prot.n ? { n: H.prot.n, red: r1(H.prot.redSum / H.prot.n) } : null,
        since: fmtDate(H.since), updated: fmtDate(H.updated),
      };
    }
    return null;
  }

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
  function togglePois(next: boolean) {
    setPoisOn(next);
    const map = mapRef.current; if (!map || !map.getLayer("pois")) return;
    try { map.setLayoutProperty("pois", "visibility", next ? "visible" : "none"); } catch (e) { console.error(e); }
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
      addLine(map, "direct", { "line-color": "#94a3b8", "line-width": 3, "line-dasharray": [2, 2], "line-opacity": 0.7 });
      addLine(map, "observed", { "line-color": "#2f81f7", "line-width": 5 });
      addLine(map, "pred", { "line-color": "#f97316", "line-width": 4, "line-dasharray": [1.5, 1] });
      addPoint(map, "endpoints", { "circle-radius": 6, "circle-color": "#a855f7", "circle-stroke-color": "#fff", "circle-stroke-width": 2 });
      addPoint(map, "danger", { "circle-radius": 16, "circle-color": "#ef4444", "circle-opacity": 0.3, "circle-stroke-color": "#ef4444", "circle-stroke-width": 2.5 });
      loadRisk(map, hour);

      // Capa de POIs (OE3): lugares de interés de OSM, coloreados por categoría. Oculta por defecto.
      try {
        const pois = await fetch(`${base()}/pois`).then((r) => r.json());
        map.addSource("pois", { type: "geojson", data: pois });
        map.addLayer({
          id: "pois", type: "circle", source: "pois",
          layout: { visibility: "none" },
          paint: {
            "circle-radius": 5,
            "circle-stroke-width": 1.5, "circle-stroke-color": "#fff",
            "circle-color": ["match", ["get", "category"],
              "seguridad", "#2563eb", "salud", "#ef4444", "educación", "#a855f7",
              "combustible", "#f97316", "banco", "#16a34a", "transporte", "#0ea5e9",
              "comercio", "#b45309", "culto", "#64748b", "#94a3b8"],
          },
        } as never);
        map.on("click", "pois", (e) => {
          const p = e.features?.[0]?.properties as Record<string, unknown> | undefined;
          if (!p) return;
          new maplibregl.Popup({ closeButton: true }).setLngLat(e.lngLat)
            .setHTML(`<b>${p.name}</b><br/>${p.category}`).addTo(map);
        });
      } catch (e) { console.error("pois:", e); }

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

  async function fetchEval() {
    const [pred, alerts, scn] = await Promise.all([
      fetch(`${base()}/trajectories/evaluate`).then((x) => x.json()),
      fetch(`${base()}/evaluate/alerts`).then((x) => x.json()),
      fetch(`${base()}/evaluate/scenarios`).then((x) => x.json()),
    ]);
    const alertsV = alerts?.available ? alerts : null;
    const scnV = (scn?.scenarios || []).filter((s: any) => s.lookahead_m === 300);
    const bundle = { pred, alerts: alertsV, scn: scnV, at: Date.now() };
    try { localStorage.setItem("nomadaai_eval", JSON.stringify(bundle)); } catch { /* ignore */ }
    return bundle;
  }

  function showEvalBundle(b: any) {
    setEvalRes(b.pred); setEvalAlerts(b.alerts); setEvalScn(b.scn);
  }

  async function runEval() {
    // 1) muestra al instante lo último medido (si existe) para que el botón responda ya
    let hadCache = false;
    try {
      const s = localStorage.getItem("nomadaai_eval");
      if (s) { showEvalBundle(JSON.parse(s)); hadCache = true; }
    } catch { /* ignore */ }
    // 2) refresca en segundo plano (el backend cachea, así que es rápido tras el 1er cálculo)
    setEvalLoading(!hadCache);
    try {
      showEvalBundle(await fetchEval());
    } catch (e) { if (!hadCache) alert("Error: " + (e as Error).message); }
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
        setLine(map, "observed", []); setLine(map, "pred", []); setLine(map, "direct", []);
        setPoint(map, "danger", null); setPoints(map, "endpoints", []);
      } catch (e) { console.error(e); }
    }
    if (vehMarkerRef.current) { vehMarkerRef.current.remove(); vehMarkerRef.current = null; }
    drawRef.current = {};
    setFinished(false); setNotifs([]); setLog([]); setLiveRisk(null); setSafeMsg("");
    setProgress(0); setPredInfo("—"); lastCellRef.current = ""; distRef.current = 0;
    setDrawMsg("Haz clic en el mapa: 1) dónde estás, 2) a dónde vas.");
  }

  async function startTest() {
    if (!tripId) return;
    setBusy("Cargando el recorrido del viaje…");
    let coords: [number, number][] = [];
    try {
      const t = await fetch(`${base()}/trajectories/${encodeURIComponent(tripId)}/track`).then((r) => r.json());
      coords = t.coords;
    } catch (e) { setBusy(""); alert("No pude cargar el recorrido: " + (e as Error).message); return; }
    excludeRef.current = tripId; typeRef.current = selectedTrip?.type ?? "car";
    protectionRef.current = null;  // en 'no visto' no hay ruta segura vs directa
    setBusy("");
    startStream(coords);
  }

  async function startDraw() {
    const d = drawRef.current;
    if (!d.origin || !d.dest) { setDrawMsg("Marca primero origen y destino en el mapa."); return; }
    setBusy("Generando la ruta segura sobre la red vial…");
    setDrawMsg("Generando ruta segura sobre la red vial…");
    let coords: [number, number][] = [];
    try {
      const r = await fetch(`${base()}/route/build`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ origin: d.origin, dest: d.dest, type: drawVeh || null,
          hour, risk_weight: riskWeight / 20 }),  // λ ∈ [0,5]
      });
      if (!r.ok) { setBusy(""); setDrawMsg("No se pudo trazar la ruta (puntos lejos de la red)."); return; }
      const j = await r.json();
      coords = j.coords;
      const map = mapRef.current;
      if (map && j.direct_coords) setLine(map, "direct", j.direct_coords as [number, number][]);
      const c = j.comparison;
      if (c) {
        const extra = c.direct_distance_m ? Math.round(100 * (c.safe_distance_m - c.direct_distance_m) / c.direct_distance_m) : 0;
        setSafeMsg(`Ruta segura: −${c.exposure_reduction_pct}% de exposición al riesgo vs. la directa (+${extra}% distancia).`);
        protectionRef.current = {
          exposure_reduction_pct: c.exposure_reduction_pct,
          safe_exposure: c.safe_exposure, direct_exposure: c.direct_exposure,
          safe_dist_m: c.safe_distance_m, direct_dist_m: c.direct_distance_m,
        };
      } else {
        protectionRef.current = null;
      }
      const adapted = j.vehicle_restricted ? `adaptada a ${labelForType(drawVeh || "car")}` : "red general";
      const dir = j.directional ? "respeta sentidos" : "sin sentido estricto";
      setDrawMsg(`Ruta ${(j.distance_m / 1000).toFixed(2)} km · ${adapted} · ${dir}. Simulando…`);
    } catch (e) { setBusy(""); setDrawMsg("Error: " + (e as Error).message); return; }
    excludeRef.current = null; typeRef.current = drawVeh || "car";
    setBusy("");
    startStream(coords);
  }

  function startStream(coords: [number, number][]) {
    const map = mapRef.current;
    if (!map || coords.length < 4) return;
    stopSim();
    setFinished(false); setNotifs([]); setLiveRisk(null); setLog([]);
    setPredInfo("Detectando movimiento…");
    tripAggRef.current = emptyTripAgg();
    tripMetaRef.current = { mode: modeRef.current, vehicle: typeRef.current, hour };
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
          // baseline ingenuo: extrapolar en línea recta el rumbo actual la misma distancia
          const prevPt = interpAt(coords, cum, Math.max(0, d - 25));
          const step = haversine(prevPt, pos);
          let baseFde = fde;
          if (step > 1e-6) {
            const f = cand.length_m / step;
            const straight: [number, number] = [pos[0] + (pos[0] - prevPt[0]) * f, pos[1] + (pos[1] - prevPt[1]) * f];
            baseFde = haversine(straight, realAhead);
          }
          const A = tripAggRef.current;
          A.n += 1; A.modelErr += fde; A.baseErr += baseFde;
          if (fde <= 50) A.modelHit50 += 1;
          if (baseFde <= 50) A.baseHit50 += 1;
          pushLog(`   modelo ${fde.toFixed(0)} m vs línea recta ${baseFde.toFixed(0)} m (viaje, n=${A.n})`);
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
              tripAggRef.current.alerts += 1;
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
    if (d >= total) { stopSim(); setFinished(true); setProgress(100); pushLog("🏁 Recorrido finalizado"); finishTrip(); }
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
        <button className={poisOn ? "on" : ""} onClick={() => togglePois(!poisOn)}>{poisOn ? "📍 Lugares: ON" : "📍 Lugares: OFF"}</button>
        <button className={follow ? "on" : ""} onClick={() => setFollow(!follow)}>{follow ? "🎯 Seguir: ON" : "🧭 Seguir: OFF"}</button>
        <button className="help-btn" onClick={() => setShowHelp(true)} title="¿Cómo funciona?">? Ayuda</button>
        {CLERK_ENABLED && <AuthBar onUser={setAuthUid} setGetToken={(fn) => { authGetTokenRef.current = fn; }} />}
      </div>

      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}

      <div className="panel">
        <h1>Nómada.AI</h1>
        <p className="subtitle">Navegación consciente del riesgo · Tumaco</p>
        <p className="panel-lead">Predice a dónde vas y te avisa de las zonas de riesgo <b>antes</b> de llegar,
          proponiendo la ruta que menos te expone. Aquí lo pruebas sobre Tumaco.</p>

        {health && (
          <>
            <div className="counts">
              <div><b>{(health.n_trajectories ?? 0).toLocaleString()}</b><span>trayectorias</span></div>
              <div><b>{(health.n_train ?? 0).toLocaleString()}</b><span>entrenan el modelo</span></div>
              <div><b>{(health.n_test ?? 0).toLocaleString()}</b><span>prueba (no vistas)</span></div>
            </div>
            <p className="counts-cap">Datos: simulación de tráfico de Tumaco (SUMO).</p>
          </>
        )}

        <h2 className="step">1 · Simular un viaje</h2>
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
            <label className="lbl">Prioridad de seguridad: <b>{riskWeight}%</b> {riskWeight === 0 ? "(ruta más corta)" : "(evita riesgo)"}</label>
            <input className="range" type="range" min={0} max={100} step={10} value={riskWeight} onChange={(e) => setRiskWeight(Number(e.target.value))} disabled={running} />
            <p className="hint" style={{ marginTop: 6 }}>{drawMsg}</p>
            {safeMsg && <div className="metric">{safeMsg}</div>}
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
              ? <button onClick={startTest} disabled={!tripId || !!busy}>{busy ? "⏳ " + busy : "▶ Iniciar simulación"}</button>
              : <button onClick={startDraw} disabled={!!busy}>{busy ? "⏳ " + busy : "▶ Generar ruta y simular"}</button>}
            <button className="secondary" onClick={clearAll} disabled={!!busy}>Limpiar</button>
          </div>
        ) : (
          <button className="secondary" onClick={stopSim}>■ Detener</button>
        )}
        {busy && <div className="status">⏳ {busy}</div>}

        {(running || finished) && <div className="clock">🕒 {fmtClock(clock)} · {timeScale === 1 ? "tiempo real" : `×${timeScale}`}</div>}
        <div className="progress"><div className="bar" style={{ width: `${progress}%` }} /></div>
        <p className="hint">{predInfo}</p>

        {(() => {
          const hv = histView();
          if (!hv && !histGlobal) return null;
          return (
            <>
            <h2 className="step">2 · Tu protección</h2>
            <div className="livecard">
              <div className="livecard-h">Lo que Nómada.AI hizo por ti · {authUid ? "en tu cuenta" : "anónimo, sin registro"}</div>

              {!hv && (
                <div className="evalrow" style={{ color: "var(--muted)" }}>Aún no tienes viajes. Corre una simulación para ver cómo te protege.</div>
              )}

              {hv?.prot ? (
                <>
                  <div className="evalbig">−{hv.prot.red}% <span>de exposición al riesgo evitada</span></div>
                  <div className="evalrow">eligiendo la ruta segura en vez de la directa · promedio de {hv.prot.n} {hv.prot.n === 1 ? "ruta" : "rutas"}</div>
                </>
              ) : hv ? (
                <div className="evalrow" style={{ color: "var(--muted)" }}>Genera una «Ruta nueva» y verás cuánto riesgo te evita el desvío seguro.</div>
              ) : null}

              {hv && (
                <div className="benefit">
                  <div><b>{hv.trips}</b><span>viajes</span></div>
                  <div><b>{hv.alerts}</b><span>alertas a tiempo</span></div>
                  <div><b>{hv.prot ? `−${hv.prot.red}%` : "—"}</b><span>riesgo evitado</span></div>
                </div>
              )}

              {histGlobal && (
                <div className="livecard-row" style={{ marginTop: 8, color: "var(--muted)" }}>
                  En toda la comunidad: {histGlobal.trips} {histGlobal.trips === 1 ? "viaje" : "viajes"} de {histGlobal.users} {histGlobal.users === 1 ? "persona" : "personas"}
                  {histGlobal.alerts ? ` · ${histGlobal.alerts} alertas` : ""}
                </div>
              )}

              {hv && (
                <div className="livecard-row" style={{ marginTop: 6, color: "var(--muted)" }}>
                  Desde {hv.since} · última {hv.updated} · {hv.source === "db" ? "base de datos" : "solo este navegador"}
                </div>
              )}
              {hv && (
                <div className="livecard-row" style={{ marginTop: 2 }}>
                  <a className="reset-link" onClick={resetHist}>Reiniciar mi histórico</a>
                </div>
              )}
            </div>
            </>
          );
        })()}

        <h2 className="step">3 · Rendimiento del sistema</h2>
        <p className="counts-cap">Qué tan bien predice (en viajes no vistos) y cuánto protege (en rutas reales).</p>
        <button className="eval-btn" onClick={runEval} disabled={evalLoading}>
          {evalLoading ? "Midiendo…" : "📊 Medir rendimiento"}
        </button>
        {evalRes && (
          <div className="evalcard">
            <button className="eval-close" onClick={() => setEvalRes(null)} title="Ocultar">✕</button>
            <div className="evalsub">Predicción de destino (viajes no vistos)</div>
            <div className="evalbig">{evalRes.overall.acc_50m_pct}% <span>acierto ≤50 m</span></div>
            <div className="evalrow">≤100 m: <b>{evalRes.overall.acc_100m_pct}%</b> · error mediano: <b>{evalRes.overall.fde_median_m} m</b> · {evalRes.evaluated} viajes</div>
            {evalRes.baseline?.acc_50m_pct != null && (
              <div className="evalrow" style={{ color: "#86efac" }}>
                vs. línea recta: {evalRes.baseline.acc_50m_pct}% (<b>+{evalRes.mejora_vs_baseline_pp} pp</b>; error {evalRes.baseline.fde_median_m} m)
              </div>
            )}
            {evalRes.markov?.acc_50m_pct != null && (
              <div className="evalrow" style={{ color: "#86efac" }}>
                vs. Markov (que aprende): {evalRes.markov.acc_50m_pct}% (<b>+{evalRes.mejora_vs_markov_pp} pp</b>; error {evalRes.markov.fde_median_m} m)
              </div>
            )}
            {Object.entries(evalRes.by_type).map(([t, v]: any) => (
              <div className="evalrow" key={t}>{labelForType(t)}: {v.acc_50m_pct}% ≤50 m (n={v.n})</div>
            ))}

            {evalAlerts && (
              <>
                <div className="evalsub">Alerta a tiempo</div>
                <div className="evalbig">{evalAlerts.pct_anticipadas}% <span>avisos ANTES de la zona</span></div>
                <div className="evalrow">{evalAlerts.pct_con_alerta}% de viajes con alerta · anticipación media <b>{evalAlerts.anticipacion_media_m} m</b> (~{evalAlerts.anticipacion_media_s} s)</div>
              </>
            )}

            {histGlobal?.proteccion && (
              <>
                <div className="evalsub">Protección en rutas reales</div>
                <div className="evalbig">−{histGlobal.proteccion.exposure_reduction_avg_pct}% <span>de exposición al riesgo</span></div>
                <div className="evalrow">promedio sobre {histGlobal.proteccion.n} {histGlobal.proteccion.n === 1 ? "ruta generada" : "rutas generadas"} por los usuarios · {histGlobal.trips} viajes en total</div>
              </>
            )}

            {evalScn && evalScn.length > 0 && (
              <details className="scn-details">
                <summary>Ver escenarios por hora y umbral ({evalScn.length})</summary>
                <p className="counts-cap" style={{ marginTop: 6 }}>% de la ruta con riesgo y % de alertas a tiempo (look-ahead 300 m).</p>
                <table className="scn">
                  <thead><tr><th>Hora</th><th>Umbral</th><th>% riesgo</th><th>% a tiempo</th></tr></thead>
                  <tbody>
                    {evalScn.map((s, i) => (
                      <tr key={i}><td>{String(s.hora).padStart(2, "0")}:00</td><td>{s.umbral}</td><td>{s.pct_con_riesgo}%</td><td>{s.pct_anticipadas}%</td></tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </div>
        )}

        <div className="legend">
          <span className="leg"><span className="dot blue" /> capturado</span>
          <span className="leg"><span className="dot orange" /> predicho</span>
          <span className="leg"><span className="dot red" /> zona alerta</span>
          <span className="leg"><span className="dot gray" /> ruta directa</span>
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
          <div className="phone-status">{running || finished ? fmtClock(clock) : `${String(hour).padStart(2, "0")}:00`} · Nómada.AI</div>
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

// ---------- panel de ayuda ----------
function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-modal" onClick={(e) => e.stopPropagation()}>
        <button className="help-x" onClick={onClose} title="Cerrar">✕</button>
        <h2>¿Cómo funciona Nómada.AI?</h2>
        <p className="help-lead">
          Nómada.AI predice <b>a dónde vas</b> mientras te mueves y te <b>avisa de las zonas de riesgo
          antes de llegar</b>, proponiendo la ruta que menos te expone. Aquí lo simulamos sobre Tumaco.
        </p>

        <h3>Lo primero que ves</h3>
        <ul>
          <li><b>Total / Entrenamiento / No vistas:</b> cuántos viajes hay. El modelo solo “estudia” los
            de entrenamiento; los <b>no vistos</b> son su examen (nunca los vio).</li>
          <li><b>Mapa de colores:</b> el riesgo por zona y hora. Verde = bajo, amarillo/naranja = medio,
            rojo = alto. Cambia según la <b>hora de salida</b>.</li>
        </ul>

        <h3>Para probarlo</h3>
        <ul>
          <li><b>Viaje no visto:</b> reproduce un viaje real que el modelo no conoce. Sirve para ver si
            <i>de verdad</i> acierta.</li>
          <li><b>Ruta nueva:</b> haz clic en el mapa (1 = dónde estás, 2 = a dónde vas) y el sistema
            arma la ruta y la simula.</li>
          <li><b>Iniciar simulación:</b> el carrito navega; arriba a la derecha el “teléfono” muestra las
            <b>notificaciones</b> como las vería un usuario real.</li>
        </ul>

        <h3>Los controles</h3>
        <ul>
          <li><b>Hora de salida:</b> el riesgo es dinámico; no es lo mismo ir a las 06:00 que a las 20:00.</li>
          <li><b>Velocidad del reloj:</b> qué tan rápido corre la simulación (×1 = tiempo real).</li>
          <li><b>Umbral de alerta:</b> a partir de qué nivel de riesgo te avisa.</li>
          <li><b>Prioridad de seguridad:</b> 0% = ruta más corta; 100% = rodea el riesgo aunque sea más largo.</li>
          <li><b>Botones de arriba:</b> tema claro/oscuro, mapa satelital, capa de riesgo on/off, y seguir al vehículo.</li>
        </ul>

        <h3>Medir efectividad</h3>
        <ul>
          <li><b>Predicción de destino:</b> % de acierto del modelo sobre viajes no vistos, y cuánto
            <b>mejora frente a “seguir en línea recta”</b> (la prueba de que no es trivial).</li>
          <li><b>Protección:</b> qué porcentaje de las veces la alerta llega <b>antes</b> de la zona, y con
            cuántos metros de anticipación.</li>
          <li><b>Escenarios:</b> el mismo experimento repetido por hora y umbral.</li>
        </ul>

        <h3>Histórico comparativo</h3>
        <p>Cada viaje simulado guarda <b>dos comparaciones</b> y las acumula:</p>
        <ul>
          <li><b>Predicción:</b> el modelo <b>vs “seguir en línea recta”</b> — demuestra que el AI aporta.</li>
          <li><b>Protección:</b> la <b>ruta segura vs la directa</b> — cuánta exposición al riesgo se evita.</li>
        </ul>
        <p>Se guarda en <b>base de datos</b> (persiste entre dispositivos y usuarios; base para el
          producto). Si la base de datos no está configurada, cae a este navegador. No se borra al
          limpiar el mapa; solo con <i>“Reiniciar histórico”</i>.</p>

        <h3>La consola “Actividad del sistema”</h3>
        <p>Son las <b>entradas y salidas del modelo en vivo</b> (lo que envía el teléfono, lo que predice
          y la zona de riesgo que detecta). Es la “caja transparente” del sistema.</p>

        <h3>Dudas frecuentes</h3>
        <ul>
          <li><b>¿El modelo “aprende” mientras lo uso?</b> No: predice por <b>analogía</b> con viajes
            pasados parecidos. Es estable y auditable a propósito; lo que crece con el uso es el histórico.</li>
          <li><b>¿Tengo que iniciar sesión?</b> No. Funciona <b>sin registro</b> (invitado): se te
            asigna un identificador anónimo en este navegador. Si <b>inicias sesión</b> (opcional,
            con Google o correo), tu protección se guarda en <b>tu cuenta</b> y te sigue entre
            dispositivos.</li>
          <li><b>¿Sirve para otra ciudad?</b> Sí. La lógica es la misma; basta cambiar los datos
            (trayectorias y riesgo) de la nueva ciudad. Está pensado para ser <b>replicable</b>.</li>
          <li><b>¿Esto es la app final?</b> Es la versión web de demostración. La app se llevará a
            <b>Android e iOS</b> reutilizando el mismo motor (predicción + riesgo + rutas seguras).</li>
        </ul>
      </div>
    </div>
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
function fmtDate(ms: number | null): string {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString("es-CO", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
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
