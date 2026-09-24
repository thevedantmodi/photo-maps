import { pgTable, uuid, text, doublePrecision, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const photos = pgTable(
  'photos',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    friendly_name: text('friendly_name').unique().notNull(),
    thumb_name: text('thumb_name').notNull(),
    large_name: text('large_name').notNull(),
    original_name: text('original_name').notNull(),
    lat: doublePrecision('lat'),
    lon: doublePrecision('lon'),
    caption: text('caption'),
    date: timestamp('date', { withTimezone: true }),
    status: text('status').notNull().default('pending'),
    // shareVersion() value baked into the precomputed share card currently in R2, so the
    // read path can tell a fresh card from a stale/never-generated one. Null means "not
    // generated yet" — the share route falls back to a live render in that case.
    share_card_version: text('share_card_version'),
    created_at: timestamp('created_at', { withTimezone: true }).default(sql`now()`),
  },
  (table) => ({
    statusIdx: index('photos_status_idx').on(table.status),
    createdAtIdx: index('photos_created_at_idx').on(table.created_at),
  })
);

export type Photo = typeof photos.$inferSelect;
export type NewPhoto = typeof photos.$inferInsert;

// Hand-named spots Mapbox has no label for (open ocean, reefs, remote parks).
// Edited from the admin Places tab; see src/lib/customPlaces.ts for matching.
export const places = pgTable('places', {
  id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  name: text('name').notNull(),
  lat: doublePrecision('lat').notNull(),
  lon: doublePrecision('lon').notNull(),
  radius_km: doublePrecision('radius_km').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).default(sql`now()`),
});

export type PlaceRow = typeof places.$inferSelect;
