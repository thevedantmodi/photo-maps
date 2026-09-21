/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text --
   This JSX is rendered by satori into a PNG, not into the DOM: next/image does not exist
   there, and alt text has nowhere to go. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ImageResponse } from 'next/og';
import QRCode from 'qrcode';
import sharp from 'sharp';

import { getBaseUrl } from '@/lib/baseUrl';
import { getPhotoBySlug } from '@/lib/photos';
import {
  AMBIENT,
  BACKGROUND,
  CARD,
  FONT,
  GLASS,
  PHOTO,
  QR,
  TYPE,
} from '@/lib/shareTokens';

// sharp and font reads both need Node.
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * The ambient layer is blurred beyond recognition, so it is rendered small and upscaled by
 * satori. Measured on a 287 KB source: 10 ms this way against 61 ms blurring the full
 * 1080x1920 buffer, for an identical result. Both are noise next to satori's ~2.6 s.
 */
const AMBIENT_DIVISOR = 4;

/** Gap between the photo and the plate below it. */
const PLATE_GAP = 60;

/**
 * Width available to the text column inside the plate: the card, less the side padding, the
 * plate's own padding and border, the gap, and the QR tile.
 */
const TEXT_WIDTH =
  CARD.width -
  2 * CARD.sidePadding -
  2 * GLASS.paddingX -
  6 -
  GLASS.gap -
  (QR.size + 2 * QR.padding);

// Geist averages ~0.52em per character at these sizes; Geist Mono is a true 0.6em.
const CAPTION_CHARS_PER_LINE = Math.floor(TEXT_WIDTH / (TYPE.caption.fontSize * 0.52));
const URL_CHARS_PER_LINE = Math.floor(TEXT_WIDTH / (TYPE.url.fontSize * 0.6));
const MAX_CAPTION_LINES = 4;

/**
 * The plate is laid out by satori, so its height is not known until after render — but the
 * photo has to be resized before that. Estimate the plate's height from the text it will
 * hold and give the photo whatever vertical space is left, so a long caption shrinks the
 * photo instead of overlapping it.
 */
function layout(caption: string, hasDate: boolean, url: string) {
  const limit = MAX_CAPTION_LINES * CAPTION_CHARS_PER_LINE;
  const clamped =
    caption.length > limit ? `${caption.slice(0, limit - 1).trimEnd()}\u2026` : caption;

  const captionLines = Math.min(
    MAX_CAPTION_LINES,
    Math.max(1, Math.ceil(clamped.length / CAPTION_CHARS_PER_LINE))
  );
  const urlLines = Math.max(1, Math.ceil(url.length / URL_CHARS_PER_LINE));

  const rows = 1 + (hasDate ? 1 : 0) + 1;
  const plateHeight =
    2 * GLASS.paddingY +
    6 +
    captionLines * TYPE.caption.fontSize * TYPE.caption.lineHeight +
    (hasDate ? TYPE.date.fontSize * 1.4 : 0) +
    urlLines * TYPE.url.fontSize * 1.4 +
    (rows - 1) * 14 +
    4;

  const available = CARD.height - 2 * CARD.safeInset - PLATE_GAP - plateHeight;

  return {
    caption: clamped,
    photoMaxHeight: Math.max(420, Math.round(available)),
  };
}

const FONT_DIR = join(process.cwd(), 'src', 'app', 'fonts');

const fontFile = (name: string) => readFile(join(FONT_DIR, name));

/**
 * Loaded on first request, not at module scope: during `next build` the module is evaluated
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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const base = await getBaseUrl(req.headers);
  const photo = await getPhotoBySlug(slug);
  if (!photo) return new Response('Not found', { status: 404 });

  const source = await fetch(photo.large_url);
  if (!source.ok) return new Response('Photo unavailable', { status: 502 });
  const buf = Buffer.from(await source.arrayBuffer());

  const rawCaption = photo.caption || photo.original_name;
  const date = formatDate(photo.date);
  const url = displayUrl(base, slug);
  const { caption, photoMaxHeight } = layout(rawCaption, date !== null, url);

  // One source buffer, two derivatives: the photo itself, and the blurred ground behind it.
  const [fitted, ambient, qr] = await Promise.all([
    sharp(buf)
      .resize(PHOTO.maxWidth, Math.min(PHOTO.maxHeight, photoMaxHeight), { fit: 'inside' })
      .jpeg({ quality: 82 })
      .toBuffer({ resolveWithObject: true }),
    sharp(buf)
      .resize(CARD.width / AMBIENT_DIVISOR, CARD.height / AMBIENT_DIVISOR, { fit: 'cover' })
      .blur(AMBIENT.blur / AMBIENT_DIVISOR)
      .modulate({ brightness: AMBIENT.brightness, saturation: AMBIENT.saturation })
      .jpeg({ quality: AMBIENT.quality })
      .toBuffer(),
    QRCode.toBuffer(permalink(base, slug), {
      width: QR.renderSize,
      margin: 0,
      errorCorrectionLevel: 'M',
    }),
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
        src={dataUri(ambient, 'image/jpeg')}
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
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 14, minWidth: 0 }}>
            <div style={{ display: 'flex', ...TYPE.caption }}>{caption}</div>
            {date ? <div style={{ display: 'flex', ...TYPE.date }}>{date}</div> : null}
            <div style={{ display: 'flex', fontFamily: FONT.mono, marginTop: 4, ...TYPE.url }}>
              {url}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flex: 'none',
              padding: QR.padding,
              background: '#ffffff',
              borderRadius: QR.radius,
              boxShadow: QR.shadow,
            }}
          >
            <img src={dataUri(qr, 'image/png')} width={QR.size} height={QR.size} />
          </div>
        </div>
      </div>
    </div>
  );

  return new ImageResponse(element, {
    width: CARD.width,
    height: CARD.height,
    fonts: await fonts(),
    headers: {
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
}

function permalink(base: string, slug: string): string {
  return `${base}/p/${slug}`;
}

/** The typeable fallback printed on the card — protocol stripped, since nobody types it. */
function displayUrl(base: string, slug: string): string {
  return permalink(base, slug).replace(/^https?:\/\//, '');
}
