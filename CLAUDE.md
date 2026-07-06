# Migrate image processing to a Rust Cloudflare Worker

## Context

`photo-maps` currently runs sharp (resize) + exifr (EXIF/GPS parsing) inline inside a Next.js API route (`src/app/api/admin/process/route.ts`) on Vercel. This is CPU-heavy synchronous work sitting in a serverless function. The goal is to move that work into a standalone Rust Cloudflare Worker (SIMD resize via `fast_image_resize`, EXIF via `kamadak-exif`), keeping the DB write (Drizzle/Neon) in Next.js. Primary motivation is resume/portfolio signal (real Rust systems work, worker-to-worker HTTP, benchmarking) with a secondary benefit of faster ingest. This plan covers design only — **user is writing the implementation code themselves**; this document is the spec they'll build from, not something Claude will implement.

Note: CLAUDE.md's described key layout (`originals/{slug}.{ext}`, `thumb/{slug}.{ext}`, `large/{slug}.{ext}`) is stale/aspirational — the actual route writes flat keys `{friendly_name}_thumb.jpg` / `{friendly_name}_large.jpg` at the bucket root. This plan follows the verified code, not the CLAUDE.md prose.

## Decisions locked in this session

1. **Key naming**: keep exactly as today — `{friendly_name}_thumb.jpg` / `{friendly_name}_large.jpg`, flat at bucket root.
2. **Original deletion ownership**: the Rust worker does NOT delete the original. It only GETs the original and PUTs the two variants, returning JSON. Next.js deletes the original from R2 only **after** the Drizzle insert succeeds — this fixes a real gap in current behavior (today's route deletes before the DB write, so a failed insert strands nothing to retry against). Delete failure is logged, not fatal to the response.
3. **Schema**: add nullable `width`/`height` integer columns to `photos`, populated with the **original** uploaded image's dimensions (not a resized variant's).
4. **Worker R2 binding name**: `PHOTOS`.
5. **Auth failure status**: `401` for missing/invalid `x-processor-secret` (distinct from `400` bad-input / `500` internal-error tiers).
6. **No chrono dependency.** Date fields only need reformatting, not calendar arithmetic — `"YYYY:MM:DD HH:MM:SS"` (EXIF) and `"YYYY:MM:DD"` + `[h,m,s]` (GPS fallback) already arrive as fixed-width components; splice directly into `"YYYY-MM-DDTHH:MM:SSZ"` via string ops. No epoch conversion or date validation is needed (Postgres/Drizzle rejects malformed timestamps on insert). Dependency list stays exactly as originally specified: `worker`, `serde`, `serde_json`, `kamadak-exif`, `image` (jpeg+png features only), `fast_image_resize`.

## Current behavior (verified from source, not docs)

`src/app/api/admin/process/route.ts`:
- POST body: `{ key, friendly_name, original_name, caption }`
- GETs original from R2 (`src/lib/r2.ts`, S3 API creds, not a Workers binding)
- Parallel: `sharp(buffer).rotate().resize(300,300,{fit:'inside'}).jpeg({quality:80})` (thumb), same with `(1600,1600)`/`quality:85` (large), `exifr.parse(buffer, {gps:true, xmp:true, exif:true, tiff:true, translateValues:false})`
- GPS (`extractGps`, lines 24-44): exifr's computed `.latitude`/`.longitude` when present, else manual DMS-rational parse of raw `GPSLatitude`/`GPSLongitude` strings with `N/S`/`E/W` sign flip (`dmsRationalToDecimal`, lines 13-22)
- Date (lines 86-89): `DateTimeOriginal` → `CreateDate` → GPS timestamp fallback (`extractGpsDate`, lines 47-58, treats `GPSDateStamp`+`GPSTimeStamp` as UTC, defaults to `00:00:00Z` if no time array)
- PUT both variants + DELETE original, all in one `Promise.all`, **before** the DB write
- `db.insert(photos).values({...}).onConflictDoUpdate({ target: photos.friendly_name, ... })`, sets `status: 'published'`
- Response to browser: `{ ok: true, lat, lon }`

`src/db/schema.ts`: `photos` has `id, friendly_name (unique), thumb_name, large_name, original_name, lat, lon, caption, date, status, created_at`. No `width`/`height` yet.

