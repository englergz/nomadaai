import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
  FeatureCollection as ApiFC,
  HealthResponse,
  PredictionCandidate,
} from "@nomadaai/shared";
import { api } from "./lib/api";
import { osmStyle, TUMACO_CENTER, TUMACO_ZOOM } from "./lib/mapStyle";

type Mode = "idle" | "drawing";

export default function App() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [prefix, setPrefix] = useState<[number, number][]>([]);
  const [candidates, setCandidates] = useState<PredictionCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const prefixRef = useRef<[number, number][]>([]);
  const modeRef = useRef<Mode>("idle");

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
      // capa de corredores TRACLUS (OE1)
      try {
        const fc = (await api.corridors(undefined, 8000)) as ApiFC;
        map.addSource("corridors", { type: "geojson", data: fc as never });
        map.addLayer({
          id: "corridors",
          type: "line",
          source: "corridors",
          paint: { "line-color": "#8b98a5", "line-width": 1, "line-opacity": 0.5 },
        });
      } catch (e) {
        console.error("corredores:", e);
      }

      // fuentes para prefijo y predicción
      emptyFC(map, "prefix-pts", "circle", {
        "circle-radius": 5,
        "circle-color": "#2f81f7",
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 1,
      });
      emptyFC(map, "candidates", "line", {
        "line-color": "#f78166",
        "line-width": 3,
      });
    });

    map.on("click", (e) => {
      if (modeRef.current !== "drawing") return;
      const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      const next = [...prefixRef.current, pt];
      prefixRef.current = next;
      setPrefix(next);
      updatePoints(map, next);
    });

    api.health().then(setHealth).catch(console.error);
    return () => map.remove();
  }, []);

  function startDrawing() {
    modeRef.current = "drawing";
    setMode("drawing");
    prefixRef.current = [];
    setPrefix([]);
    setCandidates([]);
    const map = mapRef.current!;
    updatePoints(map, []);
    setCandidateLines(map, []);
  }

  function clearAll() {
    modeRef.current = "idle";
    setMode("idle");
    prefixRef.current = [];
    setPrefix([]);
    setCandidates([]);
    const map = mapRef.current!;
    updatePoints(map, []);
    setCandidateLines(map, []);
  }

  async function predict() {
    if (prefix.length < 3) return;
    setBusy(true);
    try {
      const res = await api.predictDestination({
        points: prefix.map(([lon, lat], i) => ({ lon, lat, t: i })),
        topk: 5,
      });
      setCandidates(res.candidates);
      setCandidateLines(mapRef.current!, res.candidates);
      modeRef.current = "idle";
      setMode("idle");
    } catch (e) {
      console.error(e);
      alert("Error al predecir: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div id="map" ref={containerRef} />
      <div className="panel">
        <h1>NómadaAI</h1>
        <p className="subtitle">
          Gestión segura de rutas urbanas · Tumaco, Nariño
        </p>

        <div className="status">
          {health
            ? `API ${health.status} · ${health.n_trajectories} trayectorias · ${health.n_corridors} corredores`
            : "Conectando con la API…"}
        </div>

        <h2>Predicción de destino (OE1)</h2>
        <p className="hint">
          {mode === "drawing"
            ? `Haz clic en el mapa para trazar el recorrido observado (≥3 puntos). Llevas ${prefix.length}.`
            : "Traza el inicio de un recorrido y el sistema predice su continuación por analogía."}
        </p>
        {mode === "idle" ? (
          <button onClick={startDrawing}>Trazar recorrido</button>
        ) : (
          <div className="row">
            <button onClick={predict} disabled={prefix.length < 3 || busy}>
              {busy ? "Prediciendo…" : "Predecir"}
            </button>
            <button className="secondary" onClick={clearAll}>
              Limpiar
            </button>
          </div>
        )}

        {candidates.length > 0 && (
          <>
            <h2>Candidatos</h2>
            {candidates.map((c) => (
              <p key={c.rank} className="hint">
                #{c.rank} · vecino <b>{c.neighbor_id}</b> · {c.length_m.toFixed(0)} m
                · conf {(c.confidence * 100).toFixed(0)}%
              </p>
            ))}
            <button className="secondary" onClick={clearAll}>
              Limpiar
            </button>
          </>
        )}

        <h2>Capa de riesgo (OE2)</h2>
        <p className="badge">Pendiente — requiere datos georreferenciados.</p>
      </div>
    </>
  );
}

// --- helpers de mapa ---
function emptyFC(
  map: maplibregl.Map,
  id: string,
  type: "circle" | "line",
  paint: Record<string, unknown>
) {
  map.addSource(id, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] } as never,
  });
  map.addLayer({ id, type, source: id, paint } as never);
}

function updatePoints(map: maplibregl.Map, pts: [number, number][]) {
  const src = map.getSource("prefix-pts") as maplibregl.GeoJSONSource | undefined;
  src?.setData({
    type: "FeatureCollection",
    features: pts.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: p },
      properties: {},
    })),
  } as never);
}

function setCandidateLines(map: maplibregl.Map, cands: PredictionCandidate[]) {
  const src = map.getSource("candidates") as maplibregl.GeoJSONSource | undefined;
  src?.setData({
    type: "FeatureCollection",
    features: cands.map((c) => ({
      type: "Feature",
      geometry: c.geometry,
      properties: { rank: c.rank },
    })),
  } as never);
}
