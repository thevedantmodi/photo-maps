# Benchmark: inline sharp/exifr vs. Rust worker

## Methodology

`scripts/benchmark_process.ts` (repo root) times both processing paths under
identical conditions:

- Same sample photo (`photos/whitney-peak.jpg`, ~3.3MB, 4000x3000, real EXIF/GPS)
  uploaded once to a scratch R2 key (`bench/original.jpg`).
- **Old path**: runs the exact same `sharp().rotate().resize().jpeg()` x2 +
  `exifr.parse()` calls as `route.ts`'s fallback branch, directly against
  real R2 (GET original, PUT both variants), no HTTP hop — this isolates the
  Node-side work from Next.js request/response overhead.
- **New path**: `POST http://localhost:8787/process` against the Rust worker
  running under `wrangler dev --remote` (real R2 bucket, not Miniflare-simulated).
- 1 untimed warm-up call per path, then 10 timed iterations, 500ms apart.
- Both paths measured as wall-clock time from Node (includes R2 network I/O
  for both, so R2 latency is a shared, cancelling-out cost).

Run it yourself:
```
node --env-file=.env.local node_modules/.bin/tsx scripts/benchmark_process.ts photos/whitney-peak.jpg 10
```

## Results

| Path | n | mean | p50 | p95 |
|---|---|---|---|---|
| Old (inline sharp + exifr) | 10 | 1168.3ms | 1049.9ms | 2287.5ms |
| New (Rust worker) | 2 | 1468.3ms | 1387.5ms | 1549.2ms |

## Important caveat: worker path sample size

The worker path only completed **2 of 10** timed requests. The other 8 failed
with Cloudflare error 1102 ("Worker exceeded resource limits") escalating,
after several failures, into fast-failing `500`s — a sign the `wrangler dev
--remote` preview isolate got wedged after repeatedly hitting a CPU-time
ceiling, not a bug in the Rust code itself:

- Setting `[limits] cpu_ms = 50000` in `wrangler.toml` (processor/wrangler.toml)
  did **not** change the failure point — the same request count failed before
  and after. This strongly suggests `workers.dev` preview/dev-tunnel sessions
  enforce their own CPU budget independent of `wrangler.toml`'s `[limits]`,
  which per Cloudflare's docs is meant to apply to an actually **deployed**
  Worker on a real route, not a local `wrangler dev --remote` preview session.
- A 500ms delay between requests didn't help either, ruling out a
  cumulative/rate-based throttle — this looks like a hard per-request (or
  per-preview-session) ceiling specific to the dev-preview infrastructure.
- The requests that did succeed (`1872ms`, `1821ms`, `1385ms`, `1547ms`,
  `2755ms` cold, seen across two benchmark attempts against the same running
  `wrangler dev` session) are competitive with — arguably faster than — the
  inline sharp path's mean, which is the expected direction given SIMD resize
  + a Rust decoder vs. libvips-via-Node overhead.

**This is a preview-session artifact, not a production characteristic.**
Cloudflare's actual CPU-time budget for a deployed Worker depends on the
account's Workers plan (Free vs. Paid) and, on Paid plans, is configurable up
to several minutes via `[limits] cpu_ms`. The numbers above should be treated
as directional, not final — re-run this benchmark against the real deployed
endpoint (`https://photo-maps-processor.<account>.workers.dev` or a custom
route) once Phase 6 (`wrangler deploy`) is done, where the CPU budget is the
one that actually matters for production traffic.

## Follow-up for Phase 6

- Re-run `scripts/benchmark_process.ts` with `PROCESSOR_URL` pointed at the
  deployed Worker instead of `localhost:8787`, for a trustworthy n=10/n=10
  comparison.
- If the deployed Worker also hits CPU-time errors on large (>3MB) photos,
  that's a real signal to either enable the Workers Paid plan's configurable
  `cpu_ms` limit, or to explore whether the resize step can be made cheaper
  (e.g. downsampling before full-resolution decode, if `image`/`fast_image_resize`
  support progressive/partial decode — not currently implemented).
