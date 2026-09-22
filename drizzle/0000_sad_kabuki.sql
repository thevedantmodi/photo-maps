-- This repo has no prior tracked drizzle-kit migrations, so `generate` produced a full
-- CREATE TABLE against an empty baseline. The `photos` table already exists in the real
-- database (built outside drizzle-kit), so that statement would fail with "relation
-- already exists". Hand-trimmed to the actual delta this change makes: one new column.
-- The snapshot in drizzle/meta/0000_snapshot.json is left as drizzle-kit generated it —
-- it represents the schema's current full shape and is what future `generate` runs diff
-- against, independent of what SQL actually ran to get there.
ALTER TABLE "photos" ADD COLUMN "share_card_version" text;
