import type { Map as MapboxMap } from "mapbox-gl";

// Relief for the public map: a raster DEM feeding both a hillshade layer and
// (optionally) 3D terrain. setStyle wipes runtime sources, layers, terrain and
// fog, so applyRelief runs again after every style.load.

export const DEM_SOURCE_ID = "mapbox-dem";
const HILLSHADE_LAYER_ID = "relief-hillshade";

export const TERRAIN_EXAGGERATION = 1.2;

// Pitch used when flying into a place with terrain on; flat otherwise.
export const PLACE_PITCH = 45;
export const PLACE_PITCH_MIN_ZOOM = 9;

const FOG = {
  "star-intensity": 0.8,
  color: "rgb(8, 8, 28)",
  "high-color": "#000010",
  "horizon-blend": 0.02,
  "space-color": "#000005",
};

// Tuned so the light outdoors style, which already carries vector hillshade,
// gains depth without turning muddy, and the dark style gets visible relief.
const HILLSHADE_PAINT = {
  light: {
    "hillshade-exaggeration": 0.25,
    "hillshade-shadow-color": "#3d4a5c",
    "hillshade-highlight-color": "#ffffff",
    "hillshade-accent-color": "#3d4a5c",
  },
  dark: {
    "hillshade-exaggeration": 0.45,
    "hillshade-shadow-color": "#000000",
    "hillshade-highlight-color": "#5a6475",
    "hillshade-accent-color": "#000000",
  },
} as const;

export function applyRelief(
  map: MapboxMap,
  theme: "light" | "dark",
  terrain: boolean,
) {
  if (!map.getSource(DEM_SOURCE_ID)) {
    map.addSource(DEM_SOURCE_ID, {
      type: "raster-dem",
      url: "mapbox://mapbox.mapbox-terrain-dem-v1",
      tileSize: 512,
      maxzoom: 14,
    });
  }

  if (!map.getLayer(HILLSHADE_LAYER_ID)) {
    // Under the first label so place names stay crisp on top of the shading.
    const firstSymbol = map
      .getStyle()
      ?.layers?.find((l) => l.type === "symbol")?.id;
    map.addLayer(
      {
        id: HILLSHADE_LAYER_ID,
        type: "hillshade",
        source: DEM_SOURCE_ID,
        paint: HILLSHADE_PAINT[theme],
      },
      firstSymbol,
    );
  }

  setTerrain(map, terrain);
  map.setFog(FOG);
}

export function setTerrain(map: MapboxMap, enabled: boolean) {
  map.setTerrain(
    enabled ? { source: DEM_SOURCE_ID, exaggeration: TERRAIN_EXAGGERATION } : null,
  );
}
