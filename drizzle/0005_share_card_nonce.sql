ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "share_card_nonce" integer DEFAULT 0 NOT NULL;
