// Renders the camera mark to the PWA icons in public/icons. Run: npx tsx scripts/generate-pwa-icons.ts
import sharp from 'sharp';
import { CAMERA, CAMERA_VIEW as V, equatorPath, globeRadius } from '../src/lib/cameraMark';

const ADMIN_BG = '#e8b04a';
const INK = '#141414';

/** The mark on a square tile; `scale` is the mark's width as a share of the tile. */
function svg(size: number, scale: number, bg: string) {
  const w = size * scale;
  const k = w / V.w;
  const sw = 2.2;
  const g = globeRadius(false);
  const { lens } = CAMERA;
  const tx = (size - w) / 2;
  const ty = (size - V.h * k) / 2 - V.y * k;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<rect width="${size}" height="${size}" fill="${bg}"/>
<g transform="translate(${tx} ${ty}) scale(${k})" fill="none" stroke="${INK}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
<path d="${CAMERA.body}"/><path d="${CAMERA.grip}" stroke-width="${sw * 0.8}"/>
<rect x="${CAMERA.shutter.x}" y="${CAMERA.shutter.y}" width="${CAMERA.shutter.width}" height="${CAMERA.shutter.height}" rx="${CAMERA.shutter.rx}"/>
<rect x="${CAMERA.modeDial.x}" y="${CAMERA.modeDial.y}" width="${CAMERA.modeDial.width}" height="${CAMERA.modeDial.height}" rx="${CAMERA.modeDial.rx}"/>
<rect x="${CAMERA.smallDial.x}" y="${CAMERA.smallDial.y}" width="${CAMERA.smallDial.width}" height="${CAMERA.smallDial.height}" rx="${CAMERA.smallDial.rx}"/>
<circle cx="${lens.cx}" cy="${lens.cy}" r="${lens.r}"/><circle cx="${lens.cx}" cy="${lens.cy}" r="${g}"/>
<path d="${equatorPath(g)}" stroke-width="${sw * 0.85}"/>
<ellipse cx="${lens.cx}" cy="${lens.cy}" rx="${g * 0.42}" ry="${g}" stroke-width="${sw * 0.85}"/>
</g></svg>`;
}

const out = (name: string, size: number, scale: number, bg = '#ededeb') =>
  sharp(Buffer.from(svg(size, scale, bg))).png().toFile(`public/icons/${name}`);

Promise.all([
  out('icon-192.png', 192, 0.7),
  out('icon-512.png', 512, 0.7),
  // Maskable: the mark stays inside the central 80% safe zone.
  out('icon-maskable-512.png', 512, 0.5),
  out('apple-touch-icon.png', 180, 0.7),
  // The admin app is tinted so it's easy to tell apart on the home screen.
  out('admin-192.png', 192, 0.7, ADMIN_BG),
  out('admin-512.png', 512, 0.7, ADMIN_BG),
  out('admin-maskable-512.png', 512, 0.5, ADMIN_BG),
]).catch((e) => {
  console.error(e);
  process.exit(1);
});
