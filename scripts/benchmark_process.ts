// Compares the old inline sharp+exifr path against the new Rust worker path,
// both hitting real R2 GET/PUT, using a real sample photo as fixture.
// Run: node --env-file=.env.local -r tsx/cjs scripts/benchmark_process.ts
import { readFileSync } from 'fs';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import exifr from 'exifr';
import { r2 } from '../src/lib/r2';

const BUCKET = process.env.R2_BUCKET!;
const PROCESSOR_URL = process.env.PROCESSOR_URL!;
const PROCESSOR_SECRET = process.env.PROCESSOR_SECRET!;
const ITERATIONS = Number(process.argv[3] ?? 10);
const SAMPLE_PATH = process.argv[2] ?? 'photos/whitney-peak.jpg';
const SOURCE_KEY = 'bench/original.jpg';
const WORKER_FRIENDLY_NAME = 'bench-worker';

async function getBuffer(key: string): Promise<Buffer> {
  const obj = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of obj.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

interface Stats {
  label: string;
  mean: number;
  p50: number;
  p95: number;
  n: number;
}

function summarize(label: string, timings: number[]): Stats {
  const sorted = [...timings].sort((a, b) => a - b);
  const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
  const stats = { label, mean, p50: percentile(sorted, 50), p95: percentile(sorted, 95), n: timings.length };
  console.log(
    `${label}: mean=${stats.mean.toFixed(1)}ms p50=${stats.p50.toFixed(1)}ms p95=${stats.p95.toFixed(1)}ms (n=${stats.n})`,
  );
  return stats;
}

async function runOldPathOnce(): Promise<number> {
  const start = performance.now();
  const buffer = await getBuffer(SOURCE_KEY);
  const [thumbBuf, largeBuf] = await Promise.all([
    sharp(buffer).rotate().resize(300, 300, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer(),
    sharp(buffer).rotate().resize(1600, 1600, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer(),
    exifr
      .parse(buffer, { gps: true, xmp: true, exif: true, tiff: true, translateValues: false })
      .catch(() => null),
  ]);
  await Promise.all([
    r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'bench/old_thumb.jpg', Body: thumbBuf, ContentType: 'image/jpeg' })),
    r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'bench/old_large.jpg', Body: largeBuf, ContentType: 'image/jpeg' })),
  ]);
  return performance.now() - start;
}

async function runWorkerPathOnce(): Promise<number> {
  const start = performance.now();
  const res = await fetch(`${PROCESSOR_URL}/process`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-processor-secret': PROCESSOR_SECRET },
    body: JSON.stringify({ key: SOURCE_KEY, friendly_name: WORKER_FRIENDLY_NAME }),
  });
  if (!res.ok) throw new Error(`worker returned ${res.status}: ${await res.text()}`);
  await res.json();
  return performance.now() - start;
}

async function benchmark(label: string, runOnce: () => Promise<number>): Promise<number[]> {
  // One untimed warm-up iteration so both paths get equal treatment for any
  // first-call cold-start effects (module init, disk cache, etc).
  await runOnce();

  const timings: number[] = [];
  let failures = 0;
  for (let i = 0; i < ITERATIONS; i++) {
    try {
      timings.push(await runOnce());
      process.stdout.write('.');
    } catch (e) {
      failures++;
      process.stdout.write('x');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(` ${label} done (${timings.length} ok, ${failures} failed)`);
  return timings;
}

async function main() {
  console.log(`Uploading sample fixture ${SAMPLE_PATH} to bench source key ${SOURCE_KEY}...`);
  const fixture = readFileSync(SAMPLE_PATH);
  await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: SOURCE_KEY, Body: fixture, ContentType: 'image/jpeg' }));

  console.log(`Running ${ITERATIONS} iterations (+1 warm-up) of the old inline sharp+exifr path...`);
  const oldTimings = await benchmark('old path', runOldPathOnce);

  console.log(`Running ${ITERATIONS} iterations (+1 warm-up) of the Rust worker path...`);
  const workerTimings = await benchmark('worker path', runWorkerPathOnce);

  console.log();
  const oldStats = summarize('old (sharp+exifr, inline)', oldTimings);
  const workerStats = summarize('new (rust worker)', workerTimings);

  console.log('\nCleaning up benchmark scratch keys...');
  await Promise.all([
    r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: SOURCE_KEY })),
    r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: 'bench/old_thumb.jpg' })),
    r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: 'bench/old_large.jpg' })),
    r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `${WORKER_FRIENDLY_NAME}_thumb.jpg` })),
    r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `${WORKER_FRIENDLY_NAME}_large.jpg` })),
  ]);

  console.log('\n' + JSON.stringify({ old: oldStats, worker: workerStats }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
