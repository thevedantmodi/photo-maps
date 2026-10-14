// Mapbox styles, shared by the public map and the admin location picker so the
// two never drift apart.
export const MAP_STYLES = {
  light: 'mapbox://styles/mapbox/outdoors-v12',
  dark: 'mapbox://styles/legoironman1234/cmoqnuxjt006f01s4e6lc071y',
} as const;

// Imagery with roads and place names on top, so search results and the
// sidebar's places still have labels to land on. Same in either theme.
export const SATELLITE_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';
