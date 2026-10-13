/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text --
   This JSX is rendered by satori into a PNG, not into the DOM: next/image does not exist
   there, and alt text has nowhere to go. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ImageResponse } from 'next/og';
import sharp from 'sharp';

import { mapTile, placeName } from '@/lib/shareLocation';
import {
  AMBIENT,
  BACKGROUND,
  CARD,
  FONT,
  GLASS,
  MAP,
  OG,
  PHOTO,
  PIN,
  TYPE,
} from '@/lib/shareTokens';

/**
 * The ambient layer is blurred beyond recognition, so it is rendered small and upscaled by
 * satori. Measured on a 287 KB source: 10 ms this way against 61 ms blurring the full
 * 1080x1920 buffer, for an identical result. Both are noise next to satori's ~2.6 s.
 */
const AMBIENT_DIVISOR = 4;

/** Gap between the photo and the plate below it. */
const PLATE_GAP = 60;

/** Border width of the glass plate (GLASS.border). */
const PLATE_BORDER = 3;

/** Vertical gap between the rows of text on the plate. */
const ROW_GAP = 14;

// Geist averages ~0.52em per character at these sizes; Geist Mono is a true 0.6em.
const charsPerLine = (width: number, fontSize: number) => Math.floor(width / (fontSize * 0.52));
const monoCharsPerLine = (width: number, fontSize: number) => Math.floor(width / (fontSize * 0.6));

const MAX_CAPTION_LINES = 4;
const MAX_OG_CAPTION_LINES = 3;
const MAX_PLACE_LINES = 2;

/**
 * Wrapping breaks at word boundaries, so a full line holds fewer characters than fit across
 * it. Measured on Geist captions: about 10% fewer.
 */
const WRAP_SLACK = 0.9;

/** Clamps text to `lines` lines of `perLine` characters, with an ellipsis if it was cut. */
function clamp(text: string, perLine: number, lines: number): { text: string; lines: number } {
  const limit = Math.floor(lines * perLine * WRAP_SLACK);
  // Cut at the last word boundary when there is one, rather than mid-word.
  const cut = text.slice(0, limit - 1);
  const clamped =
    text.length > limit ? `${(cut.replace(/\s+\S*$/, '') || cut).trimEnd()}…` : text;
  return { text: clamped, lines: Math.min(lines, Math.max(1, Math.ceil(clamped.length / perLine))) };
}

/** The place line is led by a pin icon about one em wide, plus its gap. */
const PLACE_ICON_CHARS = 2;

/**
 * The plate is laid out by satori, so its height is not known until after render — but the
 * photo has to be resized before that. Estimate the plate's height from the text it will
 * hold and give the photo whatever vertical space is left, so a long caption shrinks the
 * photo instead of overlapping it.
 */
