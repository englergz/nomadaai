import type { StyleSpecification } from "maplibre-gl";

// Estilo MapLibre 100% gratis con tiles raster de OpenStreetMap (sin API key).
export const osmStyle: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

// Centro aproximado del Distrito de Tumaco, Nariño.
export const TUMACO_CENTER: [number, number] = [-78.785, 1.806];
export const TUMACO_ZOOM = 13;
