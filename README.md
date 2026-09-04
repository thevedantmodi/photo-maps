# Photo Maps

An interactive map application for displaying geotagged photos. Photos are plotted on a Mapbox map with clustering, filterable by date, and viewable in a full-size lightbox.

## Stack

- **Frontend**: Next.js (App Router), React, Mapbox GL via `react-map-gl`, Framer Motion
- **Database**: Neon (PostgreSQL) via Drizzle ORM
- **Storage**: Cloudflare R2 (thumbnails + full-size images)
- **Photo processing**: Next.js API route (`sharp`, `exifr`), with an optional Rust/Cloudflare Worker processor
- **Deployment**: Vercel

## Prerequisites

- Node.js and npm
- A Neon database, Cloudflare R2 bucket, and Mapbox token

## Environment Variables

Create a `.env.local` file with:

```
DATABASE_URL=...
DATABASE_URL_UNPOOLED=...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
R2_PUBLIC_URL=...
NEXT_PUBLIC_MAPBOX_TOKEN=...
```

## Development

```bash
npm install
npm run dev
```

## Photo Workflow

A password-protected admin panel at `/admin` handles the full intake flow: upload photos, then process them.

Uploading sends the raw file to R2 via `/api/upload`. Processing (`/api/admin/process`) reads EXIF data, generates a thumbnail and an optimized large image, uploads both to R2, and writes a record to the database — either inline (`sharp` + `exifr`) or via a Rust/Cloudflare Worker processor when `PROCESSOR_URL` is set. From `/admin` you can also review, rotate, and approve or reject processed photos before they appear on the map.

### Setting a photo's location

Both the Upload tab and the edit dialog show a Mapbox picker under the caption field, backed by latitude/longitude textboxes. Selecting a file reads its EXIF GPS in the browser and prefills both the pin and the boxes, so an already-geotagged photo opens on its own location and can just be nudged. Clicking the map or dragging the pin rewrites the boxes; typing or pasting `lat, lon` moves the pin. Coordinates set here are what `lat`/`lon` become in the database, which is what places the photo on the public map.

Whatever is in the boxes at upload time wins over the file's EXIF. Clearing a prefilled location publishes the photo without coordinates rather than falling back to EXIF.

## Database Migrations

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```
