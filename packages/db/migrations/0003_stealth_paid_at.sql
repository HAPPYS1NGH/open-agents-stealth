ALTER TABLE "gateway_announcements" ADD COLUMN IF NOT EXISTS "paid_at" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "gateway_announcements_current_idx"
  ON "gateway_announcements" ("agent_id")
  WHERE "paid_at" IS NULL;
