/**
 * Re-renders the precomputed share cards (story + link preview) in R2 for published photos
 * whose stored card is missing or out of date — e.g. after a card design change bumps
 * DESIGN in shareVersion.ts. Until then those photos fall back to a live render.
 *
 *   npm run share-cards -- --base https://photos.example.com [--all] [--dry-run] [--concurrency 2]
 *
 * --base         origin printed on the cards; defaults to NEXT_PUBLIC_BASE_URL
 * --all          re-render every published photo, not only stale ones
 * --dry-run      list what would be re-rendered, render nothing
 * --concurrency  photos rendered at once (default 2; satori is CPU- and memory-heavy)
 *
 * Reads .env.local for the database, R2 and Mapbox settings. Run from the repo root: the
 * renderer reads fonts from src/app/fonts relative to the working directory.
 */
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

// Before any app import: src/db and src/lib/r2 read the environment at module load.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    all: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '2' },
  },
});

const base = (values.base ?? process.env.NEXT_PUBLIC_BASE_URL)?.replace(/\/$/, '');
if (!base || !/^https?:\/\//.test(base)) {
  console.error('Set --base or NEXT_PUBLIC_BASE_URL to the site origin, e.g. https://photos.example.com');
  process.exit(1);
}

const concurrency = Number(values.concurrency);
if (!Number.isInteger(concurrency) || concurrency < 1) {
  console.error('--concurrency must be a positive integer');
  process.exit(1);
}

const missing = [
  'DATABASE_URL',
  'R2_ENDPOINT',
  'R2_BUCKET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'NEXT_PUBLIC_R2_PUBLIC_URL',
].filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
  console.warn('NEXT_PUBLIC_MAPBOX_TOKEN is not set: cards will have no map or place name.');
}

async function main() {
  const { eq } = await import('drizzle-orm');
  const { db } = await import('@/db');
  const { photos } = await import('@/db/schema');
  const { getPublicUrl } = await import('@/lib/r2');
  const { generateAndStoreShareCard } = await import('@/lib/shareCardStore');
  const { shareVersion } = await import('@/lib/shareVersion');

  // Queried directly rather than through lib/photos, which turns a DB error into "no photos".
  const rows = await db.select().from(photos).where(eq(photos.status, 'published'));

  const targets = rows
    .map((row) => ({
      friendly_name: row.friendly_name,
      caption: row.caption,
      original_name: row.original_name,
      date: row.date?.toISOString() ?? null,
      lat: row.lat,
      lon: row.lon,
      large_name: row.large_name,
      large_url: getPublicUrl(row.large_name),
      stored: row.share_card_version,
    }))
    .filter((p) => values.all || p.stored !== shareVersion(p));

  console.log(`${targets.length} of ${rows.length} published photos to re-render (base ${base}).`);
  if (values['dry-run']) {
    for (const p of targets) console.log(`  ${p.friendly_name}`);
    return;
  }

  let next = 0;
  let done = 0;
  const failed: string[] = [];

  async function worker() {
    while (next < targets.length) {
      const photo = targets[next++];
      const started = Date.now();
      const ok = await generateAndStoreShareCard(photo, base!);
      done++;
      if (!ok) failed.push(photo.friendly_name);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`[${done}/${targets.length}] ${ok ? 'ok    ' : 'FAILED'} ${photo.friendly_name} (${seconds}s)`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));

  console.log(`Done: ${done - failed.length} re-rendered, ${failed.length} failed.`);
  if (failed.length) {
    console.log(`Failed: ${failed.join(', ')}. Run again to retry just these.`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
