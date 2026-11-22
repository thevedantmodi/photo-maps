/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text --
   This JSX is rendered by satori into a PNG, not into the DOM: next/image does not exist
   there, and alt text has nowhere to go. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ImageResponse } from 'next/og';
import sharp from 'sharp';

import { CAMERA, CAMERA_VIEW, equatorPath, globeRadius } from '@/lib/cameraMark';
import { exposureLine, type CameraDetails } from '@/lib/camera';
import { photoTitle } from '@/lib/alt';
import { placeNameFor } from '@/lib/placeName';
import { BORDER, CARD, EDGE_GAP, FONT, MAP, PALETTE, PHOTO_SHADOW, TYPE, WINDOW } from '@/lib/shareTokens';
import { mapBackground } from '@/lib/staticMap';
import type { CardTheme } from '@/lib/shareVersion';

/**
 * The card is a "letterbox": the photo fitted whole inside a window, a thin border all
 * round, and the metadata printed along the border like the edge of a strip of film.
 * Where the photo leaves bars, they show a faint map of where it was taken (staticMap.ts).
 *
 *   top edge     the camera mark and name, the year       (under Instagram's top bar: fine to lose)
 *   left edge    caption · place · camera, reading up     (inside the safe band)
 *   right edge   date · exposure · link, reading down     (inside the safe band)
 *   bottom edge  the coordinates                          (under the reply box: fine to lose)
 */

/** How long each side edge's text may run: the safe band between Instagram's overlays. */
const EDGE_LENGTH = CARD.height - 2 * CARD.safeInset;

// Average advance per character, in em, for estimating how long a line will be before
// satori lays it out. Geist is proportional (a little wider at 600); Geist Mono is 0.6.
const EM_REGULAR = 0.56;
const EM_SEMIBOLD = 0.58;
const EM_MONO = 0.6;

type Part = {
  text: string;
  fontSize: number;
  fontWeight?: 400 | 600;
  letterSpacing?: number;
  mono?: boolean;
  muted?: boolean;
  /** Left out first when the edge runs out of room. */
  optional?: boolean;
  /** Shortened with "…" when leaving out the optional parts is not enough. */
  truncate?: boolean;
};

function emPerChar(p: Part): number {
  if (p.mono) return EM_MONO;
  return p.fontWeight === 600 ? EM_SEMIBOLD : EM_REGULAR;
}

function partWidth(p: Part): number {
  return p.text.length * (p.fontSize * emPerChar(p) + (p.letterSpacing ?? 0));
}

function lineWidth(parts: Part[]): number {
  return parts.reduce((w, p) => w + partWidth(p), 0) + EDGE_GAP * Math.max(0, parts.length - 1);
}

/**
 * Fits one edge's parts into `max` px: drops the optional ones, then shortens the
 * truncatable ones in order, so a long caption gives way rather than running off the card.
 */
function fitEdge(parts: Part[], max: number): Part[] {
  let out = parts;
  if (lineWidth(out) > max) out = out.filter((p) => !p.optional);
  for (const p of out) {
    const over = lineWidth(out) - max;
    if (over <= 0) break;
    if (!p.truncate) continue;
    const perChar = p.fontSize * emPerChar(p) + (p.letterSpacing ?? 0);
    const keep = Math.max(1, p.text.length - Math.ceil(over / perChar) - 1);
    const text = `${p.text.slice(0, keep).trimEnd()}…`;
    out = out.map((q) => (q === p ? { ...p, text } : q));
  }
  return out;
}

const FONT_DIR = join(process.cwd(), 'src', 'app', 'fonts');

const fontFile = (name: string) => readFile(join(FONT_DIR, name));

/**
 * Loaded on first use, not at module scope: during `next build` the module is evaluated
 * in a context without fs, and reading there fails the page-data collection pass.
 * next.config.ts traces src/app/fonts so these files exist at runtime.
 */
let fontsPromise: ReturnType<typeof loadFonts> | null = null;

function loadFonts() {
  return Promise.all([
    fontFile('Geist-Regular.ttf'),
    fontFile('Geist-SemiBold.ttf'),
    fontFile('GeistMono-Regular.ttf'),
  ]).then(([regular, semibold, mono]) => [
    { name: FONT.sans, data: regular, weight: 400 as const, style: 'normal' as const },
    { name: FONT.sans, data: semibold, weight: 600 as const, style: 'normal' as const },
    { name: FONT.mono, data: mono, weight: 400 as const, style: 'normal' as const },
  ]);
}

