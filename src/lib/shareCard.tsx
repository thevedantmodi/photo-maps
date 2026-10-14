/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text --
   This JSX is rendered by satori into a PNG, not into the DOM: next/image does not exist
   there, and alt text has nowhere to go. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ImageResponse } from 'next/og';
import QRCode from 'qrcode';
import sharp from 'sharp';

import { placeNameFor } from '@/lib/placeName';
import { CARD, FONT, PALETTE, PHOTO, QR, RULE, TYPE } from '@/lib/shareTokens';
import type { CardTheme } from '@/lib/shareVersion';

const INNER_WIDTH = CARD.width - 2 * CARD.sidePadding;
const INNER_HEIGHT = CARD.height - 2 * CARD.safeInset;

// Geist averages ~0.52em per character at display sizes with the card's tight tracking,
// and ~0.56em at 600 weight for the link.
const TITLE_EM_PER_CHAR = 0.52;
const URL_EM_PER_CHAR = 0.56;
const MAX_TITLE_LINES = 3;

const HEADER_HEIGHT = Math.ceil(TYPE.name.fontSize * 1.2) + 28 + RULE;
const ROW_HEIGHT = Math.ceil(TYPE.row.fontSize * 1.2) + 32 + RULE;
const URL_WIDTH = INNER_WIDTH - QR.tile - 40;

function titleSize(title: string): number {
  return TYPE.title.find((t) => title.length <= t.maxChars)!.fontSize;
}

/**
 * The card is laid out by satori, so its heights are not known until after render — but
 * the photo has to be resized before that. Estimate everything else from the text it will
 * hold and give the photo whatever height is left, so a long caption shrinks the photo
 * instead of overlapping it.
 */
