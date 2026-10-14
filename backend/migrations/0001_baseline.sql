-- Baseline schema, equivalent to the two drizzle-kit migrations it replaces
-- (drizzle/0000_sad_kabuki.sql and drizzle/0001_custom_places.sql).
--
-- Written to be safe against the existing production database: every statement is a no-op
-- when its object already exists, so running it there changes nothing but adding sqlx's own
-- bookkeeping table. On an empty database it creates the full schema. The Great Barrier
-- Reef seed only goes in when the places table is created here, so a place deleted from
-- the admin UI is never resurrected.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS "photos" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"friendly_name" text NOT NULL,
	"thumb_name" text NOT NULL,
	"large_name" text NOT NULL,
	"original_name" text NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"caption" text,
	"date" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"share_card_version" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "photos_friendly_name_unique" UNIQUE("friendly_name")
);

ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "share_card_version" text;

CREATE INDEX IF NOT EXISTS "photos_status_idx" ON "photos" USING btree ("status");
CREATE INDEX IF NOT EXISTS "photos_created_at_idx" ON "photos" USING btree ("created_at");

DO $$
BEGIN
	IF to_regclass('public.places') IS NULL THEN
		CREATE TABLE "places" (
			"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
			"name" text NOT NULL,
			"lat" double precision NOT NULL,
			"lon" double precision NOT NULL,
			"radius_km" double precision NOT NULL,
			"created_at" timestamp with time zone DEFAULT now()
		);
		INSERT INTO "places" ("name", "lat", "lon", "radius_km") VALUES ('Great Barrier Reef', -16.52, 146.0, 60);
	END IF;
END
$$;