function fonts() {
  if (!fontsPromise) fontsPromise = loadFonts();
  return fontsPromise;
}

const dataUri = (buf: Buffer, type: string) =>
  `data:${type};base64,${buf.toString('base64')}`;

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** 27.17328, 78.04211 → ["27.17328° N", "78.04211° E"]. */
function formatCoords(lat: number, lon: number): [string, string] {
  return [
    `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}`,
    `${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`,
  ];
}

/** The typeable link printed on the card — protocol stripped, since nobody types it. */
function displayUrl(base: string, slug: string): string {
  return `${base}/p/${slug}`.replace(/^https?:\/\//, '');
}

/** The site's camera mark, the simple (header) version, drawn for satori. */
function CameraMark({ color }: { color: string }) {
  const width = 44;
  const sw = 2.2;
  const globe = globeRadius(false);
  const { lens } = CAMERA;
  const line = { fill: 'none', stroke: color, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <svg
      width={width}
      height={(width * CAMERA_VIEW.h) / CAMERA_VIEW.w}
      viewBox={`${CAMERA_VIEW.x} ${CAMERA_VIEW.y} ${CAMERA_VIEW.w} ${CAMERA_VIEW.h}`}
      style={{ marginRight: 14 }}
    >
      <path d={CAMERA.body} {...line} strokeWidth={sw} />
      <path d={CAMERA.grip} {...line} strokeWidth={sw * 0.8} />
      <rect {...CAMERA.shutter} {...line} strokeWidth={sw * 0.85} />
      <rect {...CAMERA.modeDial} {...line} strokeWidth={sw * 0.85} />
      <rect {...CAMERA.smallDial} {...line} strokeWidth={sw * 0.85} />
      <circle {...lens} {...line} strokeWidth={sw} />
      <circle cx={lens.cx} cy={lens.cy} r={globe} {...line} strokeWidth={sw} />
      <path d={equatorPath(globe)} {...line} strokeWidth={sw * 0.85} />
      <ellipse cx={lens.cx} cy={lens.cy} rx={globe * 0.42} ry={globe} {...line} strokeWidth={sw * 0.85} />
    </svg>
  );
}

/** One side edge: a band EDGE_LENGTH long, turned to run up (left) or down (right) the card. */
function SideEdge({ side, parts, ink, muted }: { side: 'left' | 'right'; parts: Part[]; ink: string; muted: string }) {
  // Laid out horizontally, centred on the border's midline, then turned about its centre:
  // -90° puts its start at the bottom of the safe band, +90° at the top.
  const centerX = side === 'left' ? BORDER / 2 : CARD.width - BORDER / 2;
  return (
    <div
      style={{
        position: 'absolute',
        left: centerX - EDGE_LENGTH / 2,
        top: CARD.height / 2 - BORDER / 2,
        width: EDGE_LENGTH,
        height: BORDER,
        display: 'flex',
        alignItems: 'center',
        transform: `rotate(${side === 'left' ? -90 : 90}deg)`,
        transformOrigin: 'center',
      }}
    >
      {parts.map((p, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            flex: 'none',
            marginLeft: i === 0 ? 0 : EDGE_GAP,
            fontFamily: p.mono ? FONT.mono : FONT.sans,
            fontSize: p.fontSize,
            fontWeight: p.fontWeight ?? 400,
            letterSpacing: p.letterSpacing ?? 0,
            color: p.muted ? muted : ink,
            whiteSpace: 'nowrap',
          }}
        >
          {p.text}
        </div>
      ))}
    </div>
  );
}

/** The subset of Photo that determines what a share card shows and where it's fetched from. */
export type ShareCardPhoto = {
  friendly_name: string;
  caption: string | null;
  original_name: string;
  date: string | null;
  lat: number | null;
  lon: number | null;
  large_url: string;
} & Pick<CameraDetails, 'camera' | 'focal_length_mm' | 'f_number' | 'exposure_s' | 'iso'>;

/**
 * Renders a photo's share card to PNG bytes, in the dark or light theme. Shared by the
 * live-render fallback in /api/share/[slug] and the precompute path in shareCardStore —
 * same output either way.
 */