function storyLayout(caption: string, place: string | null, hasDate: boolean, url: string, hasMap: boolean) {
  // The card, less the side padding, the plate's own padding and border, and the map tile.
  const textWidth =
    CARD.width -
    2 * CARD.sidePadding -
    2 * GLASS.paddingX -
    2 * PLATE_BORDER -
    (hasMap ? GLASS.gap + MAP.size : 0);

  const cap = clamp(caption, charsPerLine(textWidth, TYPE.caption.fontSize), MAX_CAPTION_LINES);
  const placePerLine = charsPerLine(textWidth, TYPE.place.fontSize) - PLACE_ICON_CHARS;
  const pl = place ? clamp(place, placePerLine, MAX_PLACE_LINES) : null;
  const urlLines = Math.max(1, Math.ceil(url.length / monoCharsPerLine(textWidth, TYPE.url.fontSize)));

  const rows = 2 + (pl ? 1 : 0) + (hasDate ? 1 : 0);
  const textHeight =
    cap.lines * TYPE.caption.fontSize * TYPE.caption.lineHeight +
    (pl ? pl.lines * TYPE.place.fontSize * 1.4 : 0) +
    (hasDate ? TYPE.date.fontSize * 1.4 : 0) +
    urlLines * TYPE.url.fontSize * 1.4 +
    (rows - 1) * ROW_GAP +
    4;

  const plateHeight =
    2 * GLASS.paddingY + 2 * PLATE_BORDER + Math.max(textHeight, hasMap ? MAP.size : 0);
  const available = CARD.height - 2 * CARD.safeInset - PLATE_GAP - plateHeight;

  return {
    caption: cap.text,
    place: pl?.text ?? null,
    photoMaxHeight: Math.max(420, Math.round(available)),
  };
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

/** The typeable fallback printed on the card — protocol stripped, since nobody types it. */
function displayUrl(base: string, slug: string): string {
  return `${base}/p/${slug}`.replace(/^https?:\/\//, '');
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
};

export type CardFormat = 'story' | 'og';

/** Everything both card formats draw, fetched once. */
type CardInputs = {
  source: Buffer;
  caption: string;
  date: string | null;
  place: string | null;
  url: string;
  /** Map tile and the photo cropped round for its pin; null when there is no location. */
  map: { tile: Buffer; pin: Buffer } | null;
};

async function loadInputs(photo: ShareCardPhoto, base: string): Promise<CardInputs> {
  const located = photo.lat != null && photo.lon != null;

  const [source, place, tile] = await Promise.all([
    fetch(photo.large_url).then(async (res) => {
      if (!res.ok) throw new Error(`share card source fetch failed: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }),
    located ? placeName(photo.lon!, photo.lat!, base) : null,
    located ? mapTile(photo.lon!, photo.lat!, MAP.size, base) : null,
  ]);

  const pin = tile
    ? await sharp(source)
        .resize(PIN.size * 2, PIN.size * 2, { fit: 'cover' })
        .jpeg({ quality: 80 })
        .toBuffer()
    : null;

  return {
    source,
    caption: photo.caption || photo.original_name,
    date: formatDate(photo.date),
    place,
    url: displayUrl(base, photo.friendly_name),
    map: tile && pin ? { tile, pin } : null,
  };
}

/** The ambient layer: the photo blurred to fill a `width`x`height` frame. */
function ambient(source: Buffer, width: number, height: number) {
  return sharp(source)
    .resize(Math.round(width / AMBIENT_DIVISOR), Math.round(height / AMBIENT_DIVISOR), {
      fit: 'cover',
    })
    .blur(AMBIENT.blur / AMBIENT_DIVISOR)
    .modulate({ brightness: AMBIENT.brightness, saturation: AMBIENT.saturation })
    .jpeg({ quality: AMBIENT.quality })
    .toBuffer();
}

const PinIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </svg>
);

/**
 * The map tile with the photo pinned at its centre. Sizes include the frame: satori's boxes
 * are border-box, and absolute children are placed inside the border.
 */
function MiniMap({
  map,
  size,
  radius,
  frame,
  pinSize,
  pinRing,
  shadow,
}: {
  map: NonNullable<CardInputs['map']>;
  size: number;
  radius: number;
  frame: number;
  pinSize: number;
  pinRing: number;
  shadow: string;
}) {
  const inner = size - 2 * frame;
  const pinInner = pinSize - 2 * pinRing;
  return (
    <div
      style={{
        display: 'flex',
        flex: 'none',
        position: 'relative',
        width: size,
        height: size,
        borderRadius: radius,
        border: `${frame}px solid ${MAP.frameColor}`,
        boxShadow: shadow,
        overflow: 'hidden',
        background: BACKGROUND,
      }}
    >
      <img
        src={dataUri(map.tile, 'image/png')}
        width={inner}
        height={inner}
        style={{ position: 'absolute', top: 0, left: 0 }}
      />
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: (inner - pinSize) / 2,
          left: (inner - pinSize) / 2,
          width: pinSize,
          height: pinSize,
          borderRadius: pinSize / 2,
          border: `${pinRing}px solid #ffffff`,
          boxShadow: PIN.shadow,
          overflow: 'hidden',
        }}
      >
        <img
          src={dataUri(map.pin, 'image/jpeg')}
          width={pinInner}
          height={pinInner}
          style={{ borderRadius: pinInner / 2 }}
        />
      </div>
    </div>
  );
}

const PlaceRow = ({ place, style }: { place: string; style: typeof TYPE.place | typeof OG.place }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(style.fontSize * 0.3), ...style }}>
    <PinIcon size={Math.round(style.fontSize * 0.95)} />
    <div style={{ display: 'flex', flex: 1, minWidth: 0 }}>{place}</div>
  </div>
);

/** The 1080x1920 story card: photo above a glass plate holding the text and the mini map. */
async function renderStory(inputs: CardInputs): Promise<Buffer> {
  const { caption, place, photoMaxHeight } = storyLayout(
    inputs.caption,
    inputs.place,
    inputs.date !== null,
    inputs.url,
    inputs.map !== null
  );

  const [fitted, ambientBuf] = await Promise.all([
    sharp(inputs.source)
      .resize(PHOTO.maxWidth, Math.min(PHOTO.maxHeight, photoMaxHeight), { fit: 'inside' })
      .jpeg({ quality: 82 })
      .toBuffer({ resolveWithObject: true }),
    ambient(inputs.source, CARD.width, CARD.height),
  ]);

  const element = (
    <div
      style={{
        width: CARD.width,
        height: CARD.height,
        display: 'flex',
        position: 'relative',
        background: BACKGROUND,
        fontFamily: FONT.sans,
      }}
    >
      <img
        src={dataUri(ambientBuf, 'image/jpeg')}
        width={CARD.width}
        height={CARD.height}
        style={{ position: 'absolute', top: 0, left: 0, objectFit: 'cover' }}
      />

      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: CARD.width,
          height: CARD.height,
          padding: `${CARD.safeInset}px ${CARD.sidePadding}px`,
        }}
      >
        {/* Bottom-anchored so the gap to the plate is always PLATE_GAP: the plate's height
            varies with the text it holds, and centring here would move the photo with it. */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            minHeight: 0,
          }}
        >
          <img
            src={dataUri(fitted.data, 'image/jpeg')}
            width={fitted.info.width}
            height={fitted.info.height}
            style={{ borderRadius: PHOTO.radius, boxShadow: PHOTO.shadow }}
          />
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: GLASS.gap,
            marginTop: PLATE_GAP,
            padding: `${GLASS.paddingY}px ${GLASS.paddingX}px`,
            background: GLASS.background,
            border: GLASS.border,
            borderRadius: GLASS.radius,
            boxShadow: GLASS.shadow,
            color: GLASS.text,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: ROW_GAP, minWidth: 0 }}>
            <div style={{ display: 'flex', ...TYPE.caption }}>{caption}</div>
            {place ? <PlaceRow place={place} style={TYPE.place} /> : null}
            {inputs.date ? <div style={{ display: 'flex', ...TYPE.date }}>{inputs.date}</div> : null}
            <div style={{ display: 'flex', fontFamily: FONT.mono, marginTop: 4, ...TYPE.url }}>
              {inputs.url}
            </div>
          </div>

          {inputs.map ? (
            <MiniMap
              map={inputs.map}
              size={MAP.size}
              radius={MAP.radius}
              frame={MAP.frame}
              pinSize={PIN.size}
              pinRing={PIN.ring}
              shadow={MAP.shadow}
            />
          ) : null}
        </div>
      </div>
    </div>
  );

  return toPng(element, CARD.width, CARD.height);
}

