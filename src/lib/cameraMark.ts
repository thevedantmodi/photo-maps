/**
 * The camera mark's geometry, shared by the site (components/Mark.tsx) and the share card
 * (lib/shareCard.tsx). A compact camera seen from the front on a 64-wide grid, its lens a
 * globe. The drawing occupies y 10 to 50.
 */
export const CAMERA_VIEW = { x: 0, y: 10, w: 64, h: 40 };

export const CAMERA = {
  body: 'M6 14h52a4 4 0 0 1 4 4v26a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4z',
  grip: 'M16.5 14.6c0.8 4 0.8 29 0 32.8',
  shutter: { x: 5.5, y: 12.2, width: 8, height: 1.8, rx: 0.6 },
  modeDial: { x: 15, y: 11.2, width: 8.5, height: 2.8, rx: 0.5 },
  smallDial: { x: 25, y: 11.4, width: 5.5, height: 2.6, rx: 0.6 },
  afLamp: { cx: 21.2, cy: 18.6, r: 1.1 },
  lensRelease: { cx: 58.3, cy: 37.5, r: 1.4 },
  lens: { cx: 39.5, cy: 31, r: 14.4 },
};

/** The globe's radius inside the lens: the detailed mark keeps room for an inner ring. */
export function globeRadius(detailed: boolean) {
  return CAMERA.lens.r - (detailed ? 5 : 4);
}

/** Knurling across the mode dial's face: `count` short vertical strokes. */
export function knurlPath(count: number) {
  const { x, y, width, height } = CAMERA.modeDial;
  let d = '';
  for (let i = 0; i < count; i++) {
    const kx = x + ((i + 0.5) * width) / count;
    d += `M${kx.toFixed(2)} ${(y + 0.55).toFixed(2)}V${(y + height - 0.55).toFixed(2)}`;
  }
  return d;
}

/** The globe's equator, and the half-circle the loader turns as a meridian. */
export function equatorPath(r: number) {
  const { cx, cy } = CAMERA.lens;
  return `M${cx - r} ${cy}h${2 * r}`;
}

export function meridianArcPath(r: number) {
  const { cx, cy } = CAMERA.lens;
  return `M${cx} ${cy - r}A${r} ${r} 0 0 1 ${cx} ${cy + r}`;
}
