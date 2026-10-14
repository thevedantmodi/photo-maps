# Photo Maps

An interactive map of geotagged travel photos. Photos are plotted on a Mapbox map, clustered by zoom, and open in a full-size lightbox. Each photo has its own shareable page with a generated story-style share card.

## Features

- **Map** — Mapbox GL map with Supercluster clustering; photos taken at the same spot fan out into a stack instead of overlapping.
- **Browse** — date filter, a location sidebar that groups photos into places, and a search box that flies the map to a place.
- **Place names** — sidebar groups are named by Mapbox reverse geocoding, with hand-named custom places (reefs, open ocean, remote parks) taking precedence.
- **Sharing** — every photo lives at `/p/<friendly_name>` with OG tags. `/api/share/<slug>` serves a 1080×1920 share card (precomputed into R2 at upload/edit time, falling back to a live render).
- **Light/dark theme** toggle.
- **Follow** — `/feed.xml` RSS feed of recent photos, and an email signup on the map (double opt-in through Resend) with a weekly digest that only goes out when there are new photos.
- **Admin** at `/admin` (HTTP Basic Auth) with three tabs:
  - **Upload** — upload photos (including HEIC) with caption, location, and date.
  - **Manage** — edit, rotate, and delete photos; clear the Cloudflare cache in front of R2.
  - **Places** — add, edit, and remove custom place labels without a redeploy.

## Stack

