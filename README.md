# Photo Maps

An interactive map of geotagged travel photos. Photos are hung on a Mapbox map like a museum of photographs, clustered by zoom; each opens as its own page with a generated story-style share card.

## Features

- **Landing** — `/`: the title set four times over, stepping right and fading like an echo, then Enter. Below the first screen, the newest photographs develop as they scroll into view, the years rule themselves out, and Enter comes round again. Old `/#<slug>` photo links are forwarded to `/p/<slug>`.
- **Map** — `/map`: Mapbox GL with monochrome light/dark styles and Supercluster clustering. On first load the photos are hung one by one in date order. Clicking a small group (up to 12 photos), or photos taken at the same spot, fans them out in a wheel around it; bigger groups zoom in.
- **Browse** — a year filter whose brackets slide to the chosen year, a search box that flies the map to a place (its name rises in large type), and 3D terrain.
- **Directory** — `/directory`: every place, numbered, with years, number of photos and the most recent; a row opens the map there (`/map?lon=&lat=&z=`).
- **Place names** — named by Mapbox reverse geocoding, with hand-named custom places (reefs, open ocean, remote parks) taking precedence.
- **Photo page** — `/p/<friendly_name>`, one design everywhere. Opened from the map it's drawn over it (an intercepted route, so the map isn't reloaded): the photo grows out of the clicked thumbnail and shrinks back on close; on a phone, drag it down to close.
- **Sharing** — `/api/share/<slug>?theme=dark|light` serves a 1080×1920 story card in the theme on screen (rendered with `next/og`, both themes precomputed into R2 at upload/edit time, falling back to a live render). Link previews use the dark card.
- **Light | Dark** — follows the system until chosen; switching dims the page like gallery lights while the map restyles.
- **Follow** — `/feed.xml` RSS feed of recent photos, and an email signup under Subscribe in the menu (double opt-in through Resend) with a weekly digest that only goes out when there are new photos.
- **Admin** at `/admin` (HTTP Basic Auth) with three tabs:
  - **Upload** — upload photos (including HEIC) with caption, location, and date.
  - **Manage** — edit, rotate, and delete photos; clear the Cloudflare cache in front of R2.
  - **Places** — add, edit, and remove custom place labels without a redeploy.

## Design

- **Type** — Neue Haas Grotesk where licensed, Helvetica Neue on Apple devices, Geist elsewhere (see `--font-sans` in `globals.css`). The share card renders with the bundled Geist files.
- **Tokens** — colours, rules and motion live as CSS custom properties at the top of `src/app/globals.css`; the share card mirrors them in `src/lib/shareTokens.ts`, and the emails in `src/emails/theme.ts`.
- **Mark** — a compact camera whose lens is a globe (`Mark.tsx`, geometry in `lib/cameraMark.ts`). Beside the name its shutter clicks on hover and as a photo opens; as the map loader it draws itself and the globe turns; the share card carries it too.
- **Motion** — one curve (`cubic-bezier(0.2, 0, 0, 1)`) and short durations; everything collapses to instant under `prefers-reduced-motion`.

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
    page.tsx                 landing
    map/                     the map, plus @modal/(..)p: the photo page drawn over it
    directory/               every place, as a table
    p/[friendly_name]/       per-photo page (standalone)
    admin/                   admin UI (Upload / Manage / Places)
    api/
      upload/                presigned R2 upload URL
      admin/process/         EXIF + resize + DB insert for an uploaded original
      admin/photos/          list / edit / rotate / delete photos
      admin/places/          CRUD for custom places
      admin/cache/           purge the Cloudflare cache for the R2 domain
      share/[slug]/          share card image
    components/              header, landing, map, directory and photo page pieces
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

# Optional: canonical origin for share links/QR codes in production
NEXT_PUBLIC_BASE_URL=...
```

## Development

```bash
npm install
npm run dev
```

## Photo workflow

Everything happens in `/admin`; there are no local scripts.

1. **Upload.** The browser asks `/api/upload` for a presigned URL and PUTs the original straight to R2.
2. **Process.** `/api/admin/process` downloads the original, decodes HEIC if needed, generates a 300px thumbnail and a 1600px large JPEG, reads EXIF (GPS and date), uploads both images to R2, writes the row to Postgres as `published`, and precomputes the share card. The photo is live on the map as soon as this finishes.
3. **Touch up.** In the Manage tab, edit captions/location/date, rotate, or delete.

### Setting a photo's location

Both the Upload tab and the edit dialog show a Mapbox picker under the caption field, backed by latitude/longitude textboxes. Selecting a file reads its EXIF GPS in the browser and prefills both the pin and the boxes, so an already-geotagged photo opens on its own location and can just be nudged. Clicking the map or dragging the pin rewrites the boxes; typing or pasting `lat, lon` moves the pin. Coordinates set here become `lat`/`lon` in the database.

Whatever is in the boxes at upload time wins over the file's EXIF. Clearing a prefilled location publishes the photo without coordinates rather than falling back to EXIF.

### Setting a photo's date

The EXIF capture date is used when present. If the file has none, the date entered on upload is used instead.

## Database migrations

Schema lives in `src/db/schema.ts` (`photos` and `places`). `drizzle-kit` reads `DATABASE_URL_UNPOOLED` from the environment:

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```
