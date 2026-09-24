CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"radius_km" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
-- Seed: the one place previously hard-coded in src/lib/customPlaces.ts.
INSERT INTO "places" ("name", "lat", "lon", "radius_km") VALUES ('Great Barrier Reef', -16.52, 146.0, 60);