- **Frontend**: Next.js 16 (App Router), React 19, `react-map-gl` / Mapbox GL, Framer Motion, deployed on Vercel (with Vercel Analytics)
- **Backend**: Rust ([axum](https://github.com/tokio-rs/axum)) in `backend/`, deployed as a container
- **Database**: Neon (PostgreSQL) via `sqlx`
- **Storage**: Cloudflare R2 (originals, thumbnails, large images, share cards)
- **Image processing**: libheif (HEIC/AVIF), `image`, `fast_image_resize`, lcms2 (ICC → sRGB), mozjpeg
- **Share cards**: SVG rendered with `resvg`, Geist fonts embedded, Twemoji for emoji
- **Email**: Resend

The browser only ever talks to the Next.js origin. `next.config.ts` rewrites `/api/*` and `/feed.xml` to the backend, and server components (the map, photo pages, subscription confirmation) call the backend directly.

## Project layout

```
src/                         Next.js frontend
  app/
    page.tsx                 public map (server component, loads photos from the backend)
    p/[friendly_name]/       per-photo page
    subscribe/confirm/       double opt-in confirmation page
    admin/                   admin UI (Upload / Manage / Places)
    components/              map, sidebar, search, lightbox pieces
  lib/                       client helpers (GPS/EXIF, geocoding, share-card URLs) and
                             backend.ts, the server-side client for the API
  proxy.ts                   Basic Auth for /admin and admin APIs
backend/                     Rust API
  src/routes/                public.rs (photos, places, share cards, feed, signup, digest)
                             admin.rs (upload, process, edit/rotate/delete, places, cache)
  src/imaging.rs             decode (incl. HEIC), orient, sRGB, resize, JPEG
  src/exif.rs                GPS and capture date from EXIF/XMP
  src/share_card.rs          the 1080×1920 share card
  src/emails.rs              confirmation and digest emails
  migrations/                SQL migrations
  tests/                     end-to-end API tests and image fixtures
```

### API

| Route | Auth | |
| --- | --- | --- |
| `GET /api/photos`, `GET /api/photos/{slug}` | — | published photos |
| `GET /api/places` | — | custom place labels |
| `GET /api/share/{slug}` | — | share card PNG |
| `GET /feed.xml` | — | RSS |
| `POST /api/subscribe` | — | send a confirmation email |
| `GET`/`POST /api/subscribe/confirm` | — | check / confirm a signup token |
| `GET /api/cron/digest` | `Bearer $CRON_SECRET` | weekly digest |
| `POST /api/upload` | Basic | presigned R2 upload URL |
| `POST /api/admin/process` | Basic | EXIF + resize + DB insert for an uploaded original |
| `GET /api/admin/photos`, `PATCH`/`DELETE /api/admin/photos/{id}`, `POST /api/admin/photos/{id}/rotate` | Basic | manage photos |
| `GET`/`POST /api/admin/places`, `PATCH`/`DELETE /api/admin/places/{id}` | Basic | custom places |
| `DELETE /api/admin/cache` | Basic | purge the Cloudflare cache for the R2 domain |
| `GET /healthz` | — | liveness |

## Environment variables

Both apps read the same variables, so one `.env.local` works for local development.

```
# Frontend: where the backend runs (needed at build time too, for the rewrites)
BACKEND_URL=...               # e.g. https://api.photos.vedantmodi.com, default http://localhost:8080

# Database (Neon)
DATABASE_URL=...              # pooled
DATABASE_URL_UNPOOLED=...     # direct; the backend prefers it when set

# Cloudflare R2
R2_ENDPOINT=...               # https://<account_id>.r2.cloudflarestorage.com
R2_BUCKET=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
NEXT_PUBLIC_R2_PUBLIC_URL=... # public base URL of the bucket
R2_FORCE_PATH_STYLE=          # optional: 1 for path-style S3 URLs (MinIO and other local stand-ins)

# Cloudflare cache purge (admin "Clear cache")
CLOUDFLARE_ZONE_ID=...        # zone serving the R2 custom domain
CLOUDFLARE_API_TOKEN=...      # needs Zone > Cache Purge

# Mapbox (frontend)
NEXT_PUBLIC_MAPBOX_TOKEN=...

# Admin Basic Auth (both apps check it)
ADMIN_USER=...
ADMIN_PASS=...

# Resend
RESEND_API_KEY=...
RESEND_EMAIL_DOMAIN=...       # verified sending domain, e.g. photos.vedantmodi.com
RESEND_SEGMENT_ID=...         # segment confirmed subscribers join; the digest broadcasts to it

# Weekly digest cron (Vercel sends it as a bearer token; the backend checks it)
CRON_SECRET=...

# Canonical origin for share links, QR codes, emails and the feed
NEXT_PUBLIC_BASE_URL=...
APP_ENV=production            # backend, in production: makes NEXT_PUBLIC_BASE_URL win over the request's host

# Backend server
PORT=8080                     # optional
BIND=0.0.0.0                  # optional
RUST_LOG=info                 # optional
```

## Development

The backend needs Rust 1.88+, plus libheif (≥ 1.17, with the libde265 plugin for HEIC), lcms2 and nasm. On Ubuntu 24.04:

```bash
sudo apt install build-essential pkg-config cmake nasm libheif-dev libheif-plugin-libde265 libheif-plugin-dav1d liblcms2-dev
```

Then, in two terminals:

```bash
# backend (reads the environment; e.g. `set -a; . ../.env.local; set +a`)
cd backend
cargo run -- migrate    # once, and after adding migrations
cargo run               # serves on :8080

# frontend
npm install
npm run dev             # proxies /api and /feed.xml to $BACKEND_URL
```

### Tests

```bash
cd backend
cargo test                                            # unit tests and image pipeline tests
TEST_DATABASE_URL=postgres://user:pass@localhost/postgres cargo test   # plus end-to-end API tests
```

The end-to-end tests create a throwaway database per test (the user needs `CREATEDB`) and stand in for R2, Resend and Cloudflare. Fixtures under `backend/tests/fixtures` were produced by the original TypeScript backend (emails rendered by React Email, image samples by sharp), so the tests pin the Rust output to what it replaced.

`cargo run --example share_card -- photo_large.jpg out.png "Caption" 2024-03-19T00:00:00Z slug` renders a share card locally; `cargo run --example process_image -- photo.heic out/` runs the upload pipeline on a file.

## Deployment

- **Backend**: `backend/Dockerfile` builds a small Ubuntu-based image (`docker build -t photo-maps-backend backend/`). Run it anywhere that can reach Neon and R2 (Fly.io, Railway, Cloud Run, …) with the environment above, and run `photo-maps-backend migrate` once per release (the image's entrypoint is the binary, so `docker run … photo-maps-backend migrate`). Set `APP_ENV=production` and `NEXT_PUBLIC_BASE_URL` there.
- **Frontend**: Vercel, as before, with `BACKEND_URL` set. The weekly digest cron in `vercel.json` still calls `/api/cron/digest`, which the rewrite forwards to the backend.

## Photo workflow

Everything happens in `/admin`; there are no local scripts.

1. **Upload.** The browser asks `/api/upload` for a presigned URL and PUTs the original straight to R2.
2. **Process.** `/api/admin/process` downloads the original, decodes it (HEIC included), applies its EXIF orientation and colour profile, generates a 300px thumbnail and a 1600px large JPEG, reads EXIF/XMP (GPS and date), uploads both images to R2, writes the row to Postgres as `published`, and precomputes the share card. The photo is live on the map as soon as this finishes.
3. **Touch up.** In the Manage tab, edit captions/location/date, rotate, or delete.

### Setting a photo's location

Both the Upload tab and the edit dialog show a Mapbox picker under the caption field, backed by latitude/longitude textboxes. Selecting a file reads its EXIF GPS in the browser and prefills both the pin and the boxes, so an already-geotagged photo opens on its own location and can just be nudged. Clicking the map or dragging the pin rewrites the boxes; typing or pasting `lat, lon` moves the pin. Coordinates set here become `lat`/`lon` in the database.

Whatever is in the boxes at upload time wins over the file's EXIF. Clearing a prefilled location publishes the photo without coordinates rather than falling back to EXIF.

### Setting a photo's date

The EXIF capture date is used when present. If the file has none, the date entered on upload is used instead.

## Database migrations

Schema lives in `backend/migrations` (`photos` and `places`) and is applied with `photo-maps-backend migrate` (`cargo run -- migrate` in development), which uses `DATABASE_URL_UNPOOLED` when set.

`0001_baseline.sql` replaces the old drizzle-kit migrations. Every statement in it is a no-op when its object already exists, so on the existing database it only adds sqlx's `_sqlx_migrations` bookkeeping table; on an empty database it creates the full schema.