export async function renderShareCardPng(
  photo: ShareCardPhoto,
  base: string,
  theme: CardTheme,
): Promise<Buffer> {
  const colors = PALETTE[theme];
  const source = await fetch(photo.large_url);
  if (!source.ok) throw new Error(`share card source fetch failed: ${source.status}`);
  const buf = Buffer.from(await source.arrayBuffer());

  const hasCoords = photo.lat != null && photo.lon != null;
  const place = hasCoords ? await placeNameFor(photo.lat!, photo.lon!) : null;
  const date = formatDate(photo.date);
  const year = photo.date ? new Date(photo.date).getFullYear() : null;
  const exposure = exposureLine(photo);

  const left = fitEdge(
    [
      { text: photoTitle(photo), ...TYPE.caption, truncate: true },
      ...(place ? [{ text: place, ...TYPE.place, muted: true, truncate: true }] : []),
      ...(photo.camera ? [{ text: photo.camera, ...TYPE.camera, muted: true, optional: true }] : []),
    ],
    EDGE_LENGTH,
  );
  const right = fitEdge(
    [
      ...(date ? [{ text: date, ...TYPE.date }] : []),
      ...(exposure ? [{ text: exposure, ...TYPE.camera, muted: true, optional: true }] : []),
      { text: displayUrl(base, photo.friendly_name), ...TYPE.mono, mono: true, muted: true },
    ],
    EDGE_LENGTH,
  );

  // Fitted whole, never cropped, never upscaled: the window's bars take up the rest.
  const fitted = await sharp(buf)
    .resize(WINDOW.width, WINDOW.height, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });

  // Where the photo leaves bars and was taken somewhere known, the bars show the map of
  // that place: one map behind the whole window, centred on the spot, so the photo sits on
  // it. A photo that (nearly) fills the window has no bars to show it in, so no map.
  const hasBars =
    WINDOW.height - fitted.info.height >= 2 * MAP.minBar || WINDOW.width - fitted.info.width >= 2 * MAP.minBar;
  const map = hasCoords && hasBars ? await mapBackground(photo.lat!, photo.lon!, theme) : null;

  const edgeRow = {
    position: 'absolute',
    left: BORDER,
    right: BORDER,
    height: BORDER,
    display: 'flex',
    alignItems: 'center',
  } as const;

  const element = (
    <div
      style={{
        position: 'relative',
        width: CARD.width,
        height: CARD.height,
        display: 'flex',
        background: colors.bg,
        color: colors.ink,
        fontFamily: FONT.sans,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: BORDER,
          left: BORDER,
          width: WINDOW.width,
          height: WINDOW.height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          borderRadius: WINDOW.radius,
          background: colors.bar,
        }}
      >
        {map ? (
          <img
            src={dataUri(map, 'image/jpeg')}
            width={WINDOW.width}
            height={WINDOW.height}
            style={{ position: 'absolute', top: 0, left: 0 }}
          />
        ) : null}
        <img
          src={dataUri(fitted.data, 'image/jpeg')}
          width={fitted.info.width}
          height={fitted.info.height}
          style={map ? { boxShadow: PHOTO_SHADOW[theme] } : undefined}
        />
      </div>

      <div style={{ ...edgeRow, top: 0, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <CameraMark color={colors.ink} />
          <div style={{ display: 'flex', fontSize: TYPE.name.fontSize, letterSpacing: TYPE.name.letterSpacing }}>
            Vedant Modi
          </div>
        </div>
        {year !== null ? (
          <div
            style={{
              display: 'flex',
              fontSize: TYPE.year.fontSize,
              fontWeight: TYPE.year.fontWeight,
              letterSpacing: TYPE.year.letterSpacing,
            }}
          >
            {String(year)}
          </div>
        ) : null}
      </div>

      <SideEdge side="left" parts={left} ink={colors.ink} muted={colors.muted} />
      <SideEdge side="right" parts={right} ink={colors.ink} muted={colors.muted} />

      {hasCoords ? (
        <div
          style={{
            ...edgeRow,
            bottom: 0,
            fontFamily: FONT.mono,
            fontSize: TYPE.mono.fontSize,
            color: colors.muted,
          }}
        >
          {formatCoords(photo.lat!, photo.lon!).map((c, i) => (
            <div key={i} style={{ display: 'flex', marginLeft: i === 0 ? 0 : EDGE_GAP }}>
              {c}
            </div>
          ))}
          {/* Mapbox's terms ask for visible credit; the static image is fetched without its own. */}
          {map ? (
            <div style={{ display: 'flex', marginLeft: 'auto', fontSize: TYPE.credit.fontSize }}>{MAP.credit}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const imageResponse = new ImageResponse(element, {
    width: CARD.width,
    height: CARD.height,
    fonts: await fonts(),
  });

  return Buffer.from(await imageResponse.arrayBuffer());
}
