ALTER TABLE "gateway_announcements" ADD COLUMN IF NOT EXISTS "stealth_safe_address" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gateway_announcements_safe_idx" ON "gateway_announcements" USING btree ("stealth_safe_address");
