# EXIF Metadata Flow — Architecture

Trace of image upload → GPS/date extraction → DB write. Two live code paths (worker + legacy fallback), gated by `PROCESSOR_URL`.

## Actors

- **Browser** `/admin` upload UI
- **Next.js route** `src/app/api/admin/process/route.ts` — orchestrator, DB owner
- **Rust Worker** `processor/` (Cloudflare Workers, wasm) — decode/resize/EXIF, stateless
- **R2** object storage (bucket `photos`) — two access paths: S3 API creds (Next.js, `src/lib/r2.ts`) and native binding `PHOTOS` (Worker)
- **Neon/Drizzle** `photos` table

## Flow (worker path, `PROCESSOR_URL` set)

```
Browser
  │ POST { key, friendly_name, original_name, caption }
  ▼
Next.js route.ts
  │ fetch(PROCESSOR_URL/process, headers: x-processor-secret)
  │ body: { key, friendly_name }
  ▼
Worker lib.rs :: handle_process
  1. auth check — x-processor-secret vs env secret → 401 on mismatch
  2. parse body → 400 if malformed
  3. bucket.get(key) via PHOTOS binding → 400 if missing
  4. image::load_from_memory(buf) → 400 if undecodable
  5. exif::parse(buf) — see "EXIF extraction" below
  6. image_processor::apply_orientation(img, orientation)
  7. resize_and_encode ×2 (300x300 q80 thumb, 1600x1600 q85 large)
  8. r2 PUT both variants (sequential, no concurrent uploads)
  9. respond: { thumb_name, large_name, lat, lon, date, width, height }
  ▼
Next.js route.ts (resumed)
  │ db.insert(photos)…onConflictDoUpdate — writes lat/lon/date/width/height
  │ THEN delete original from R2 (best-effort, log-only on failure)
  ▼
Browser ← { ok: true, lat, lon }
```

Key ordering guarantee: **delete-after-insert**. If the DB write fails, the original is left in R2 for retry — this is a deliberate fix over the old sharp/exifr path, which deleted before inserting.

## EXIF extraction detail (`processor/src/exif.rs`)

Single-tier GPS handling — unlike the JS version's two-tier exifr (precomputed `.latitude` vs. manual DMS fallback), kamadak-exif has no precomputed helper, so it's always manual:

```
gps_coord(tag=GPSLatitude, ref=GPSLatitudeRef)
  Rational[3] (deg, min, sec) → deg + min/60 + sec/3600
  ref contains 'S' or 'W' → negate
  any missing/wrong-shape field → None
```

Date resolution, three tiers, first hit wins:

```
1. DateTimeOriginal      \  reformat "Y:M:D H:M:S" → "Y-M-DTH:M:SZ"
2. DateTimeDigitized     /  (pure string ops, no chrono, no calendar math)
3. GPS fallback: GPSDateStamp + GPSTimeStamp
     time array present → use h/m/s (fractional sec truncated, matches JS Math.floor)
     time array absent  → 00:00:00Z
4. none of the above → None
```

Orientation: `Tag::Orientation` read once, mapped to one of 8 EXIF orientation values → `image_processor::apply_orientation` does the matching `fliph`/`flipv`/`rotate90/180/270` combo before resize. Doing this before resize is what makes rotated phone photos come out upright — skip it and thumbnails come out sideways/mirrored.

All dates/GPS assumed UTC (matches prior Vercel Node runtime behavior, whose `TZ` resolved to UTC).

## Resize detail (`processor/src/image_processor.rs`)

Replicates sharp's `fit: 'inside'`:

```
scale = min(max_w/src_w, max_h/src_h, 1.0)   // never upscale
dst_w, dst_h = round(src_w*scale), round(src_h*scale)
```

Resize via `fast_image_resize`, `ResizeAlg::Convolution(FilterType::Lanczos3)` — same kernel family as libvips/sharp default. Encode via `image` crate's JPEG encoder (no mozjpeg — wasm cross-compile risk, revisit only if benchmarking flags encode as bottleneck).

## Legacy fallback path (`PROCESSOR_URL` unset)

Verbatim pre-migration behavior, kept as a temporary safety net:

```
GET original (S3 API) → Promise.all[ sharp thumb, sharp large, exifr.parse ]
  → extractGps (exifr .latitude/.longitude, else manual DMS parse)
  → date: DateTimeOriginal → CreateDate → GPS fallback
→ PUT thumb, PUT large, DELETE original   (all in one Promise.all — delete BEFORE insert)
→ db.insert…onConflictDoUpdate (no width/height — columns stay null)
```

Slated for deletion once the worker path is trusted. Not being backported to delete-after-insert — not worth the complexity for code on its way out.

## Field-by-field mapping (JS → Rust)

| Concern | route.ts (exifr) | processor/ (kamadak-exif) |
|---|---|---|
| GPS primary | `exifData.latitude/.longitude` (precomputed) | *(no equivalent — folded into DMS tier)* |
| GPS fallback | manual DMS parse of `GPSLatitude`/`GPSLongitude` strings | `gps_coord` — the only tier |
| Date tier 1 | `DateTimeOriginal` (Date object) | `Tag::DateTimeOriginal` (string, reformatted) |
| Date tier 2 | `CreateDate` | `Tag::DateTimeDigitized` (kamadak's name for the same tag) |
| Date tier 3 | `extractGpsDate`: `GPSDateStamp`+`GPSTimeStamp`, UTC | `gps_date_fallback` — identical logic |
| Orientation | `sharp(...).rotate()` (auto, implicit) | `Tag::Orientation` read + explicit `apply_orientation` |
| width/height | not captured (old path) | captured from decoded original, written to new nullable DB columns |

## Auth/error tiers (worker)

- `401` — missing/wrong `x-processor-secret`
- `400` — bad request body, object not found, undecodable image
- `500` — R2 read/write failure, empty body
- `502` (Next.js side) — worker unreachable/non-JSON error, wrapped by `WorkerError`

Errors returned to caller are short/sanitized; full detail goes to `console_log!`/`console_error!` server-side only.
