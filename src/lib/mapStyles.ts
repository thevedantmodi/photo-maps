// Mapbox styles, shared by the public map and the admin location picker so the
// two never drift apart. Mapbox's own monochrome styles: quiet greys that let the
// photographs carry the colour.
export const MAP_STYLES = {
  light: 'mapbox://styles/mapbox/light-v11',
  dark: 'mapbox://styles/mapbox/dark-v11',
} as const;