`src/lib/r2.ts`: S3Client with `R2_ENDPOINT`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`, bucket from `R2_BUCKET` (`"photos"` in `.env.local`). No `wrangler.toml` anywhere in repo — greenfield.

Versions: `sharp ^0.34.5`, `exifr ^7.1.3`, `next ^16.1.6`.

## Design finding worth noting

kamadak-exif has no auto-computed decimal-degree GPS helper like exifr does — so the JS code's two GPS "tiers" (exifr's precomputed `.latitude` vs. manual DMS fallback) collapse into **one** Rust code path: always do the DMS→decimal conversion by hand from the raw `Rational` tag values. This is a simplification relative to the JS logic, not a gap.

## 1. `processor/` skeleton (Phase 1)

```
processor/
├── Cargo.toml
├── wrangler.toml
├── .gitignore          # must include .dev.vars explicitly (root .gitignore's .env* pattern doesn't reach this dir)
├── .dev.vars.example    # documents PROCESSOR_SECRET var name, no value
├── src/
│   ├── lib.rs           # router + auth check
│   ├── exif.rs          # EXIF/GPS/date extraction
│   ├── image_proc.rs    # decode + orient + resize + encode
│   └── r2.rs            # R2 binding GET/PUT wrappers
└── README.md
```

`Cargo.toml` deps: `worker = "0.4"`, `serde`/`serde_json`, `kamadak-exif = "0.5"`, `image = { version = "0.25", default-features = false, features = ["jpeg","png"] }`, `fast_image_resize = "5"`. No `mozjpeg` (wasm cross-compile risk — use `image` crate's built-in JPEG encoder; revisit only if Phase 5 benchmarking shows encode is the bottleneck). No `chrono` (see decision 6).

`wrangler.toml`: `name = "photo-maps-processor"`, R2 binding `PHOTOS` → `bucket_name = "photos"`, `compatibility_date` set to a recent date, `[vars]` for non-secrets only (`PROCESSOR_SECRET` goes via `wrangler secret put` / `.dev.vars` locally).

Phase 1 exit criterion: `cargo check --target wasm32-unknown-unknown` passes with a stub `/process` handler (no real logic yet).

## 2. Worker logic (Phase 2)

**Auth**: check `x-processor-secret` header against `env.secret("PROCESSOR_SECRET")` before touching R2 → `401` on missing/mismatch, JSON body `{ "error": "unauthorized" }`.

**Request**: `{ key, friendly_name }`. Missing/malformed → `400`.

**R2 GET**: `env.bucket("PHOTOS")?.get(&key).execute().await?`; miss → `400` `{ "error": "object not found: <key>" }`.

**EXIF** (mirrors `route.ts` logic exactly, see field-by-field mapping in decisions/findings above):
- GPS: read `Tag::GPSLatitude`/`GPSLongitude` as `Rational` triplets, `decimal = deg + min/60 + sec/3600`, negate on `GPSLatitudeRef`/`GPSLongitudeRef` = `S`/`W`. Missing tags → `None`.
- Date: `DateTimeOriginal` → `DateTimeDigitized` (kamadak-exif's tag name; exifr calls this `CreateDate`) → GPS fallback (`GPSDateStamp` + `GPSTimeStamp`, default `00:00:00` if no time array) → `None`. All treated as UTC (matches production behavior — Vercel's Node runtime effectively treats naive local-time EXIF strings as UTC wall-clock since its `TZ` resolves to UTC).
- **Orientation**: read `Tag::Orientation`, apply the corresponding rotate/flip transform to the decoded image before resizing — this replicates sharp's `.rotate()` auto-orient and is easy to miss; skipping it produces sideways/mirrored thumbnails that don't match today's output.

**Decode/resize/encode** (`image_proc.rs`):
- Decode once via `image::load_from_memory`.
- Apply EXIF-orientation correction (see above).
- Replicate sharp's `fit: 'inside'`: `scale = min(W/src_w, H/src_h)`, clamp to `min(scale, 1.0)` (never upscale), round dimensions. Run twice: `(300,300)` thumb, `(1600,1600)` large.
- Resize via `fast_image_resize` with `ResizeAlg::Convolution(FilterType::Lanczos3)` (matches sharp/libvips' default kernel).
- Encode both as JPEG via `image` crate's encoder, quality 80 (thumb) / 85 (large) — matches `route.ts` exactly.
- Capture original decoded `width`/`height` for the response (per decision 3).

**R2 PUT**: both variants sequentially (no `futures::join_all` yet — out of scope per CLAUDE.md's "no concurrent uploads yet"), `content_type: "image/jpeg"`. No delete here (decision 2).

**Response**: `{ thumb_name, large_name, lat, lon, date, width, height }`, nullable fields as `null` when absent.

**Tracing**: `console_log!` at each stage — bytes received, decoded dimensions, variant sizes, upload done, total ms.

**Error handling**: sanitized short messages only, no Rust debug-format stack traces in responses — log full detail via `console_log!`/`console_error!` server-side.

## 3. `src/app/api/admin/process/route.ts` changes (Phase 3)

**Unchanged**: request parsing/validation, `BUCKET` env lookup, the Drizzle upsert block (now also setting `width`/`height`), the `{ ok: true, lat, lon }` response to the browser, `maxDuration = 60`.

**New branching on `process.env.PROCESSOR_URL`**:
- **Set** (new path): skip local R2 GET entirely (worker does its own). `fetch(`${PROCESSOR_URL}/process`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-processor-secret': process.env.PROCESSOR_SECRET! }, body: JSON.stringify({ key, friendly_name }) })`. Non-2xx → relay worker's `{ error }` JSON with an appropriate status, don't throw raw. On success, parse `{ thumb_name, large_name, lat, lon, date, width, height }`, run the DB upsert, **then** delete the original key from R2 (try/catch, log-only on failure — decision 2).
- **Unset** (fallback, temporary safety net): keep today's exact inline sharp+exifr+PUT+PUT+DELETE-before-insert behavior verbatim. Don't backport the delete-after-insert improvement here — this branch is slated for deletion once the worker path is trusted, not worth the extra complexity.

**New env vars**: `PROCESSOR_URL`, `PROCESSOR_SECRET`.

## 4. Schema migration (Phase 3, DB side)

`src/db/schema.ts`: add `width: integer('width')`, `height: integer('height')` (nullable — existing rows and the fallback branch won't populate them; no backfill in this pass). Add `integer` to the `drizzle-orm/pg-core` import.

Generate migration via `npx drizzle-kit generate` (no hand-written SQL) — this repo has no existing migrations in `./drizzle`, so this will be the first. Check `package.json`/`scripts/` for the project's existing migrate-apply convention before assuming `drizzle-kit migrate` is it.

## 5. Env vars (names only)

- Next.js `.env.local` (and later Vercel Production/Preview): `PROCESSOR_URL`, `PROCESSOR_SECRET`.
- Worker: `PROCESSOR_SECRET` via `wrangler secret put` (deploy) / `processor/.dev.vars` (local, gitignored).
- No credential sharing needed — worker uses R2 **binding** (`PHOTOS`), Next.js keeps its separate S3-API creds (`R2_ENDPOINT`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`) untouched.

## 6. Verification (Phase 4)

1. `cd processor && wrangler dev` (real R2 bucket, not Miniflare-simulated, for fidelity).
2. Set `PROCESSOR_URL=http://localhost:8787/process` + matching `PROCESSOR_SECRET` in `.env.local`.
3. `npm run dev`.
4. Upload a real geotagged JPEG (primary EXIF path) and, if available, a Lightroom-exported PNG/XMP file (DMS-fallback path) through `/admin`.
5. Confirm Neon row has correct `lat`/`lon`/`date`/`width`/`height`/`status`.
6. Confirm both variant keys exist in R2, visually correct (orientation, size), and that the original survives a deliberately-broken DB write (tests delete-after-insert ordering) then gets deleted on a successful run.
7. Load the map page, confirm the new pin renders correctly.

**Deferred (own future passes, not this one)**: Phase 5 benchmark script + `processor/BENCHMARK.md` (p50/p95/mean, old vs new path); Phase 6 `wrangler deploy` + Vercel env vars + smoke test + eventual deletion of the fallback branch.

## Critical files
- `src/app/api/admin/process/route.ts`
- `src/db/schema.ts`
- `src/lib/r2.ts`
- `drizzle.config.ts`
- `CLAUDE.md` (stale key-naming section — follow verified route.ts behavior instead)
- New: `processor/` (Cargo.toml, wrangler.toml, src/lib.rs, src/exif.rs, src/image_proc.rs, src/r2.rs)
