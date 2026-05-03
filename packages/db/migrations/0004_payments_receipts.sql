CREATE TABLE IF NOT EXISTS "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"stealth_address" text NOT NULL,
	"ephemeral_pub" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" numeric(78, 0) NOT NULL,
	"token_address" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"from_address" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_agent_id_agents_id_fk"
		FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id")
		ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "payments_agent_time_idx"
	ON "payments" ("agent_id", "detected_at");

CREATE INDEX IF NOT EXISTS "payments_stealth_idx"
	ON "payments" ("stealth_address");

CREATE UNIQUE INDEX IF NOT EXISTS "payments_tx_log_unq"
	ON "payments" ("tx_hash", "log_index");

CREATE TABLE IF NOT EXISTS "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"confirmed_by_recipient" boolean DEFAULT false NOT NULL,
	"eip712_payload" text,
	"eip712_signature" text,
	"appended_response_tx" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_payment_id_payments_id_fk"
		FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id")
		ON DELETE CASCADE ON UPDATE NO ACTION,
	CONSTRAINT "receipts_agent_id_agents_id_fk"
		FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id")
		ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "receipts_payment_unq"
	ON "receipts" ("payment_id");

CREATE INDEX IF NOT EXISTS "receipts_agent_idx"
	ON "receipts" ("agent_id");
