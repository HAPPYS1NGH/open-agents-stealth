CREATE TABLE IF NOT EXISTS "gateway_announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"stealth_address" text NOT NULL,
	"ephemeral_pub" text NOT NULL,
	"view_tag" integer NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gateway_announcements" ADD CONSTRAINT "gateway_announcements_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gateway_announcements_agent_idx" ON "gateway_announcements" USING btree ("agent_id","generated_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gateway_announcements_agent_eph_unq" ON "gateway_announcements" USING btree ("agent_id","ephemeral_pub");