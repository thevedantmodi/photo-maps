# Photo Maps

An interactive map application for displaying geotagged photos. Photos are plotted on a Mapbox map with clustering, filterable by date, and viewable in a full-size lightbox.

## Stack

- **Frontend**: Next.js (App Router), React, Mapbox GL via `react-map-gl`, Framer Motion
- **Database**: Neon (PostgreSQL) via Drizzle ORM
- **Storage**: Cloudflare R2 (thumbnails + full-size images)
- **Photo processing**: Python scripts (`Pillow`, `boto3`)
- **Deployment**: Vercel

## Prerequisites

- Node.js and npm
- Python 3 with a virtual environment at `./venv`
- `exiftool` (for EXIF extraction during ingestion)
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

Raw photos (HEIC, DNG, JPG) go in `photos/` at the repo root — this directory is git-ignored.

### 1. Ingest

Reviews each photo interactively and lets you add a caption. Displays a thumbnail in the terminal if iTerm2 is running.

```bash
npm run ingest
```

### 2. Process

Reads EXIF data, generates a thumbnail and an optimized large image, uploads both to R2, and writes a record to the database.

```bash
npm run process
```

### 3. Admin

A password-protected admin panel is available at `/admin` for reviewing, rotating, and approving or rejecting processed photos before they appear on the map.

## Database Migrations

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```