/** The 1200x630 link preview: photo on the left, a glass plate with map and text on the right. */
async function renderOg(inputs: CardInputs): Promise<Buffer> {
  const photoMaxHeight = OG.height - 2 * OG.padding;
  const [fitted, ambientBuf] = await Promise.all([
    sharp(inputs.source)
      .resize(OG.photoMaxWidth, photoMaxHeight, { fit: 'inside' })
      .jpeg({ quality: 82 })
      .toBuffer({ resolveWithObject: true }),
    ambient(inputs.source, OG.width, OG.height),
  ]);

  const textWidth =
    OG.width -
    2 * OG.padding -
    fitted.info.width -
    OG.gap -
    2 * OG.platePadding -
    2 * PLATE_BORDER;
  const caption = clamp(
    inputs.caption,
    charsPerLine(textWidth, OG.caption.fontSize),
    MAX_OG_CAPTION_LINES
  ).text;
  const place = inputs.place
    ? clamp(
        inputs.place,
        charsPerLine(textWidth, OG.place.fontSize) - PLACE_ICON_CHARS,
        MAX_PLACE_LINES
      ).text
    : null;

  const element = (
    <div
      style={{
        width: OG.width,
        height: OG.height,
        display: 'flex',
        position: 'relative',
        background: BACKGROUND,
        fontFamily: FONT.sans,
      }}
    >
      <img
        src={dataUri(ambientBuf, 'image/jpeg')}
        width={OG.width}
        height={OG.height}
        style={{ position: 'absolute', top: 0, left: 0, objectFit: 'cover' }}
      />

      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: OG.gap,
          width: OG.width,
          height: OG.height,
          padding: OG.padding,
        }}
      >
        <img
          src={dataUri(fitted.data, 'image/jpeg')}
          width={fitted.info.width}
          height={fitted.info.height}
          style={{ flex: 'none', borderRadius: OG.photoRadius, boxShadow: OG.photoShadow }}
        />

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minWidth: 0,
            gap: 18,
            padding: OG.platePadding,
            background: GLASS.background,
            border: GLASS.border,
            borderRadius: OG.plateRadius,
            boxShadow: GLASS.shadow,
            color: GLASS.text,
          }}
        >
          {inputs.map ? (
            <MiniMap
              map={inputs.map}
              size={OG.mapSize}
              radius={OG.mapRadius}
              frame={OG.mapFrame}
              pinSize={OG.pinSize}
              pinRing={OG.pinRing}
              shadow={MAP.shadow}
            />
          ) : null}
          <div style={{ display: 'flex', ...OG.caption }}>{caption}</div>
          {place ? <PlaceRow place={place} style={OG.place} /> : null}
          {inputs.date ? <div style={{ display: 'flex', ...OG.date }}>{inputs.date}</div> : null}
        </div>
      </div>
    </div>
  );

  return toPng(element, OG.width, OG.height);
}

async function toPng(element: React.ReactElement, width: number, height: number): Promise<Buffer> {
  const imageResponse = new ImageResponse(element, { width, height, fonts: await fonts() });
  return Buffer.from(await imageResponse.arrayBuffer());
}

const RENDER: Record<CardFormat, (inputs: CardInputs) => Promise<Buffer>> = {
  story: renderStory,
  og: renderOg,
};

/**
 * Renders one of a photo's cards to PNG bytes. Used by the live-render fallback in
 * /api/share/[slug]; same output as the precompute path in shareCardStore.
 */
export async function renderShareCardPng(
  photo: ShareCardPhoto,
  base: string,
  format: CardFormat = 'story'
): Promise<Buffer> {
  return RENDER[format](await loadInputs(photo, base));
}

/** Renders every format from one fetch of the source, map and place name. */
export async function renderAllShareCards(
  photo: ShareCardPhoto,
  base: string
): Promise<Record<CardFormat, Buffer>> {
  const inputs = await loadInputs(photo, base);
  // In sequence: satori is CPU-bound, so running both at once only raises peak memory.
  const story = await renderStory(inputs);
  const og = await renderOg(inputs);
  return { story, og };
}
