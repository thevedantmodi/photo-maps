# Photo Maps

An interactive map of geotagged travel photos. Photos are plotted on a Mapbox map, clustered by zoom, and open in a full-size lightbox. Each photo has its own shareable page with a generated story-style share card.

## Features

- **Map** — Mapbox GL map with Supercluster clustering; photos taken at the same spot fan out into a stack instead of overlapping.
- **Browse** — date filter, a location sidebar that groups photos into places, and a search box that flies the map to a place.
- **Place names** — sidebar groups are named by Mapbox reverse geocoding, with hand-named custom places (reefs, open ocean, remote parks) taking precedence.
- **Sharing** — every photo lives at `/p/<friendly_name>` with OG tags. `/api/share/<slug>` serves a 1080×1920 story card with the photo's place name and a mini map pinned with the photo; `?format=og` serves the 1200×630 link preview used for `og:image`. Both are rendered with `next/og`, precomputed into R2 at upload/edit time, and fall back to a live render.
- **Light/dark theme** toggle.
- **Follow** — `/feed.xml` RSS feed of recent photos, and an email signup on the map (double opt-in through Resend) with a weekly digest that only goes out when there are new photos.
- **Admin** at `/admin` (HTTP Basic Auth) with three tabs:
  - **Upload** — upload photos (including HEIC) with caption, location, and date.
  - **Manage** — edit, rotate, and delete photos; clear the Cloudflare cache in front of R2.
  - **Places** — add, edit, and remove custom place labels without a redeploy.

## Stack

- **App**: Next.js 16 (App Router), React 19, `react-map-gl` / Mapbox GL, Framer Motion
- **Database**: Neon (PostgreSQL) via Drizzle ORM
- **Storage**: Cloudflare R2 (originals, thumbnails, large images, share cards)
- **Image processing**: `sharp`, `exifr`, and `heic-convert` inside a Next.js API route
- **Deployment**: Vercel (with Vercel Analytics)

## Project layout

```
src/
  app/
    page.tsx                 public map (server component, loads published photos)
    p/[friendly_name]/       per-photo page
    admin/                   admin UI (Upload / Manage / Places)
    api/
      upload/                presigned R2 upload URL
      admin/process/         EXIF + resize + DB insert for an uploaded original
      admin/photos/          list / edit / rotate / delete photos
      admin/places/          CRUD for custom places
      admin/cache/           purge the Cloudflare cache for the R2 domain
      share/[slug]/          story card and link-preview images
    components/              map, sidebar, search, lightbox pieces
  db/                        Drizzle schema + client
  lib/                       R2, GPS/EXIF, geocoding, share card helpers
  proxy.ts                   Basic Auth for /admin and admin APIs
drizzle/                     SQL migrations
```

## Environment variables

Create `.env.local`:

```
# Database (Neon)
DATABASE_URL=...              # pooled, used by the app
DATABASE_URL_UNPOOLED=...     # direct, used by drizzle-kit

# Cloudflare R2
R2_ENDPOINT=...               # https://<account_id>.r2.cloudflarestorage.com
R2_BUCKET=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
NEXT_PUBLIC_R2_PUBLIC_URL=... # public base URL of the bucket

# Cloudflare cache purge (admin "Clear cache")
CLOUDFLARE_ZONE_ID=...        # zone serving the R2 custom domain
CLOUDFLARE_API_TOKEN=...      # needs Zone > Cache Purge

# Mapbox
NEXT_PUBLIC_MAPBOX_TOKEN=...

# Admin Basic Auth
ADMIN_USER=...
ADMIN_PASS=...

# Resend (Vercel Marketplace integration; RESEND_API_KEY and RESEND_EMAIL_DOMAIN are provisioned)
RESEND_API_KEY=...
RESEND_EMAIL_DOMAIN=...       # verified sending domain, e.g. photos.vedantmodi.com
RESEND_SEGMENT_ID=...         # segment confirmed subscribers join; the digest broadcasts to it

# Weekly digest cron (Vercel sends it as a bearer token)
CRON_SECRET=...

# Optional: canonical origin for share links in production
NEXT_PUBLIC_BASE_URL=...
```

## Development

```bash
npm install
npm run dev
```

## Photo workflow

Everything happens in `/admin`. The one local script regenerates share cards in bulk (below).

1. **Upload.** The browser asks `/api/upload` for a presigned URL and PUTs the original straight to R2.
2. **Process.** `/api/admin/process` downloads the original, decodes HEIC if needed, generates a 300px thumbnail and a 1600px large JPEG, reads EXIF (GPS and date), uploads both images to R2, writes the row to Postgres as `published`, and precomputes the share card. The photo is live on the map as soon as this finishes.
3. **Touch up.** In the Manage tab, edit captions/location/date, rotate, or delete.

### Setting a photo's location

Both the Upload tab and the edit dialog show a Mapbox picker under the caption field, backed by latitude/longitude textboxes. Selecting a file reads its EXIF GPS in the browser and prefills both the pin and the boxes, so an already-geotagged photo opens on its own location and can just be nudged. Clicking the map or dragging the pin rewrites the boxes; typing or pasting `lat, lon` moves the pin. Coordinates set here become `lat`/`lon` in the database.

Whatever is in the boxes at upload time wins over the file's EXIF. Clearing a prefilled location publishes the photo without coordinates rather than falling back to EXIF.

### Setting a photo's date

The EXIF capture date is used when present. If the file has none, the date entered on upload is used instead.

### Regenerating share cards

Share cards are re-rendered automatically when a photo is uploaded, edited, or rotated. After a card design change (bump `DESIGN` in `src/lib/shareVersion.ts`), re-render every stale card so photos stop falling back to a slow live render:

```bash
npm run share-cards -- --base https://photos.example.com --dry-run   # list stale photos
npm run share-cards -- --base https://photos.example.com             # re-render them
```

It reads `.env.local`, and `--base` defaults to `NEXT_PUBLIC_BASE_URL`. `--all` re-renders every published photo, e.g. after renaming a custom place. Failures are listed at the end; running it again retries only those.

## Database migrations

Schema lives in `src/db/schema.ts` (`photos` and `places`). `drizzle-kit` reads `DATABASE_URL_UNPOOLED` from the environment:

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```
