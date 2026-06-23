import type { StyleSpecification } from "maplibre-gl";

// Estilo MapLibre gratis: base plano (OpenStreetMap) + satelital (ESRI World Imagery).
// Ambas capas raster sin API key; se alterna su visibilidad desde la app.
export const osmStyle: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
    satellite: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Imagery © Esri",
    },
  },
  layers: [
    { id: "osm", type: "raster", source: "osm" },
    { id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" } },
  ],
};

// Centro aproximado del Distrito de Tumaco, Nariño.
export const TUMACO_CENTER: [number, number] = [-78.785, 1.806];
export const TUMACO_ZOOM = 13;
