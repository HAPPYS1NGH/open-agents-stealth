CREATE TABLE IF NOT EXISTS "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_eoa" text NOT NULL,
	"agent_id" text,
	"agent_wallet_eoa" text,
	"subname_label" text NOT NULL,
	"base_addr" text NOT NULL,
	"text_records" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"view_key_encrypted" text,
	"treasury_safe_address" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_agent_id_unique" UNIQUE("agent_id"),
	CONSTRAINT "agents_subname_label_unique" UNIQUE("subname_label")
);
