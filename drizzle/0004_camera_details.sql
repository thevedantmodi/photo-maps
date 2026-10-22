ALTER TABLE "photos" ADD COLUMN "camera" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "lens" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "focal_length_mm" double precision;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "f_number" double precision;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "exposure_s" double precision;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "iso" integer;