function layout(rawTitle: string, rows: number, url: string) {
  const fontSize = titleSize(rawTitle);
  const perLine = Math.floor(INNER_WIDTH / (fontSize * TITLE_EM_PER_CHAR));
  const limit = MAX_TITLE_LINES * perLine;
  const title = rawTitle.length > limit ? `${rawTitle.slice(0, limit - 1).trimEnd()}…` : rawTitle;
  const titleLines = Math.min(MAX_TITLE_LINES, Math.max(1, Math.ceil(title.length / perLine)));
  const titleHeight = titleLines * fontSize * TYPE.titleLineHeight + 32;

  const rowsHeight = rows > 0 ? rows * ROW_HEIGHT + RULE : 0;

  const urlPerLine = Math.floor(URL_WIDTH / (TYPE.url.fontSize * URL_EM_PER_CHAR));
  const urlLines = Math.max(1, Math.ceil(url.length / urlPerLine));
  const footerHeight =
    40 +
    Math.max(QR.tile, TYPE.urlLabel.fontSize * 1.2 + 6 + urlLines * TYPE.url.fontSize * 1.2);

  const available =
    INNER_HEIGHT - HEADER_HEIGHT - titleHeight - rowsHeight - footerHeight - 2 * PHOTO.gap;

  return {
    title,
    titleFontSize: fontSize,
    photoMaxHeight: Math.min(PHOTO.maxHeight, Math.max(PHOTO.minHeight, Math.floor(available))),
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
  return Promise.all([fontFile('Geist-Regular.ttf'), fontFile('Geist-SemiBold.ttf')]).then(
    ([regular, semibold]) => [
      { name: FONT.sans, data: regular, weight: 400 as const, style: 'normal' as const },
      { name: FONT.sans, data: semibold, weight: 600 as const, style: 'normal' as const },
    ],
  );
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

function permalink(base: string, slug: string): string {
  return `${base}/p/${slug}`;
}

/** The typeable fallback printed on the card — protocol stripped, since nobody types it. */
function displayUrl(base: string, slug: string): string {
  return permalink(base, slug).replace(/^https?:\/\//, '');
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

  const place = photo.lat != null && photo.lon != null ? await placeNameFor(photo.lat, photo.lon) : null;
  const date = formatDate(photo.date);
  const year = photo.date ? new Date(photo.date).getFullYear() : null;
  const rows = [
    ...(place ? [{ label: 'Place', value: place }] : []),
    ...(date ? [{ label: 'Date', value: date }] : []),
  ];
  const url = displayUrl(base, photo.friendly_name);
  const { title, titleFontSize, photoMaxHeight } = layout(
    photo.caption || photo.original_name,
    rows.length,
    url,
  );

  const [fitted, qr] = await Promise.all([
    sharp(buf)
      .resize(PHOTO.maxWidth, photoMaxHeight, { fit: 'inside' })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true }),
    QRCode.toBuffer(permalink(base, photo.friendly_name), {
      width: QR.renderSize,
      margin: 0,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    }),
  ]);

  const element = (
    <div
      style={{
        width: CARD.width,
        height: CARD.height,
        display: 'flex',
        flexDirection: 'column',
        padding: `${CARD.safeInset}px ${CARD.sidePadding}px`,
        background: colors.bg,
        color: colors.ink,
        fontFamily: FONT.sans,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          paddingBottom: 28,
          borderBottom: `${RULE}px solid ${colors.ink}`,
        }}
      >
        <svg width={48} height={33} viewBox="0 0 26 18" style={{ marginRight: 20 }}>
          <polyline
            points="0.5,0.5 13,17 25.5,0.5"
            fill="none"
            stroke={colors.ink}
            strokeWidth={1.4}
          />
        </svg>
        <div style={{ display: 'flex', fontSize: TYPE.name.fontSize, letterSpacing: TYPE.name.letterSpacing, lineHeight: 1.2 }}>
          Vedant Modi
        </div>
        {year !== null ? (
          <div
            style={{
              display: 'flex',
              marginLeft: 'auto',
              fontSize: TYPE.year.fontSize,
              fontWeight: TYPE.year.fontWeight,
              letterSpacing: TYPE.year.letterSpacing,
            }}
          >
            {String(year)}
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: photoMaxHeight + 2 * PHOTO.gap,
        }}
      >
        <img src={dataUri(fitted.data, 'image/jpeg')} width={fitted.info.width} height={fitted.info.height} />
      </div>

      <div
        style={{
          display: 'flex',
          marginBottom: 32,
          fontSize: titleFontSize,
          fontWeight: 600,
          lineHeight: TYPE.titleLineHeight,
          letterSpacing: titleFontSize * TYPE.titleLetterSpacing,
        }}
      >
        {title}
      </div>

      {rows.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: TYPE.row.fontSize, borderBottom: `${RULE}px solid ${colors.ink}` }}>
          {rows.map((row) => (
            <div
              key={row.label}
              style={{ display: 'flex', padding: '16px 0', borderTop: `${RULE}px solid ${colors.ink}`, lineHeight: 1.2 }}
            >
              <div style={{ display: 'flex', width: TYPE.row.labelWidth, flex: 'none', fontWeight: 600 }}>{row.label}</div>
              <div style={{ display: 'flex', flex: 1 }}>{row.value}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'flex-end', marginTop: 'auto', paddingTop: 40 }}>
        <div style={{ display: 'flex', flexDirection: 'column', width: URL_WIDTH, marginRight: 40 }}>
          <div style={{ display: 'flex', fontSize: TYPE.urlLabel.fontSize, color: colors.muted, marginBottom: 6 }}>
            See it on the map
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: TYPE.url.fontSize,
              fontWeight: TYPE.url.fontWeight,
              lineHeight: 1.2,
              wordBreak: 'break-all',
            }}
          >
            {url}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            width: QR.tile,
            height: QR.tile,
            flex: 'none',
            padding: QR.padding,
            background: '#ffffff',
          }}
        >
          <img src={dataUri(qr, 'image/png')} width={QR.tile - 2 * QR.padding} height={QR.tile - 2 * QR.padding} />
        </div>
      </div>
    </div>
  );

  const imageResponse = new ImageResponse(element, {
    width: CARD.width,
    height: CARD.height,
    fonts: await fonts(),
  });

  return Buffer.from(await imageResponse.arrayBuffer());
}
