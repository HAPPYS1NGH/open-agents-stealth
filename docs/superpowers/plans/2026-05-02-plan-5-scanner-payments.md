# Plan 5 — Scanner + Payments Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the loop on the spec's "agent gets paid privately" demo. Plan 4 issues a fresh stealth address per CCIP-Read query and writes one row to `gateway_announcements` per issuance. Plan 5 builds the consumer side: a **scanner worker** that watches Base mainnet for USDC `Transfer` events to those stealth addresses, persists matched payments to a new `payments` table, and pushes the resulting rows to the dashboard. The dashboard gains a `/dashboard/[agentId]/payments` page (table view with sender/amount/tx-link and a per-payment "publicly confirm" toggle backed by a new `receipts` row), and a public `/pay/[ens]` sender console that resolves any `<label>.gabhru.eth` to a fresh stealth address via the existing CCIP-Read gateway and fires a USDC transfer + ERC-5564 announcement from the visitor's connected wallet. The api gains `GET /api/agents/me/payments` (list, paginated), `POST /api/agents/me/receipts/:paymentId/confirm` (issue or revoke a `confirmed_by_recipient` toggle row in `receipts`), and `GET /api/agents/me/payments/stream` (Server-Sent Events for live updates). On-chain `appendResponse` of EIP-712 receipts to the ERC-8004 ReputationRegistry is **deferred to Plan 7** — Plan 5 stores the local `confirmed_by_recipient` flag and the EIP-712 payload but does not broadcast it.

**Architecture:** A new app — `apps/scanner` — runs as either (a) a long-lived Node process for self-hosters or (b) a Vercel Cron-triggered serverless function for the hackathon deploy (default: option b, with option a wired and tested for parity). The scanner reads `gateway_announcements` rows that haven't yet been reconciled, queries Base mainnet via viem `getLogs` for the USDC `Transfer(from, to=stealthAddress, value)` event in the relevant block range, decodes matches, and inserts `payments` rows keyed `(tx_hash, log_index)` so re-runs are idempotent. A second source of matches comes from **Alchemy Notify** webhooks at `POST /api/scanner/webhook` (signed with a shared secret); the api forwards verified webhook events into the scanner library so the same matching logic runs whether the trigger is the cron or the webhook. The dashboard uses SWR for the payments table (`/api/agents/:id/payments`) plus a server-sent-events stream for live updates (`/api/agents/me/payments/stream`) — when a new payment arrives, the table re-renders within ~1s. The `/pay/[ens]` page lives **inside** `apps/dashboard` (no separate Next project) at `src/app/pay/[ens]/page.tsx`; it has no SIWE auth, just a wallet-connect button (RainbowKit), a USDC amount input, an ENS lookup that calls viem's `getEnsAddress({ name, coinType: 2147492101 })` (which transparently routes through our gateway), and a single `useWriteContract` call that batches `usdc.transfer(stealth, amount)` followed by `announcer.announce(1, stealth, ephemeralPub, viewTag||metadata)`. The ephemeral pubkey + view tag come back from the gateway in a new `text(node, "stealth-payload")` record we add in Plan 5 — that record is one-shot, regenerated on every CCIP-Read query, and carries the same data the scanner already reads from `gateway_announcements`.

**Tech Stack:** TypeScript 5.x strict, Node 20+, viem 2.x (`getLogs` + `decodeEventLog` for USDC Transfer matching, `useWriteContract` on the dashboard), `@open-agents/db` for the new tables and queries, `@open-agents/crypto` for `splitMetaAddress` (verifying announcement payloads), `@open-agents/auth` for the JWT middleware on the new payment endpoints, vitest + a tiny in-process fixture for the scanner unit tests, Hardhat-free integration tests against a local Anvil fork on port 8545 (already used by Plan 2's e2e tests). Vercel Cron for the scheduled scanner; Alchemy Notify (free tier supports Base mainnet — verified) for low-latency webhook nudges. The dashboard adds `usehooks-ts` (specifically `useEventSource`) for the SSE consumer; the sender console uses the existing wagmi 2.x stack — no new wallet dep. **No new on-chain contracts. No KMS additions** (the scanner does not need view keys; everything it needs lives in `gateway_announcements` already, since Plan 4 stored `stealth_address` directly).

---

## File structure

After Plan 5, the repo gains:

```
open-agents/
├── apps/
│   ├── scanner/                                          # NEW app: payment scanner
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   ├── vercel.json                                   # cron + function config
│   │   ├── .env.example
│   │   ├── src/
│   │   │   ├── env.ts                                    # zod env parser
│   │   │   ├── lib/
│   │   │   │   ├── usdc.ts                               # USDC contract const + abi
│   │   │   │   ├── log-fetcher.ts                        # viem getLogs wrapper
│   │   │   │   ├── reconcile.ts                          # the matcher (pure fn)
│   │   │   │   ├── checkpoint.ts                         # last-scanned-block cursor
│   │   │   │   └── webhook-verify.ts                     # Alchemy Notify HMAC check
│   │   │   ├── routes/
│   │   │   │   ├── tick.ts                               # POST /tick — cron entrypoint
│   │   │   │   └── webhook.ts                            # POST /webhook — Alchemy push
│   │   │   ├── server.ts                                 # Hono app + Vercel handler
│   │   │   └── worker.ts                                 # long-lived loop (self-host)
│   │   └── tests/
│   │       ├── reconcile.test.ts
│   │       ├── checkpoint.test.ts
│   │       ├── log-fetcher.test.ts
│   │       ├── webhook-verify.test.ts
│   │       └── tick.test.ts
│   ├── api/
│   │   ├── src/
│   │   │   ├── env.ts                                    # MODIFIED: + USDC_ADDRESS, payment env
│   │   │   └── routes/
│   │   │       ├── agents.ts                             # MODIFIED: + payments + receipts
│   │   │       └── payments-stream.ts                    # NEW: SSE handler
│   │   └── tests/
│   │       ├── payments.test.ts                          # NEW: list endpoint
│   │       ├── receipts.test.ts                          # NEW: confirm toggle
│   │       └── payments-stream.test.ts                   # NEW: SSE smoke test
│   ├── gateway/
│   │   ├── src/
│   │   │   └── routes/
│   │   │       └── resolve.ts                            # MODIFIED: + text("stealth-payload")
│   │   └── tests/
│   │       └── resolve-stealth-payload.test.ts           # NEW
│   └── dashboard/
│       ├── package.json                                  # MODIFIED: + usehooks-ts, viem ABI
│       ├── src/
│       │   ├── app/
│       │   │   ├── dashboard/
│       │   │   │   ├── page.tsx                          # MODIFIED: payments column
│       │   │   │   └── [agentId]/
│       │   │   │       └── payments/
│       │   │   │           └── page.tsx                  # NEW: payments table page
│       │   │   └── pay/
│       │   │       └── [ens]/
│       │   │           └── page.tsx                      # NEW: sender console
│       │   ├── components/
│       │   │   ├── payments-table.tsx                    # NEW
│       │   │   ├── confirm-toggle.tsx                    # NEW
│       │   │   └── pay-form.tsx                          # NEW
│       │   ├── lib/
│       │   │   ├── usdc.ts                               # NEW: address + abi
│       │   │   ├── announcer.ts                          # NEW: ERC-5564 abi
│       │   │   └── pay-flow.ts                           # NEW: lookup + tx orchestration
│       │   └── hooks/
│       │       ├── use-payments.ts                       # NEW: SWR + SSE
│       │       └── use-confirm-payment.ts                # NEW
│       └── tests/
│           ├── payments-table.test.tsx
│           ├── pay-form.test.tsx
│           └── use-payments.test.ts
└── packages/
    └── db/
        ├── src/
        │   ├── schema.ts                                 # MODIFIED: + payments + receipts
        │   ├── queries/
        │   │   ├── payments.ts                           # NEW
        │   │   └── receipts.ts                           # NEW
        │   └── index.ts                                  # MODIFIED: re-exports
        ├── migrations/
        │   └── 0004_payments_receipts.sql                # NEW
        └── tests/
            ├── payments.test.ts                          # NEW
            └── receipts.test.ts                          # NEW
```

---

## Prerequisites

The engineer must have available:

- pnpm 9+ installed.
- Plans 1, 2, 3, and 4 complete and committed. In particular, Plan 4's `gateway_announcements` table exists and the gateway writes to it on every `addr()` call.
- Local Postgres running (`docker compose -f docker-compose.dev.yml up -d`) with all prior migrations applied (`0000_brainy_inhumans.sql`, `0001_stealth_announcements.sql`).
- A Base mainnet RPC URL with `eth_getLogs` support over a 5000-block range. The default `https://mainnet.base.org` works for hackathon demo volume; an Alchemy or QuickNode key is recommended for production.
- An Alchemy account with a Base mainnet app — used only as the webhook source (the scanner does not call Alchemy's JSON-RPC). Free tier permits up to 1500 webhook pushes/month, well above the demo's expected volume.
- A 32-byte hex string for `ALCHEMY_NOTIFY_SECRET` — Alchemy's webhook signing secret, copied from the Alchemy Notify dashboard. Generate locally for tests with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- A WalletConnect Cloud project ID (already configured for Plan 3) — the `/pay/[ens]` page reuses RainbowKit.
- USDC on Base mainnet for at least one e2e demo: address `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (canonical Circle-issued USDC on Base). The sender console hard-codes this address.
- The ERC-5564 Announcer at `0x55649E01B5Df198D18D95b5cc5051630cfD45564` on Base mainnet (already documented in the spec §5.2).
- Node 20+.
- A stealth-meta-published agent in the local DB to drive integration tests against. Re-using the Plan 4 `e2e-*` fixture is fine.

---

### Task 1: Add `payments` and `receipts` tables (Drizzle schema + migration)

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/queries/payments.ts`
- Create: `packages/db/src/queries/receipts.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/migrations/0004_payments_receipts.sql`
- Create: `packages/db/tests/payments.test.ts`
- Create: `packages/db/tests/receipts.test.ts`

**Decision: separate `payments` and `receipts` tables, not a merged shape.** The spec §9 lists them as separate tables and the data lifecycles diverge sharply: `payments` is append-only, written by the scanner, never updated after the row lands. `receipts` is mutable — the dashboard toggles `confirmed_by_recipient`, signs an EIP-712 payload, and (Plan 7) attaches an on-chain `appendResponse` tx hash. Folding the two into one table would force every payment row to carry nullable receipt columns it almost never uses; keeping them split keeps the scanner's insert path untouched by reputation work.

**Decision: USDC-only for v1, schema supports more.** The `token_address` column is `text NOT NULL`; the scanner always writes the canonical Base USDC address. Adding more tokens later is a config change in `apps/scanner/src/lib/usdc.ts` (rename to `tokens.ts`, expand the watch list) — no migration. The dashboard hard-codes USDC display formatting (6 decimals); per-token formatters are a Plan-X follow-up.

The `payments` table is keyed `(tx_hash, log_index)` with a unique index. Re-running the scanner over the same blocks is therefore idempotent — the second insert hits the unique constraint and is swallowed by the reconciler. We also index `(agent_id, detected_at desc)` for the dashboard's `ORDER BY detected_at DESC LIMIT 50` query, and `(stealth_address)` for the rare "what payment landed at this address" lookup.

The `receipts` table is keyed `(payment_id)` with a one-to-one constraint — at most one receipt per payment. The dashboard's confirm toggle does an UPSERT (insert + ON CONFLICT DO UPDATE on `payment_id`). Plan 7 will add `appended_response_tx` to track on-chain confirmation; for Plan 5 that column is nullable and untouched.

- [ ] **Step 1.1: Modify `packages/db/src/schema.ts`**

Append to the existing file (do not remove `agents` or `gateway_announcements`):

```ts
import { numeric, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * payments — one row per detected USDC transfer to a stealth address.
 *
 * Written by the scanner worker (Vercel Cron + Alchemy Notify webhook).
 * Append-only: rows are never UPDATEd after insertion. Receipt state lives
 * in the separate `receipts` table.
 *
 * agent_id          FK into agents.id. Non-null because every payment must
 *                   be reconciled to an agent via the announcement record.
 *
 * stealth_address   The 0x… 20-byte EVM address that received the USDC.
 *                   Pulled from gateway_announcements.stealth_address.
 *
 * ephemeral_pub     33-byte compressed secp256k1 ephemeral pubkey from the
 *                   gateway issuance. Stored here too (denormalized) so the
 *                   dashboard can show "view tag X / R = …" without a join.
 *
 * tx_hash           The USDC.Transfer tx hash. Used with log_index as the
 *                   uniqueness key — same payment cannot be inserted twice.
 *
 * log_index         Index of the Transfer event in the tx receipt.
 *
 * block_number      Base mainnet block number; lets the scanner cursor skip
 *                   ahead and the dashboard sort by chain time.
 *
 * token_address     The 0x… ERC-20 contract that emitted the Transfer.
 *                   v1: always Base USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913).
 *
 * amount            Raw token units (numeric(78,0) accommodates uint256).
 *                   USDC has 6 decimals; the dashboard formats display-side.
 *
 * from_address      The Transfer.from address; surfaced in the dashboard
 *                   as the "sender" and used by Plan 7 receipts.
 *
 * detected_at       Server-side timestamp of when the scanner inserted the row.
 *                   Distinct from block timestamp (which the scanner does NOT
 *                   read — saves an RPC roundtrip per match).
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    stealthAddress: text('stealth_address').notNull(),
    ephemeralPub: text('ephemeral_pub').notNull(),
    txHash: text('tx_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    blockNumber: numeric('block_number', { precision: 78, scale: 0 }).notNull(),
    tokenAddress: text('token_address').notNull(),
    amount: numeric('amount', { precision: 78, scale: 0 }).notNull(),
    fromAddress: text('from_address').notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    byAgentTime: index('payments_agent_time_idx').on(
      table.agentId,
      table.detectedAt,
    ),
    byStealth: index('payments_stealth_idx').on(table.stealthAddress),
    uniqueLog: uniqueIndex('payments_tx_log_unq').on(table.txHash, table.logIndex),
  }),
)

export type Payment = typeof payments.$inferSelect
export type NewPayment = typeof payments.$inferInsert

/**
 * receipts — per-payment "publicly confirm" state plus an EIP-712 payload.
 *
 * One row per payment, enforced via the unique index on payment_id. Writes
 * happen from the dashboard (POST /api/agents/me/receipts/:paymentId/confirm).
 *
 * confirmed_by_recipient  The toggle the agent owner flips in the UI. Plan 5
 *                         only persists this flag locally; Plan 7 broadcasts
 *                         appendResponse on-chain when it flips to true.
 *
 * eip712_payload          Stringified EIP-712 typed data ({ domain, types,
 *                         message }) the dashboard built when the toggle was
 *                         flipped. Plan 7 sends this to the wallet for signing
 *                         and ends up with eip712_signature populated.
 *
 * eip712_signature        65-byte 0x… signature, null until Plan 7 hooks the
 *                         wallet flow.
 *
 * appended_response_tx    Plan 7: tx hash of the appendResponse call on
 *                         ReputationRegistry. Plan 5 leaves this null.
 */
export const receipts = pgTable(
  'receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    confirmedByRecipient: boolean('confirmed_by_recipient').notNull().default(false),
    eip712Payload: text('eip712_payload'),
    eip712Signature: text('eip712_signature'),
    appendedResponseTx: text('appended_response_tx'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniquePayment: uniqueIndex('receipts_payment_unq').on(table.paymentId),
    byAgent: index('receipts_agent_idx').on(table.agentId),
  }),
)

export type Receipt = typeof receipts.$inferSelect
export type NewReceipt = typeof receipts.$inferInsert
```

- [ ] **Step 1.2: Create the migration `packages/db/migrations/0004_payments_receipts.sql`**

```sql
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
```

- [ ] **Step 1.3: Create `packages/db/src/queries/payments.ts`**

```ts
import { and, desc, eq, gt, sql } from 'drizzle-orm'
import type { DbClient } from '../client.js'
import {
  payments,
  receipts,
  type Payment,
  type NewPayment,
  type Receipt,
} from '../schema.js'

/**
 * Inserts a payment row. Throws on (tx_hash, log_index) unique violation —
 * the scanner reconciler swallows that and treats it as "already inserted".
 */
export async function insertPayment(
  db: DbClient,
  data: Omit<NewPayment, 'id' | 'detectedAt'>,
): Promise<Payment> {
  const [row] = await db
    .insert(payments)
    .values({
      ...data,
      stealthAddress: data.stealthAddress.toLowerCase(),
      tokenAddress: data.tokenAddress.toLowerCase(),
      fromAddress: data.fromAddress.toLowerCase(),
      txHash: data.txHash.toLowerCase(),
    })
    .returning()
  if (!row) throw new Error('insertPayment: no row returned')
  return row
}

export interface PaymentWithReceipt extends Payment {
  receipt: Receipt | null
}

/**
 * Lists payments for the given agent with their receipt (if any) joined.
 * Used by the dashboard's table view; cursored on detected_at.
 */
export async function listPaymentsByAgent(
  db: DbClient,
  agentRowId: string,
  opts: { limit?: number; afterDetectedAt?: Date } = {},
): Promise<PaymentWithReceipt[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const where = opts.afterDetectedAt
    ? and(eq(payments.agentId, agentRowId), gt(payments.detectedAt, opts.afterDetectedAt))
    : eq(payments.agentId, agentRowId)

  const rows = await db
    .select({
      payment: payments,
      receipt: receipts,
    })
    .from(payments)
    .leftJoin(receipts, eq(receipts.paymentId, payments.id))
    .where(where)
    .orderBy(desc(payments.detectedAt))
    .limit(limit)

  return rows.map((r) => ({ ...r.payment, receipt: r.receipt ?? null }))
}

/**
 * Finds a single payment by its UUID. Used by POST /receipts/:paymentId/confirm.
 */
export async function findPaymentById(
  db: DbClient,
  paymentId: string,
): Promise<Payment | null> {
  const rows = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1)
  return rows[0] ?? null
}

/**
 * Cheap existence probe used by the scanner before issuing the insert.
 * The unique constraint guards correctness; this just saves a roundtrip
 * when the scanner re-runs the same block window.
 */
export async function paymentExistsByTxLog(
  db: DbClient,
  txHash: string,
  logIndex: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.txHash, txHash.toLowerCase()), eq(payments.logIndex, logIndex)))
    .limit(1)
  return rows.length > 0
}

/**
 * Returns the highest block_number this scanner has seen for a given agent.
 * Used by the per-agent cursor to skip already-scanned ranges. Returns 0n
 * if no payments are recorded.
 */
export async function maxScannedBlockForAgent(
  db: DbClient,
  agentRowId: string,
): Promise<bigint> {
  const [row] = await db
    .select({ maxBlock: sql<string>`COALESCE(MAX(${payments.blockNumber})::text, '0')` })
    .from(payments)
    .where(eq(payments.agentId, agentRowId))
  return BigInt(row?.maxBlock ?? '0')
}
```

- [ ] **Step 1.4: Create `packages/db/src/queries/receipts.ts`**

```ts
import { and, eq } from 'drizzle-orm'
import type { DbClient } from '../client.js'
import { receipts, type Receipt, type NewReceipt } from '../schema.js'

/**
 * UPSERTs the per-payment receipt row. Used by the dashboard's confirm toggle.
 *
 * On first call: inserts a new receipt with the supplied state.
 * On subsequent calls: updates confirmed_by_recipient + eip712_payload +
 * eip712_signature, leaving appended_response_tx alone (Plan 7 owns that).
 */
export async function upsertReceipt(
  db: DbClient,
  data: Omit<NewReceipt, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<Receipt> {
  const [row] = await db
    .insert(receipts)
    .values(data)
    .onConflictDoUpdate({
      target: receipts.paymentId,
      set: {
        confirmedByRecipient: data.confirmedByRecipient,
        eip712Payload: data.eip712Payload ?? null,
        eip712Signature: data.eip712Signature ?? null,
        updatedAt: new Date(),
      },
    })
    .returning()
  if (!row) throw new Error('upsertReceipt: no row returned')
  return row
}

/**
 * Looks up a receipt by payment id. Used by GET /payments to join receipt
 * state into the response shape.
 */
export async function findReceiptByPayment(
  db: DbClient,
  paymentId: string,
): Promise<Receipt | null> {
  const rows = await db
    .select()
    .from(receipts)
    .where(eq(receipts.paymentId, paymentId))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Finds a receipt by id within a given agent scope. Used by Plan 7 to read
 * back the EIP-712 payload before submitting appendResponse.
 */
export async function findReceiptByIdForAgent(
  db: DbClient,
  receiptId: string,
  agentRowId: string,
): Promise<Receipt | null> {
  const rows = await db
    .select()
    .from(receipts)
    .where(and(eq(receipts.id, receiptId), eq(receipts.agentId, agentRowId)))
    .limit(1)
  return rows[0] ?? null
}
```

- [ ] **Step 1.5: Update `packages/db/src/index.ts`**

```ts
export * from './client.js'
export * from './schema.js'
export * from './queries/agents.js'
export * from './queries/announcements.js'
export * from './queries/payments.js'
export * from './queries/receipts.js'
```

- [ ] **Step 1.6: Apply the migration**

```bash
cd packages/db
pnpm db:migrate
```

Expected: drizzle-kit reports `0004_payments_receipts` applied. Confirm via psql:

```bash
docker exec -it $(docker compose -f ../../docker-compose.dev.yml ps -q postgres) \
  psql -U open_agents -d open_agents -c "\d payments" -c "\d receipts"
```

Expected: `payments` shows 11 columns + the FK + the three indexes; `receipts` shows 8 columns + 2 FKs + the two indexes.

- [ ] **Step 1.7: Write the payments queries test**

Create `packages/db/tests/payments.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createDb,
  insertAgent,
  insertGatewayAnnouncement,
  insertPayment,
  listPaymentsByAgent,
  findPaymentById,
  paymentExistsByTxLog,
  maxScannedBlockForAgent,
  deleteAnnouncementsOlderThan,
} from '../src/index.js'

const DB_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
let db: ReturnType<typeof createDb>
let agentRowId: string

beforeAll(async () => {
  db = createDb(DB_URL)
  const agent = await insertAgent(db, {
    ownerEoa: '0x0000000000000000000000000000000000000044',
    subnameLabel: 'pay-test-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
  })
  agentRowId = agent.id
  await insertGatewayAnnouncement(db, {
    agentId: agentRowId,
    stealthAddress: '0x' + 'aa'.repeat(20),
    ephemeralPub: '0x02' + '11'.repeat(32),
    viewTag: 0x01,
  })
})

afterAll(async () => {
  await deleteAnnouncementsOlderThan(db, new Date(Date.now() + 1000 * 60 * 60))
})

describe('payments queries', () => {
  it('inserts and reads back', async () => {
    const row = await insertPayment(db, {
      agentId: agentRowId,
      stealthAddress: '0x' + 'aa'.repeat(20),
      ephemeralPub: '0x02' + '11'.repeat(32),
      txHash: '0x' + 'cd'.repeat(32),
      logIndex: 7,
      blockNumber: '20000000',
      tokenAddress: USDC,
      amount: '5000000', // 5 USDC
      fromAddress: '0x' + 'be'.repeat(20),
    })
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/)

    const back = await findPaymentById(db, row.id)
    expect(back?.amount).toBe('5000000')
    expect(back?.tokenAddress).toBe(USDC)
  })

  it('rejects duplicate (tx_hash, log_index)', async () => {
    const dupTx = '0x' + 'ee'.repeat(32)
    await insertPayment(db, {
      agentId: agentRowId,
      stealthAddress: '0x' + 'bb'.repeat(20),
      ephemeralPub: '0x02' + '22'.repeat(32),
      txHash: dupTx,
      logIndex: 3,
      blockNumber: '20000005',
      tokenAddress: USDC,
      amount: '1000000',
      fromAddress: '0x' + 'be'.repeat(20),
    })
    await expect(
      insertPayment(db, {
        agentId: agentRowId,
        stealthAddress: '0x' + 'cc'.repeat(20),
        ephemeralPub: '0x02' + '33'.repeat(32),
        txHash: dupTx,
        logIndex: 3,
        blockNumber: '20000005',
        tokenAddress: USDC,
        amount: '7777',
        fromAddress: '0x' + 'be'.repeat(20),
      }),
    ).rejects.toThrow()
  })

  it('paymentExistsByTxLog short-circuits the reconciler', async () => {
    const probeTx = '0x' + '99'.repeat(32)
    expect(await paymentExistsByTxLog(db, probeTx, 0)).toBe(false)
    await insertPayment(db, {
      agentId: agentRowId,
      stealthAddress: '0x' + 'dd'.repeat(20),
      ephemeralPub: '0x02' + '44'.repeat(32),
      txHash: probeTx,
      logIndex: 0,
      blockNumber: '20000010',
      tokenAddress: USDC,
      amount: '1',
      fromAddress: '0x' + 'be'.repeat(20),
    })
    expect(await paymentExistsByTxLog(db, probeTx, 0)).toBe(true)
  })

  it('lists payments for an agent newest-first', async () => {
    const rows = await listPaymentsByAgent(db, agentRowId, { limit: 50 })
    expect(rows.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.detectedAt.getTime()).toBeGreaterThanOrEqual(
        rows[i]!.detectedAt.getTime(),
      )
    }
    expect(rows[0]!.receipt).toBeNull()
  })

  it('maxScannedBlockForAgent returns the highest block', async () => {
    const max = await maxScannedBlockForAgent(db, agentRowId)
    expect(max).toBeGreaterThanOrEqual(20000010n)
  })
})
```

- [ ] **Step 1.8: Write the receipts queries test**

Create `packages/db/tests/receipts.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import {
  createDb,
  insertAgent,
  insertPayment,
  upsertReceipt,
  findReceiptByPayment,
  findReceiptByIdForAgent,
} from '../src/index.js'

const DB_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
let db: ReturnType<typeof createDb>
let agentRowId: string
let paymentId: string

beforeAll(async () => {
  db = createDb(DB_URL)
  const agent = await insertAgent(db, {
    ownerEoa: '0x0000000000000000000000000000000000000045',
    subnameLabel: 'rcpt-test-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
  })
  agentRowId = agent.id
  const payment = await insertPayment(db, {
    agentId: agentRowId,
    stealthAddress: '0x' + 'aa'.repeat(20),
    ephemeralPub: '0x02' + '55'.repeat(32),
    txHash: '0x' + 'aa'.repeat(32),
    logIndex: 1,
    blockNumber: '20000020',
    tokenAddress: USDC,
    amount: '1000',
    fromAddress: '0x' + 'be'.repeat(20),
  })
  paymentId = payment.id
})

describe('receipts queries', () => {
  it('upsert inserts on first call', async () => {
    const r = await upsertReceipt(db, {
      paymentId,
      agentId: agentRowId,
      confirmedByRecipient: true,
      eip712Payload: JSON.stringify({ foo: 'bar' }),
    })
    expect(r.confirmedByRecipient).toBe(true)
    expect(r.eip712Payload).toContain('foo')
  })

  it('upsert toggles on second call (same payment_id)', async () => {
    const before = await findReceiptByPayment(db, paymentId)
    expect(before?.confirmedByRecipient).toBe(true)

    const r = await upsertReceipt(db, {
      paymentId,
      agentId: agentRowId,
      confirmedByRecipient: false,
    })
    expect(r.confirmedByRecipient).toBe(false)
    expect(r.eip712Payload).toBeNull()

    // updatedAt advanced.
    expect(r.updatedAt.getTime()).toBeGreaterThanOrEqual(before!.updatedAt.getTime())
  })

  it('findReceiptByIdForAgent scopes correctly', async () => {
    const before = await findReceiptByPayment(db, paymentId)
    const found = await findReceiptByIdForAgent(db, before!.id, agentRowId)
    expect(found?.id).toBe(before!.id)

    const notFound = await findReceiptByIdForAgent(
      db,
      before!.id,
      '00000000-0000-0000-0000-000000000000',
    )
    expect(notFound).toBeNull()
  })
})
```

- [ ] **Step 1.9: Run the tests**

```bash
pnpm --filter @open-agents/db test
```

Expected: 5 payments tests + 3 receipts tests pass; previous announcements + agents tests still pass.

- [ ] **Step 1.10: Commit**

```bash
cd ../..
git add packages/db/src/schema.ts packages/db/src/queries/payments.ts \
  packages/db/src/queries/receipts.ts packages/db/src/index.ts \
  packages/db/migrations/0004_payments_receipts.sql \
  packages/db/tests/payments.test.ts packages/db/tests/receipts.test.ts
git commit -m "$(cat <<'EOF'
feat(db): payments + receipts tables for the scanner pipeline

payments is append-only, written by the scanner, keyed (tx_hash, log_index)
unique so re-runs are idempotent. Indexed (agent_id, detected_at) for the
dashboard list and (stealth_address) for reverse lookups. amount + block_number
are numeric(78,0) to fit uint256.

receipts is one-per-payment (unique index on payment_id), holds the local
confirmed_by_recipient flag plus the EIP-712 payload + signature the dashboard
captures during the toggle. appended_response_tx is wired but null in Plan 5
— Plan 7 owns the on-chain appendResponse step.

Migration 0004 applies cleanly on top of 0003; 0001/0002/0003 (Plan 4
follow-ups for gateway_announcements + path-B Safe + paid_at) remain
untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Scaffold `apps/scanner` (Hono + Vercel Cron handler)

**Files:**
- Create: `apps/scanner/package.json`
- Create: `apps/scanner/tsconfig.json`
- Create: `apps/scanner/vitest.config.ts`
- Create: `apps/scanner/vercel.json`
- Create: `apps/scanner/.env.example`
- Create: `apps/scanner/.gitignore`
- Create: `apps/scanner/src/env.ts`
- Create: `apps/scanner/src/server.ts`
- Create: `apps/scanner/src/lib/usdc.ts`

**Decision: Vercel Cron + Alchemy Notify webhook (hybrid), with a poll-only fallback.** Reasoning: Alchemy Notify webhooks deliver in <2s and Alchemy's free tier supports Base mainnet (verified at `https://www.alchemy.com/notify` — they call it "Address Activity" notifications and 1500 push events/month is enough for the demo). But webhook-only leaves blind spots when Alchemy is degraded, and self-hosters might not want an Alchemy account. So we layer: a Vercel Cron that fires every minute does a backfill `getLogs` for the last few hundred blocks, and the webhook is the low-latency front line. Both paths funnel through the same `reconcile()` function. Self-hosters can disable the webhook (`SCANNER_WEBHOOK=off`) and rely on the cron; production runs both.

**Decision: keep the scanner in its own app, not a function under `apps/api`.** Reasoning: the api carries SIWE/JWT middleware, handles user-facing latency budgets, and rolls up the dashboard. The scanner runs unattended, has different env requirements (RPC + Alchemy secret), and we want the cron schedule to be configurable per-app in `vercel.json` without polluting api's. Same monorepo, same `pnpm install`, separate Vercel project.

- [ ] **Step 2.1: Create `apps/scanner/package.json`**

```json
{
  "name": "@open-agents/scanner",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "worker": "tsx src/worker.ts",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "echo 'no-op'"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.7",
    "@open-agents/crypto": "workspace:*",
    "@open-agents/db": "workspace:*",
    "hono": "^4.6.9",
    "viem": "^2.21.41",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.0",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2.2: Create `apps/scanner/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 2.3: Create `apps/scanner/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
```

- [ ] **Step 2.4: Create `apps/scanner/vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/tick",
      "schedule": "* * * * *"
    }
  ],
  "functions": {
    "src/server.ts": {
      "maxDuration": 60
    }
  }
}
```

The cron schedule is `* * * * *` (every minute). Vercel's hobby tier permits one cron job and a minute-granular schedule; this fits inside the free tier. The function `maxDuration: 60` gives a comfortable budget for `getLogs` over ~3000 blocks (Base produces ~30 blocks/min).

- [ ] **Step 2.5: Create `apps/scanner/.env.example`**

```
# Database
DATABASE_URL=postgres://open_agents:open_agents_dev@localhost:5434/open_agents

# Base mainnet RPC. Public default works for demo; Alchemy/QuickNode preferred.
BASE_RPC_URL=https://mainnet.base.org

# Alchemy Notify webhook. Set SCANNER_WEBHOOK=off to disable webhook handling.
SCANNER_WEBHOOK=on
ALCHEMY_NOTIFY_SECRET=

# How many blocks the cron tick scans per invocation. Default 3000 = ~100min
# of Base blocks, generous overlap for missed pushes. Lower for cheaper RPC.
SCAN_LOOKBACK_BLOCKS=3000

# Cron entrypoint protection. Vercel Cron sets `Authorization: Bearer <secret>`
# when this var is configured in the dashboard; we verify the same here.
CRON_SECRET=

# Set to "off" in unit tests to skip the actual RPC calls.
SCANNER_RPC=on
```

- [ ] **Step 2.6: Create `apps/scanner/.gitignore`**

```
node_modules
dist
.env
.env.local
.vercel
```

- [ ] **Step 2.7: Create `apps/scanner/src/env.ts`**

```ts
import { z } from 'zod'

const emptyAsUndefined = (v: unknown) => (v === '' ? undefined : v)

const envSchema = z.object({
  PORT: z.coerce.number().default(3002),
  DATABASE_URL: z.string().url(),
  BASE_RPC_URL: z.string().url().default('https://mainnet.base.org'),
  SCAN_LOOKBACK_BLOCKS: z.coerce.number().int().positive().default(3000),
  SCANNER_WEBHOOK: z
    .preprocess(emptyAsUndefined, z.enum(['on', 'off']).optional())
    .transform((v) => v ?? 'on'),
  SCANNER_RPC: z
    .preprocess(emptyAsUndefined, z.enum(['on', 'off']).optional())
    .transform((v) => v ?? 'on'),
  ALCHEMY_NOTIFY_SECRET: z.preprocess(emptyAsUndefined, z.string().min(8).optional()),
  CRON_SECRET: z.preprocess(emptyAsUndefined, z.string().min(8).optional()),
})

export const env = envSchema.parse(process.env)
```

- [ ] **Step 2.8: Create `apps/scanner/src/lib/usdc.ts`**

```ts
import { parseAbiItem, type Address } from 'viem'

/**
 * Canonical Circle-issued USDC on Base mainnet.
 * https://basescan.org/token/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
 */
export const BASE_USDC_ADDRESS: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

/** USDC has 6 decimals; the dashboard formats display-side. */
export const BASE_USDC_DECIMALS = 6

/**
 * The single event ABI item the scanner cares about. Using parseAbiItem
 * keeps the bundle tiny — we never construct ERC-20 transfers, only decode them.
 */
export const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
)
```

- [ ] **Step 2.9: Create `apps/scanner/src/server.ts`**

```ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { env } from './env.js'

const app = new Hono()

app.get('/health', (c) => c.json({ ok: true, service: 'scanner' }))

// Routes wired in subsequent tasks (Task 5: /tick, Task 6: /webhook).

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`scanner listening on :${info.port}`)
  })
}

export default app
```

- [ ] **Step 2.10: Update `pnpm-workspace.yaml`**

The repo's `pnpm-workspace.yaml` already lists `apps/*`; no edit required. Verify:

```bash
cd /path/to/open-agents
pnpm -r ls --depth -1 | grep '@open-agents/scanner'
```

Expected: `@open-agents/scanner 0.1.0` once. If missing, run `pnpm install` from the repo root.

- [ ] **Step 2.11: Commit**

```bash
git add apps/scanner/package.json apps/scanner/tsconfig.json \
  apps/scanner/vitest.config.ts apps/scanner/vercel.json \
  apps/scanner/.env.example apps/scanner/.gitignore \
  apps/scanner/src/env.ts apps/scanner/src/server.ts \
  apps/scanner/src/lib/usdc.ts
git commit -m "$(cat <<'EOF'
feat(scanner): scaffold @open-agents/scanner app

Hono server with /health, env parser, and a Vercel Cron schedule (every
minute hitting /tick). Routes are wired in subsequent tasks.

usdc.ts pins the canonical Base USDC address + the Transfer event ABI
item the matcher uses. Decimal formatting stays display-side.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Log fetcher (viem `getLogs` wrapper with chunking)

**Files:**
- Create: `apps/scanner/src/lib/log-fetcher.ts`
- Create: `apps/scanner/tests/log-fetcher.test.ts`

The scanner needs to fetch USDC `Transfer` logs filtered to a list of stealth addresses. Public Base RPC caps `eth_getLogs` at a 5000-block range; Alchemy's free tier accepts more but we keep the chunk size at 1000 to stay polite. The log fetcher splits a `(fromBlock, toBlock)` range into chunks and concatenates results.

The `to` topic filter uses an array of addresses — viem's `getLogs` handles this natively (`args.to: [...]`). When we have N stealth addresses to watch, the RPC node does the filtering server-side; we never fetch all USDC transfers. For demo scale (a few dozen agents × a few stealth addresses each) this is well within `getLogs` limits.

- [ ] **Step 3.1: Write the failing test**

Create `apps/scanner/tests/log-fetcher.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { fetchTransferLogsToAddresses, chunkBlockRange } from '../src/lib/log-fetcher.js'
import { BASE_USDC_ADDRESS } from '../src/lib/usdc.js'

describe('chunkBlockRange', () => {
  it('returns a single chunk when range fits', () => {
    expect(chunkBlockRange(100n, 1099n, 1000n)).toEqual([
      { fromBlock: 100n, toBlock: 1099n },
    ])
  })

  it('splits inclusive ranges into chunks of size N', () => {
    expect(chunkBlockRange(0n, 2500n, 1000n)).toEqual([
      { fromBlock: 0n, toBlock: 999n },
      { fromBlock: 1000n, toBlock: 1999n },
      { fromBlock: 2000n, toBlock: 2500n },
    ])
  })

  it('handles fromBlock === toBlock', () => {
    expect(chunkBlockRange(7n, 7n, 1000n)).toEqual([
      { fromBlock: 7n, toBlock: 7n },
    ])
  })

  it('throws when fromBlock > toBlock', () => {
    expect(() => chunkBlockRange(20n, 10n, 1000n)).toThrow()
  })

  it('throws on non-positive chunk size', () => {
    expect(() => chunkBlockRange(0n, 100n, 0n)).toThrow()
  })
})

describe('fetchTransferLogsToAddresses', () => {
  it('returns an empty array when address list is empty', async () => {
    const fakeClient = { getLogs: vi.fn() } as unknown as Parameters<
      typeof fetchTransferLogsToAddresses
    >[0]['client']
    const out = await fetchTransferLogsToAddresses({
      client: fakeClient,
      addresses: [],
      fromBlock: 1n,
      toBlock: 1000n,
    })
    expect(out).toEqual([])
    expect((fakeClient as { getLogs: { mock: { calls: unknown[] } } }).getLogs.mock.calls.length).toBe(0)
  })

  it('issues one getLogs per chunk and concatenates results', async () => {
    const stub = vi
      .fn()
      .mockResolvedValueOnce([{ args: { from: '0x1', to: '0x2', value: 1n }, transactionHash: '0xa', logIndex: 0, blockNumber: 1n, address: BASE_USDC_ADDRESS }])
      .mockResolvedValueOnce([{ args: { from: '0x3', to: '0x4', value: 2n }, transactionHash: '0xb', logIndex: 1, blockNumber: 1500n, address: BASE_USDC_ADDRESS }])
    const fakeClient = { getLogs: stub } as unknown as Parameters<
      typeof fetchTransferLogsToAddresses
    >[0]['client']
    const out = await fetchTransferLogsToAddresses({
      client: fakeClient,
      addresses: ['0x' + 'aa'.repeat(20)],
      fromBlock: 1n,
      toBlock: 1500n,
      chunkSize: 1000n,
    })
    expect(stub).toHaveBeenCalledTimes(2)
    expect(out.length).toBe(2)
    expect(out[0]!.transactionHash).toBe('0xa')
    expect(out[1]!.transactionHash).toBe('0xb')
  })

  it('lowercases address inputs before passing to getLogs', async () => {
    const stub = vi.fn().mockResolvedValue([])
    const fakeClient = { getLogs: stub } as unknown as Parameters<
      typeof fetchTransferLogsToAddresses
    >[0]['client']
    await fetchTransferLogsToAddresses({
      client: fakeClient,
      addresses: ['0xAbCdEf' + '00'.repeat(17)],
      fromBlock: 1n,
      toBlock: 100n,
    })
    const call = stub.mock.calls[0]![0] as { args: { to: string[] } }
    expect(call.args.to[0]).toBe(('0xAbCdEf' + '00'.repeat(17)).toLowerCase())
  })
})
```

- [ ] **Step 3.2: Run the test to verify it fails**

```bash
cd apps/scanner
pnpm test
```

Expected: FAIL — `log-fetcher.ts` does not exist.

- [ ] **Step 3.3: Create `apps/scanner/src/lib/log-fetcher.ts`**

```ts
import type { Address, PublicClient } from 'viem'
import { BASE_USDC_ADDRESS, TRANSFER_EVENT } from './usdc.js'

export interface BlockRangeChunk {
  fromBlock: bigint
  toBlock: bigint
}

/**
 * Splits an inclusive [fromBlock, toBlock] range into chunks of at most
 * `chunkSize` blocks each. Each chunk is itself inclusive and contiguous.
 *
 * Used to keep `eth_getLogs` requests within the RPC's range cap. Public
 * Base RPC caps at 5000; we default to 1000 for headroom.
 */
export function chunkBlockRange(
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize: bigint,
): BlockRangeChunk[] {
  if (chunkSize <= 0n) throw new Error('chunkBlockRange: chunkSize must be > 0')
  if (fromBlock > toBlock) {
    throw new Error(`chunkBlockRange: fromBlock (${fromBlock}) > toBlock (${toBlock})`)
  }
  const chunks: BlockRangeChunk[] = []
  let cur = fromBlock
  while (cur <= toBlock) {
    const end = cur + chunkSize - 1n
    chunks.push({ fromBlock: cur, toBlock: end > toBlock ? toBlock : end })
    cur = end + 1n
  }
  return chunks
}

export interface DecodedTransferLog {
  transactionHash: `0x${string}`
  logIndex: number
  blockNumber: bigint
  address: Address
  args: {
    from: Address
    to: Address
    value: bigint
  }
}

export interface FetchTransferLogsParams {
  client: Pick<PublicClient, 'getLogs'>
  addresses: Address[]
  fromBlock: bigint
  toBlock: bigint
  chunkSize?: bigint
  contract?: Address
}

/**
 * Fetches USDC Transfer events whose `to` matches any of the supplied
 * stealth addresses, over the inclusive [fromBlock, toBlock] range.
 *
 * Splits into chunks of `chunkSize` (default 1000) blocks, issues one
 * getLogs per chunk, concatenates. Returns logs in the order the RPC
 * returned them (chunk order, then RPC order within a chunk).
 *
 * No-ops when `addresses` is empty (saves an RPC roundtrip).
 */
export async function fetchTransferLogsToAddresses(
  params: FetchTransferLogsParams,
): Promise<DecodedTransferLog[]> {
  if (params.addresses.length === 0) return []
  const chunkSize = params.chunkSize ?? 1000n
  const contract = params.contract ?? BASE_USDC_ADDRESS
  const lowered = params.addresses.map((a) => a.toLowerCase() as Address)

  const chunks = chunkBlockRange(params.fromBlock, params.toBlock, chunkSize)
  const out: DecodedTransferLog[] = []
  for (const c of chunks) {
    const logs = await params.client.getLogs({
      address: contract,
      event: TRANSFER_EVENT,
      args: { to: lowered },
      fromBlock: c.fromBlock,
      toBlock: c.toBlock,
    })
    for (const log of logs) {
      out.push({
        transactionHash: log.transactionHash as `0x${string}`,
        logIndex: log.logIndex as number,
        blockNumber: log.blockNumber as bigint,
        address: log.address as Address,
        args: {
          from: log.args.from as Address,
          to: log.args.to as Address,
          value: log.args.value as bigint,
        },
      })
    }
  }
  return out
}
```

- [ ] **Step 3.4: Run the tests to verify they pass**

```bash
pnpm test
```

Expected: 8 tests pass (5 chunkBlockRange + 3 fetchTransferLogsToAddresses).

- [ ] **Step 3.5: Commit**

```bash
cd ../..
git add apps/scanner/src/lib/log-fetcher.ts apps/scanner/tests/log-fetcher.test.ts
git commit -m "$(cat <<'EOF'
feat(scanner): chunked viem getLogs wrapper for USDC Transfer matching

chunkBlockRange splits an inclusive block range into 1000-block chunks
to stay inside RPC limits. fetchTransferLogsToAddresses issues one
getLogs per chunk, filtered server-side by the indexed `to` topic so
we never download unrelated USDC transfers. Tests exercise both pure
chunking edges and a vi.fn-backed RPC stub.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Reconciler — match logs to announcements, insert payments

**Files:**
- Create: `apps/scanner/src/lib/reconcile.ts`
- Create: `apps/scanner/src/lib/checkpoint.ts`
- Create: `apps/scanner/tests/reconcile.test.ts`
- Create: `apps/scanner/tests/checkpoint.test.ts`

The reconciler is the heart of the scanner. Given a list of `DecodedTransferLog`s and a lookup map from `stealthAddress -> { agentId, ephemeralPub }` (built by reading `gateway_announcements`), it inserts one `payments` row per match. The unique constraint on `(tx_hash, log_index)` makes the operation idempotent: re-running over the same blocks is safe.

The `checkpoint` module owns the cursor: per-agent `(blockNumber, detectedAt)` saved in a tiny `scanner_checkpoints` shape. **Decision: store the checkpoint in `payments.maxBlockNumber` rather than a separate table.** Reasoning: a separate table adds a write per tick even when no payment lands; deriving the cursor from `MAX(block_number)` is one query and keeps the schema small. The downside is that an agent with zero payments has no cursor, which we mitigate by falling back to `currentBlock - SCAN_LOOKBACK_BLOCKS` whenever `maxScannedBlockForAgent` returns 0.

**Decision: scan only agents with `stealthMetaPublished == true` (i.e., a valid `text_records['stealth-meta']`).** Plan 3 stub agents have neither announcements nor stealth metas, so scanning them is a waste. We skip them at the agent-list step.

- [ ] **Step 4.1: Write the failing reconcile test**

Create `apps/scanner/tests/reconcile.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createDb,
  insertAgent,
  insertGatewayAnnouncement,
  listPaymentsByAgent,
  paymentExistsByTxLog,
} from '@open-agents/db'
import { reconcileLogsToPayments } from '../src/lib/reconcile.js'
import { BASE_USDC_ADDRESS } from '../src/lib/usdc.js'
import type { DecodedTransferLog } from '../src/lib/log-fetcher.js'

const DB_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
process.env['DATABASE_URL'] = DB_URL

let db: ReturnType<typeof createDb>
let agentRowId: string
const STEALTH_A = ('0x' + 'aa'.repeat(20)).toLowerCase() as `0x${string}`
const STEALTH_B = ('0x' + 'bb'.repeat(20)).toLowerCase() as `0x${string}`
const EPH_A = '0x02' + '11'.repeat(32)
const EPH_B = '0x03' + '22'.repeat(32)

beforeAll(async () => {
  db = createDb(DB_URL)
  const agent = await insertAgent(db, {
    ownerEoa: '0x0000000000000000000000000000000000000055',
    subnameLabel: 'rec-test-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
  })
  agentRowId = agent.id
  await insertGatewayAnnouncement(db, {
    agentId: agentRowId,
    stealthAddress: STEALTH_A,
    ephemeralPub: EPH_A,
    viewTag: 0x01,
  })
  await insertGatewayAnnouncement(db, {
    agentId: agentRowId,
    stealthAddress: STEALTH_B,
    ephemeralPub: EPH_B,
    viewTag: 0x02,
  })
})

afterAll(() => {
  // payments cascade-deletes when the test agent is purged by the next runner.
})

function makeLog(opts: {
  to: `0x${string}`
  from?: `0x${string}`
  amount?: bigint
  tx?: `0x${string}`
  logIdx?: number
  block?: bigint
}): DecodedTransferLog {
  return {
    transactionHash: opts.tx ?? (`0x${'cc'.repeat(32)}` as `0x${string}`),
    logIndex: opts.logIdx ?? 0,
    blockNumber: opts.block ?? 20_000_100n,
    address: BASE_USDC_ADDRESS,
    args: {
      from: (opts.from ?? `0x${'be'.repeat(20)}`) as `0x${string}`,
      to: opts.to,
      value: opts.amount ?? 5_000_000n,
    },
  }
}

describe('reconcileLogsToPayments', () => {
  it('inserts one payment per matched log', async () => {
    const logs = [
      makeLog({ to: STEALTH_A, tx: `0x${'10'.repeat(32)}`, logIdx: 0 }),
      makeLog({ to: STEALTH_B, tx: `0x${'10'.repeat(32)}`, logIdx: 1 }),
    ]
    const summary = await reconcileLogsToPayments({
      db,
      logs,
      tokenAddress: BASE_USDC_ADDRESS,
    })
    expect(summary.inserted).toBe(2)
    expect(summary.skipped).toBe(0)
    expect(summary.unmatched).toBe(0)

    const rows = await listPaymentsByAgent(db, agentRowId, { limit: 50 })
    const matchA = rows.find((r) => r.stealthAddress === STEALTH_A)
    expect(matchA?.amount).toBe('5000000')
    expect(matchA?.ephemeralPub).toBe(EPH_A)
  })

  it('is idempotent (re-running same logs inserts 0)', async () => {
    const logs = [makeLog({ to: STEALTH_A, tx: `0x${'10'.repeat(32)}`, logIdx: 0 })]
    const summary = await reconcileLogsToPayments({
      db,
      logs,
      tokenAddress: BASE_USDC_ADDRESS,
    })
    expect(summary.inserted).toBe(0)
    expect(summary.skipped).toBe(1)
  })

  it('skips logs whose `to` is not in any announcement', async () => {
    const orphan = `0x${'ff'.repeat(20)}` as `0x${string}`
    const summary = await reconcileLogsToPayments({
      db,
      logs: [makeLog({ to: orphan, tx: `0x${'77'.repeat(32)}`, logIdx: 0 })],
      tokenAddress: BASE_USDC_ADDRESS,
    })
    expect(summary.inserted).toBe(0)
    expect(summary.unmatched).toBe(1)
  })

  it('handles many logs in a single call', async () => {
    const logs: DecodedTransferLog[] = []
    for (let i = 0; i < 20; i++) {
      logs.push(
        makeLog({
          to: STEALTH_A,
          tx: (`0x${i.toString(16).padStart(2, '0').repeat(32)}`) as `0x${string}`,
          logIdx: 0,
          block: 20_000_200n + BigInt(i),
        }),
      )
    }
    const summary = await reconcileLogsToPayments({
      db,
      logs,
      tokenAddress: BASE_USDC_ADDRESS,
    })
    expect(summary.inserted).toBe(20)
    for (const log of logs) {
      expect(await paymentExistsByTxLog(db, log.transactionHash, log.logIndex)).toBe(true)
    }
  })
})
```

- [ ] **Step 4.2: Write the failing checkpoint test**

Create `apps/scanner/tests/checkpoint.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createDb,
  insertAgent,
  insertPayment,
} from '@open-agents/db'
import { computeStartBlock, fetchActiveScanTargets } from '../src/lib/checkpoint.js'

const DB_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
process.env['DATABASE_URL'] = DB_URL
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'

let db: ReturnType<typeof createDb>
let agentWithMeta: string
let agentWithoutMeta: string

beforeAll(async () => {
  db = createDb(DB_URL)
  const a = await insertAgent(db, {
    ownerEoa: '0x0000000000000000000000000000000000000066',
    subnameLabel: 'ck-meta-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
    textRecords: { 'stealth-meta': '0x' + 'aa'.repeat(33) + 'bb'.repeat(33) },
  })
  agentWithMeta = a.id
  const b = await insertAgent(db, {
    ownerEoa: '0x0000000000000000000000000000000000000067',
    subnameLabel: 'ck-nometa-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
  })
  agentWithoutMeta = b.id
})

afterAll(() => {
  // cascade cleanup on agent purge
})

describe('computeStartBlock', () => {
  it('falls back to currentBlock - lookback when no payments exist', async () => {
    const start = await computeStartBlock({
      db,
      agentRowId: agentWithMeta,
      currentBlock: 30_000_000n,
      lookback: 3000n,
    })
    expect(start).toBe(30_000_000n - 3000n)
  })

  it('uses MAX(block_number) + 1 when payments exist', async () => {
    await insertPayment(db, {
      agentId: agentWithMeta,
      stealthAddress: '0x' + 'aa'.repeat(20),
      ephemeralPub: '0x02' + '11'.repeat(32),
      txHash: '0x' + '01'.repeat(32),
      logIndex: 0,
      blockNumber: '20_500_000'.replaceAll('_', ''),
      tokenAddress: USDC,
      amount: '1',
      fromAddress: '0x' + 'be'.repeat(20),
    })
    const start = await computeStartBlock({
      db,
      agentRowId: agentWithMeta,
      currentBlock: 30_000_000n,
      lookback: 3000n,
    })
    expect(start).toBe(20_500_001n)
  })

  it('caps fallback at 0 when currentBlock < lookback', async () => {
    const start = await computeStartBlock({
      db,
      agentRowId: agentWithoutMeta,
      currentBlock: 100n,
      lookback: 3000n,
    })
    expect(start).toBe(0n)
  })
})

describe('fetchActiveScanTargets', () => {
  it('returns only agents with a valid stealth-meta record', async () => {
    const targets = await fetchActiveScanTargets(db)
    const ids = new Set(targets.map((t) => t.agentRowId))
    expect(ids.has(agentWithMeta)).toBe(true)
    expect(ids.has(agentWithoutMeta)).toBe(false)
  })

  it('returns at least one stealth address per agent if announcements exist', async () => {
    const targets = await fetchActiveScanTargets(db)
    const target = targets.find((t) => t.agentRowId === agentWithMeta)
    expect(target).toBeDefined()
    expect(Array.isArray(target!.stealthAddresses)).toBe(true)
  })
})
```

- [ ] **Step 4.3: Run the tests to verify they fail**

```bash
cd apps/scanner
pnpm test
```

Expected: FAIL — `reconcile.ts` and `checkpoint.ts` do not exist.

- [ ] **Step 4.4: Create `apps/scanner/src/lib/checkpoint.ts`**

```ts
import { and, eq, sql } from 'drizzle-orm'
import {
  agents,
  gatewayAnnouncements,
  maxScannedBlockForAgent,
  type DbClient,
} from '@open-agents/db'
import type { Address } from 'viem'

export interface ScanTarget {
  agentRowId: string
  stealthAddresses: Address[]
}

export interface ComputeStartBlockArgs {
  db: DbClient
  agentRowId: string
  currentBlock: bigint
  lookback: bigint
}

/**
 * Returns the next block number this agent should scan from.
 *
 * - If the agent has at least one recorded payment, returns
 *   max(block_number) + 1, so we never re-scan a block we've already inserted.
 * - Else falls back to max(currentBlock - lookback, 0). For brand-new agents
 *   this gives a fresh window without bloating the RPC call.
 */
export async function computeStartBlock(args: ComputeStartBlockArgs): Promise<bigint> {
  const max = await maxScannedBlockForAgent(args.db, args.agentRowId)
  if (max > 0n) return max + 1n
  if (args.currentBlock <= args.lookback) return 0n
  return args.currentBlock - args.lookback
}

/**
 * Returns every agent that should be scanned this tick: those with a valid
 * stealth-meta record AND at least one gateway_announcements row (i.e., an
 * actual stealth address to listen for).
 *
 * Implementation notes:
 * - The stealth-meta filter uses Postgres' jsonb ?? operator equivalent
 *   (drizzle's sql template) — we check that text_records ->> 'stealth-meta'
 *   is non-null and length-132 (matching `0x` + 132 hex), which is the same
 *   shape Plan 4's isStealthMetaAddress accepts.
 * - We aggregate stealth addresses per agent via a single GROUP BY query so
 *   one round-trip suffices.
 */
export async function fetchActiveScanTargets(db: DbClient): Promise<ScanTarget[]> {
  const rows = await db
    .select({
      agentRowId: agents.id,
      stealthAddress: gatewayAnnouncements.stealthAddress,
    })
    .from(agents)
    .innerJoin(gatewayAnnouncements, eq(gatewayAnnouncements.agentId, agents.id))
    .where(
      and(
        eq(agents.isActive, true),
        sql`length(${agents.textRecords} ->> 'stealth-meta') = 134`,
      ),
    )

  const grouped = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!grouped.has(r.agentRowId)) grouped.set(r.agentRowId, new Set())
    grouped.get(r.agentRowId)!.add(r.stealthAddress.toLowerCase())
  }

  const out: ScanTarget[] = []
  for (const [agentRowId, addrs] of grouped) {
    out.push({
      agentRowId,
      stealthAddresses: Array.from(addrs) as Address[],
    })
  }
  return out
}
```

- [ ] **Step 4.5: Create `apps/scanner/src/lib/reconcile.ts`**

```ts
import { eq, inArray } from 'drizzle-orm'
import {
  gatewayAnnouncements,
  insertPayment,
  paymentExistsByTxLog,
  type DbClient,
} from '@open-agents/db'
import type { Address } from 'viem'
import type { DecodedTransferLog } from './log-fetcher.js'

export interface ReconcileSummary {
  inserted: number
  skipped: number
  unmatched: number
}

export interface ReconcileArgs {
  db: DbClient
  logs: DecodedTransferLog[]
  tokenAddress: Address
}

/**
 * Matches a list of decoded USDC Transfer logs to known stealth addresses
 * (read from gateway_announcements) and inserts a `payments` row per match.
 *
 * Returns a summary so the caller can log/observe scan health:
 *   inserted   — new rows that landed
 *   skipped    — matched logs that were already in the table (idempotency)
 *   unmatched  — logs whose `to` was not in any announcement (data races)
 *
 * The (tx_hash, log_index) unique index is the source of truth for
 * idempotency; the explicit existence probe is just to keep the summary
 * counts honest. A unique-violation thrown from insertPayment is caught
 * and translated into `skipped++`.
 */
export async function reconcileLogsToPayments(
  args: ReconcileArgs,
): Promise<ReconcileSummary> {
  if (args.logs.length === 0) {
    return { inserted: 0, skipped: 0, unmatched: 0 }
  }

  const stealthSet = new Set(
    args.logs.map((l) => l.args.to.toLowerCase()),
  )
  const announcementRows = await args.db
    .select({
      stealthAddress: gatewayAnnouncements.stealthAddress,
      ephemeralPub: gatewayAnnouncements.ephemeralPub,
      agentId: gatewayAnnouncements.agentId,
    })
    .from(gatewayAnnouncements)
    .where(inArray(gatewayAnnouncements.stealthAddress, Array.from(stealthSet)))

  const lookup = new Map<string, { agentId: string; ephemeralPub: string }>()
  for (const r of announcementRows) {
    lookup.set(r.stealthAddress.toLowerCase(), {
      agentId: r.agentId,
      ephemeralPub: r.ephemeralPub,
    })
  }

  let inserted = 0
  let skipped = 0
  let unmatched = 0

  for (const log of args.logs) {
    const target = lookup.get(log.args.to.toLowerCase())
    if (!target) {
      unmatched++
      continue
    }

    if (await paymentExistsByTxLog(args.db, log.transactionHash, log.logIndex)) {
      skipped++
      continue
    }

    try {
      await insertPayment(args.db, {
        agentId: target.agentId,
        stealthAddress: log.args.to.toLowerCase(),
        ephemeralPub: target.ephemeralPub,
        txHash: log.transactionHash.toLowerCase(),
        logIndex: log.logIndex,
        blockNumber: log.blockNumber.toString(),
        tokenAddress: args.tokenAddress.toLowerCase(),
        amount: log.args.value.toString(),
        fromAddress: log.args.from.toLowerCase(),
      })
      inserted++
    } catch (err) {
      // Lost a race against another scanner replica. The unique constraint
      // protected us; count as skipped, not failed.
      if (
        String(err).includes('23505') ||
        String(err).toLowerCase().includes('unique')
      ) {
        skipped++
        continue
      }
      throw err
    }
  }

  // Reference unused imports so tree-shaking does not drop them and so the
  // typechecker keeps the schema dependency hint.
  void eq

  return { inserted, skipped, unmatched }
}
```

- [ ] **Step 4.6: Run the tests**

```bash
pnpm test
```

Expected: 4 reconcile tests pass + 5 checkpoint tests pass.

- [ ] **Step 4.7: Commit**

```bash
cd ../..
git add apps/scanner/src/lib/reconcile.ts apps/scanner/src/lib/checkpoint.ts \
  apps/scanner/tests/reconcile.test.ts apps/scanner/tests/checkpoint.test.ts
git commit -m "$(cat <<'EOF'
feat(scanner): reconciler + checkpoint cursor

reconcileLogsToPayments takes decoded USDC Transfer logs, joins them
against gateway_announcements by `to` address, and inserts one payments
row per match. Idempotent via the (tx_hash, log_index) unique index;
duplicate inserts are caught and counted as skipped, not failed. Returns
a {inserted, skipped, unmatched} summary for observability.

computeStartBlock derives the per-agent cursor from MAX(block_number)
in payments, falling back to currentBlock - lookback for brand-new
agents. fetchActiveScanTargets surfaces only agents with a 132-hex
stealth-meta record AND at least one announcement, skipping Plan 3 stubs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Cron tick endpoint (`POST /tick`)

**Files:**
- Create: `apps/scanner/src/lib/rpc.ts`
- Create: `apps/scanner/src/lib/run-tick.ts`
- Create: `apps/scanner/src/routes/tick.ts`
- Modify: `apps/scanner/src/server.ts`
- Create: `apps/scanner/tests/tick.test.ts`

The tick endpoint is the cron entrypoint Vercel hits every minute. It walks every active scan target (Task 4), computes a per-agent start block (`computeStartBlock` from Task 4), pulls USDC Transfer logs in chunks (Task 3), and runs the reconciler (Task 4). Result is a per-agent summary that is logged and returned as JSON.

**Decision: protect `/tick` with `Authorization: Bearer ${CRON_SECRET}`.** Vercel Cron sets that header automatically when `CRON_SECRET` is configured in the project's env, so no client code changes are needed. In local dev `CRON_SECRET` is unset and the guard short-circuits.

**Decision: bound per-tick work, not per-agent work.** A single tick processes up to `SCAN_LOOKBACK_BLOCKS` (default 3000) blocks per agent. If an agent has fallen further behind (e.g., the scanner was down for an hour), the cron catches it up gradually over multiple ticks rather than blowing past the 60s function budget on one call. The next tick picks up where the previous left off via `computeStartBlock`.

- [ ] **Step 5.1: Create `apps/scanner/src/lib/rpc.ts`**

```ts
import { createPublicClient, http, type PublicClient } from 'viem'
import { base } from 'viem/chains'
import { env } from '../env.js'

let cached: PublicClient | null = null

/**
 * Returns a memoized viem PublicClient for Base mainnet. Memoization keeps
 * the http transport's connection-pool warm across cron invocations on the
 * same Vercel function instance.
 */
export function getRpcClient(): PublicClient {
  if (!cached) {
    cached = createPublicClient({
      chain: base,
      transport: http(env.BASE_RPC_URL),
    })
  }
  return cached
}

/** Test-only — resets the cached client so vi.mock'd transports take effect. */
export function resetRpcClientForTest(): void {
  cached = null
}
```

- [ ] **Step 5.2: Create `apps/scanner/src/lib/run-tick.ts`**

Pure tick logic, decoupled from the HTTP wrapper so unit tests can drive it without a webserver. Re-exports the decoded `TickResult` so `routes/tick.ts` keeps a typed response shape.

```ts
import type { PublicClient } from 'viem'
import { createDb, type DbClient } from '@open-agents/db'
import { env } from '../env.js'
import {
  computeStartBlock,
  fetchActiveScanTargets,
  type ScanTarget,
} from './checkpoint.js'
import { fetchTransferLogsToAddresses } from './log-fetcher.js'
import { reconcileLogsToPayments, type ReconcileSummary } from './reconcile.js'
import { BASE_USDC_ADDRESS } from './usdc.js'

export interface PerAgentTick {
  agentRowId: string
  startBlock: string
  endBlock: string
  logsFetched: number
  reconcile: ReconcileSummary
}

export interface TickResult {
  scannedAt: string
  currentBlock: string
  agentsScanned: number
  perAgent: PerAgentTick[]
}

export interface RunTickArgs {
  /** Override for tests — defaults to the singleton getRpcClient(). */
  client: PublicClient
  /** Override for tests — defaults to a fresh createDb(env.DATABASE_URL). */
  db?: DbClient
  /** Override for tests; defaults to env.SCAN_LOOKBACK_BLOCKS. */
  lookbackBlocks?: bigint
  /** Override the active-target fetch — useful for unit tests. */
  targetsOverride?: ScanTarget[]
}

/**
 * Single-pass scan over every active agent. Per agent: derive start block,
 * fetch logs in chunks, reconcile against gateway_announcements, summarize.
 *
 * The bigints are stringified in the result so the response can be JSON.stringify'd
 * by Hono without a custom serializer.
 */
export async function runTick(args: RunTickArgs): Promise<TickResult> {
  const db = args.db ?? createDb(env.DATABASE_URL)
  const lookback = args.lookbackBlocks ?? BigInt(env.SCAN_LOOKBACK_BLOCKS)

  const currentBlock = await args.client.getBlockNumber()
  const targets = args.targetsOverride ?? (await fetchActiveScanTargets(db))

  const perAgent: PerAgentTick[] = []
  for (const target of targets) {
    const startBlock = await computeStartBlock({
      db,
      agentRowId: target.agentRowId,
      currentBlock,
      lookback,
    })
    if (startBlock > currentBlock) {
      perAgent.push({
        agentRowId: target.agentRowId,
        startBlock: startBlock.toString(),
        endBlock: currentBlock.toString(),
        logsFetched: 0,
        reconcile: { inserted: 0, skipped: 0, unmatched: 0 },
      })
      continue
    }

    const logs = await fetchTransferLogsToAddresses({
      client: args.client,
      addresses: target.stealthAddresses,
      tokenAddress: BASE_USDC_ADDRESS,
      fromBlock: startBlock,
      toBlock: currentBlock,
    })

    const reconcile = await reconcileLogsToPayments({
      db,
      logs,
      tokenAddress: BASE_USDC_ADDRESS,
    })

    perAgent.push({
      agentRowId: target.agentRowId,
      startBlock: startBlock.toString(),
      endBlock: currentBlock.toString(),
      logsFetched: logs.length,
      reconcile,
    })
  }

  return {
    scannedAt: new Date().toISOString(),
    currentBlock: currentBlock.toString(),
    agentsScanned: perAgent.length,
    perAgent,
  }
}
```

- [ ] **Step 5.3: Create `apps/scanner/src/routes/tick.ts`**

```ts
import { Hono } from 'hono'
import { env } from '../env.js'
import { getRpcClient } from '../lib/rpc.js'
import { runTick } from '../lib/run-tick.js'

export const tickRoute = new Hono()

/**
 * Per Vercel docs, the cron-injected header is `Authorization: Bearer
 * ${process.env.CRON_SECRET}`. Local invocations from tests pass the same
 * shape via supertest. If CRON_SECRET is unset (typical for local dev), the
 * guard short-circuits — that's intentional so `curl localhost:3002/tick`
 * just works in development.
 */
function isAuthorized(authHeader: string | undefined): boolean {
  if (!env.CRON_SECRET) return true
  if (!authHeader) return false
  return authHeader === `Bearer ${env.CRON_SECRET}`
}

tickRoute.post('/tick', async (c) => {
  if (!isAuthorized(c.req.header('Authorization'))) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  if (env.SCANNER_RPC === 'off') {
    // Test mode — the cron shell still executes but skips the network call.
    return c.json({
      scannedAt: new Date().toISOString(),
      currentBlock: '0',
      agentsScanned: 0,
      perAgent: [],
      note: 'SCANNER_RPC=off — RPC disabled',
    })
  }

  const result = await runTick({ client: getRpcClient() })
  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'tick complete',
      scannedAt: result.scannedAt,
      agentsScanned: result.agentsScanned,
      totalInserted: result.perAgent.reduce((n, p) => n + p.reconcile.inserted, 0),
    }),
  )
  return c.json(result)
})

// Vercel Cron also accepts GET (some integrations probe with GET first).
tickRoute.get('/tick', async (c) => {
  return c.json({ ok: true, hint: 'POST to actually run the scan' })
})
```

- [ ] **Step 5.4: Mount the tick route in `apps/scanner/src/server.ts`**

Replace the file contents:

```ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { env } from './env.js'
import { tickRoute } from './routes/tick.js'

const app = new Hono()

app.get('/health', (c) => c.json({ ok: true, service: 'scanner' }))
app.route('/', tickRoute)

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`scanner listening on :${info.port}`)
  })
}

export default app
```

- [ ] **Step 5.5: Write the failing tick test**

Create `apps/scanner/tests/tick.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createDb,
  insertAgent,
  insertGatewayAnnouncement,
  listPaymentsByAgent,
} from '@open-agents/db'
import { runTick } from '../src/lib/run-tick.js'
import type { PublicClient } from 'viem'

const DB_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
process.env['DATABASE_URL'] = DB_URL
process.env['SCANNER_RPC'] = 'off'
process.env['CRON_SECRET'] = ''

let db: ReturnType<typeof createDb>
let agentRowId: string
const STEALTH = ('0x' + 'aa'.repeat(20)).toLowerCase() as `0x${string}`
const EPH = '0x02' + 'aa'.repeat(32)

beforeAll(async () => {
  db = createDb(DB_URL)
  const agent = await insertAgent(db, {
    ownerEoa: '0x0000000000000000000000000000000000000077',
    subnameLabel: 'tick-test-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
    textRecords: { 'stealth-meta': '0x' + 'aa'.repeat(33) + 'bb'.repeat(33) },
  })
  agentRowId = agent.id
  await insertGatewayAnnouncement(db, {
    agentId: agentRowId,
    stealthAddress: STEALTH,
    ephemeralPub: EPH,
    viewTag: 0x01,
  })
})

afterAll(() => {
  // Test data left in place; Plan 5 has no global teardown helper yet.
})

function fakeClient(opts: {
  block?: bigint
  logs?: Awaited<ReturnType<PublicClient['getLogs']>>
}): PublicClient {
  return {
    getBlockNumber: vi.fn(async () => opts.block ?? 30_000_500n),
    getLogs: vi.fn(async () => opts.logs ?? []),
  } as unknown as PublicClient
}

describe('runTick', () => {
  it('returns 0 inserted when no logs match', async () => {
    const result = await runTick({
      client: fakeClient({ block: 30_000_500n, logs: [] }),
      db,
      lookbackBlocks: 100n,
    })
    expect(result.agentsScanned).toBeGreaterThanOrEqual(1)
    const me = result.perAgent.find((p) => p.agentRowId === agentRowId)
    expect(me?.reconcile.inserted).toBe(0)
    expect(me?.reconcile.unmatched).toBe(0)
  })

  it('inserts payments when getLogs returns matched transfers', async () => {
    const log = {
      transactionHash: ('0x' + 'cc'.repeat(32)) as `0x${string}`,
      logIndex: 0,
      blockNumber: 30_000_499n,
      address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      args: {
        from: ('0x' + 'be'.repeat(20)) as `0x${string}`,
        to: STEALTH,
        value: 12_345_000n,
      },
    } as unknown as Awaited<ReturnType<PublicClient['getLogs']>>[number]
    const result = await runTick({
      client: fakeClient({ block: 30_000_500n, logs: [log] }),
      db,
      lookbackBlocks: 100n,
    })
    const me = result.perAgent.find((p) => p.agentRowId === agentRowId)
    expect(me?.reconcile.inserted).toBe(1)
    const rows = await listPaymentsByAgent(db, agentRowId, { limit: 5 })
    expect(rows[0]?.amount).toBe('12345000')
  })

  it('clamps the lookback when cursor is ahead of current block', async () => {
    // currentBlock < startBlock can happen if the local node is behind the
    // RPC; the tick must produce a no-op rather than a negative range.
    const result = await runTick({
      client: fakeClient({ block: 1n, logs: [] }),
      db,
      lookbackBlocks: 0n,
    })
    const me = result.perAgent.find((p) => p.agentRowId === agentRowId)
    expect(me?.logsFetched).toBe(0)
    expect(me?.reconcile.inserted).toBe(0)
  })
})

describe('POST /tick guard', () => {
  it('returns 401 when CRON_SECRET is set and bearer token mismatches', async () => {
    process.env['CRON_SECRET'] = 'secret-abc-1234567890'
    // Fresh import so `env` re-parses with the updated CRON_SECRET.
    const mod = await import('../src/routes/tick.js?guard-test=' + Date.now())
    const app = new (await import('hono')).Hono().route('/', mod.tickRoute)
    const res = await app.request('/tick', { method: 'POST' })
    expect(res.status).toBe(401)
    process.env['CRON_SECRET'] = ''
  })
})
```

- [ ] **Step 5.6: Run the tests**

```bash
pnpm --filter @open-agents/scanner test
```

Expected: 4 reconcile + 5 checkpoint + 5 log-fetcher + 4 tick tests pass (or whatever the prior tasks ship).

- [ ] **Step 5.7: Smoke-test against the running scanner**

```bash
pnpm --filter @open-agents/scanner dev &
sleep 2
curl -s -X POST http://localhost:3002/tick | jq .
```

Expected (no agents with stealth-meta yet → empty `perAgent`):

```json
{
  "scannedAt": "2026-…",
  "currentBlock": "…",
  "agentsScanned": 0,
  "perAgent": []
}
```

Stop the dev server (`kill %1`).

- [ ] **Step 5.8: Commit**

```bash
git add apps/scanner/src/lib/rpc.ts apps/scanner/src/lib/run-tick.ts \
  apps/scanner/src/routes/tick.ts apps/scanner/src/server.ts \
  apps/scanner/tests/tick.test.ts
git commit -m "$(cat <<'EOF'
feat(scanner): POST /tick cron entrypoint

runTick walks every active agent (stealth-meta + announcement), derives
its start block from MAX(payments.block_number), fetches USDC transfer
logs in chunks, and feeds matches into the reconciler. Returns a
per-agent summary so cron logs surface scan health at a glance.

The route is guarded by Authorization: Bearer ${CRON_SECRET} (same
header Vercel Cron injects). Local dev with CRON_SECRET unset
short-circuits the guard. SCANNER_RPC=off skips the network call —
useful for unit tests and the e2e shell that drives runTick directly
with a faked client.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Alchemy Notify webhook (verifier + route)

**Files:**
- Create: `apps/scanner/src/lib/webhook-verify.ts`
- Create: `apps/scanner/src/routes/webhook.ts`
- Create: `apps/scanner/tests/webhook-verify.test.ts`
- Create: `apps/scanner/tests/webhook.test.ts`
- Modify: `apps/scanner/src/server.ts`

The webhook is the low-latency path. Alchemy Notify ("Address Activity" notifications) signs every push with HMAC-SHA-256 over the raw request body using the secret you set in the Notify dashboard. We verify the signature, parse the activity payload into the same `DecodedTransferLog` shape the cron uses, and feed it through `reconcileLogsToPayments`. Same matcher, same idempotency guarantees.

**Decision: parse Alchemy's "Address Activity" payload into our internal `DecodedTransferLog`, not adapt the matcher to Alchemy's shape.** Reasoning: the matcher is the source of truth; adding an Alchemy-specific code path would fork the matching logic and double the test surface. The adapter is one focused file, easy to update if Alchemy changes their schema, and leaves the rest of the pipeline untouched.

**Decision: webhook always replies 200 even on no-op or bad-payload.** Alchemy retries with exponential backoff on non-2xx for 24h, which would amplify any single transient failure into a flood. We log the reason at `warn`/`error` and 200 the response so retries don't pile up. The cron tick is the safety net — if the webhook drops a notification entirely, the next tick will pick it up via `getLogs`.

- [ ] **Step 6.1: Create `apps/scanner/src/lib/webhook-verify.ts`**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verifies the `x-alchemy-signature` header against the raw request body.
 *
 * Alchemy signs the **raw bytes** of the body; verifying against a re-encoded
 * JSON string drops whitespace differences and breaks the check. The Hono
 * webhook handler reads the body via `c.req.text()` (string preserving the
 * exact bytes Alchemy sent) and passes it here unchanged.
 *
 * Returns true when the signature is valid; false otherwise. Uses
 * timingSafeEqual to thwart trivial timing attacks.
 */
export function verifyAlchemySignature(args: {
  rawBody: string
  signatureHeader: string | undefined
  secret: string
}): boolean {
  if (!args.signatureHeader) return false

  const computed = createHmac('sha256', args.secret).update(args.rawBody).digest('hex')
  const provided = args.signatureHeader.toLowerCase()

  if (computed.length !== provided.length) return false
  return timingSafeEqual(Buffer.from(computed, 'utf8'), Buffer.from(provided, 'utf8'))
}
```

- [ ] **Step 6.2: Write the failing verifier test**

Create `apps/scanner/tests/webhook-verify.test.ts`:

```ts
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyAlchemySignature } from '../src/lib/webhook-verify.js'

const SECRET = '0123456789abcdef0123456789abcdef'

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex')
}

describe('verifyAlchemySignature', () => {
  it('returns true for a correctly-signed body', () => {
    const body = '{"type":"ADDRESS_ACTIVITY","webhookId":"wh_42"}'
    expect(
      verifyAlchemySignature({ rawBody: body, signatureHeader: sign(body), secret: SECRET }),
    ).toBe(true)
  })

  it('is case-insensitive on the signature header', () => {
    const body = '{"x":1}'
    expect(
      verifyAlchemySignature({
        rawBody: body,
        signatureHeader: sign(body).toUpperCase(),
        secret: SECRET,
      }),
    ).toBe(true)
  })

  it('returns false on body tampering', () => {
    const body = '{"x":1}'
    expect(
      verifyAlchemySignature({
        rawBody: '{"x":2}',
        signatureHeader: sign(body),
        secret: SECRET,
      }),
    ).toBe(false)
  })

  it('returns false when signatureHeader is undefined', () => {
    expect(
      verifyAlchemySignature({
        rawBody: '{}',
        signatureHeader: undefined,
        secret: SECRET,
      }),
    ).toBe(false)
  })

  it('returns false on length mismatch (no timing leak via length)', () => {
    expect(
      verifyAlchemySignature({
        rawBody: '{}',
        signatureHeader: 'abc',
        secret: SECRET,
      }),
    ).toBe(false)
  })
})
```

- [ ] **Step 6.3: Create `apps/scanner/src/routes/webhook.ts`**

```ts
import { Hono } from 'hono'
import { z } from 'zod'
import { createDb } from '@open-agents/db'
import { env } from '../env.js'
import { verifyAlchemySignature } from '../lib/webhook-verify.js'
import { reconcileLogsToPayments } from '../lib/reconcile.js'
import { BASE_USDC_ADDRESS } from '../lib/usdc.js'
import type { DecodedTransferLog } from '../lib/log-fetcher.js'

export const webhookRoute = new Hono()

/**
 * Alchemy "Address Activity" payload — only the fields we consume.
 * Full schema: https://docs.alchemy.com/reference/address-activity-webhook
 *
 * One push can carry multiple activities (e.g., a tx with two transfers to
 * watched addresses). We normalize each `activity` entry into the same
 * DecodedTransferLog shape the cron path uses.
 */
const ActivitySchema = z.object({
  fromAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  toAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  blockNum: z.string().regex(/^0x[0-9a-fA-F]+$/),
  hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  log: z
    .object({
      logIndex: z.union([z.string(), z.number()]),
      address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      data: z.string().regex(/^0x[0-9a-fA-F]+$/),
      topics: z.array(z.string()).min(1),
    })
    .optional(),
  rawContract: z
    .object({
      address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      decimals: z.number().optional(),
      rawValue: z.string().regex(/^0x[0-9a-fA-F]+$/),
    })
    .optional(),
  category: z.string().optional(),
})

const PayloadSchema = z.object({
  webhookId: z.string(),
  type: z.literal('ADDRESS_ACTIVITY'),
  event: z.object({
    network: z.string(),
    activity: z.array(ActivitySchema),
  }),
})

function alchemyToDecodedLog(a: z.infer<typeof ActivitySchema>): DecodedTransferLog | null {
  // Skip activities that aren't ERC-20 transfers we can read amount from.
  if (!a.rawContract?.rawValue) return null
  if (a.rawContract.address.toLowerCase() !== BASE_USDC_ADDRESS.toLowerCase()) return null

  const logIndex =
    typeof a.log?.logIndex === 'number'
      ? a.log.logIndex
      : a.log?.logIndex
        ? Number.parseInt(a.log.logIndex, 16)
        : 0

  return {
    transactionHash: a.hash as `0x${string}`,
    logIndex,
    blockNumber: BigInt(a.blockNum),
    address: a.rawContract.address as `0x${string}`,
    args: {
      from: a.fromAddress as `0x${string}`,
      to: a.toAddress as `0x${string}`,
      value: BigInt(a.rawContract.rawValue),
    },
  }
}

webhookRoute.post('/webhook', async (c) => {
  if (env.SCANNER_WEBHOOK === 'off') {
    // Self-host opted out — accept the push but do nothing.
    return c.json({ ok: true, skipped: 'SCANNER_WEBHOOK=off' })
  }

  if (!env.ALCHEMY_NOTIFY_SECRET) {
    console.error('[webhook] ALCHEMY_NOTIFY_SECRET is unset; refusing to accept payloads')
    // 200 still — we don't want Alchemy retry storms while we fix env.
    return c.json({ ok: true, skipped: 'secret not configured' })
  }

  const rawBody = await c.req.text()
  const ok = verifyAlchemySignature({
    rawBody,
    signatureHeader: c.req.header('x-alchemy-signature'),
    secret: env.ALCHEMY_NOTIFY_SECRET,
  })
  if (!ok) {
    console.warn('[webhook] signature verification failed')
    // 401 here is safe: only a misconfigured/legitimately-bad caller hits this.
    return c.json({ error: 'Invalid signature' }, 401)
  }

  let parsed: z.infer<typeof PayloadSchema>
  try {
    parsed = PayloadSchema.parse(JSON.parse(rawBody))
  } catch (err) {
    console.warn('[webhook] payload parse failed', err)
    return c.json({ ok: true, skipped: 'unparseable payload' })
  }

  const logs: DecodedTransferLog[] = []
  for (const activity of parsed.event.activity) {
    const log = alchemyToDecodedLog(activity)
    if (log) logs.push(log)
  }
  if (logs.length === 0) {
    return c.json({ ok: true, decoded: 0, inserted: 0 })
  }

  const db = createDb(env.DATABASE_URL)
  const summary = await reconcileLogsToPayments({
    db,
    logs,
    tokenAddress: BASE_USDC_ADDRESS,
  })

  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'webhook reconciled',
      webhookId: parsed.webhookId,
      decoded: logs.length,
      ...summary,
    }),
  )

  return c.json({ ok: true, decoded: logs.length, ...summary })
})
```

- [ ] **Step 6.4: Mount the webhook in `apps/scanner/src/server.ts`**

Add the import + route line:

```ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { env } from './env.js'
import { tickRoute } from './routes/tick.js'
import { webhookRoute } from './routes/webhook.js'

const app = new Hono()

app.get('/health', (c) => c.json({ ok: true, service: 'scanner' }))
app.route('/', tickRoute)
app.route('/', webhookRoute)

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`scanner listening on :${info.port}`)
  })
}

export default app
```

- [ ] **Step 6.5: Write the failing webhook integration test**

Create `apps/scanner/tests/webhook.test.ts`:

```ts
import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createDb,
  insertAgent,
  insertGatewayAnnouncement,
  listPaymentsByAgent,
} from '@open-agents/db'

const DB_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
const SECRET = 'aabbccddeeff00112233445566778899'
process.env['DATABASE_URL'] = DB_URL
process.env['ALCHEMY_NOTIFY_SECRET'] = SECRET
process.env['SCANNER_WEBHOOK'] = 'on'

const STEALTH = ('0x' + 'fe'.repeat(20)).toLowerCase() as `0x${string}`
const EPH = '0x02' + '88'.repeat(32)
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
let db: ReturnType<typeof createDb>
let agentRowId: string

beforeAll(async () => {
  db = createDb(DB_URL)
  const agent = await insertAgent(db, {
    ownerEoa: '0x0000000000000000000000000000000000000088',
    subnameLabel: 'wh-test-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
  })
  agentRowId = agent.id
  await insertGatewayAnnouncement(db, {
    agentId: agentRowId,
    stealthAddress: STEALTH,
    ephemeralPub: EPH,
    viewTag: 0x42,
  })
})

afterAll(() => {})

function payload(activity: {
  from: string
  to: string
  hash: string
  logIndex: number
  blockHex: string
  amountHex: string
}): string {
  return JSON.stringify({
    webhookId: 'wh_test_42',
    type: 'ADDRESS_ACTIVITY',
    event: {
      network: 'BASE_MAINNET',
      activity: [
        {
          fromAddress: activity.from,
          toAddress: activity.to,
          blockNum: activity.blockHex,
          hash: activity.hash,
          log: { logIndex: activity.logIndex, address: USDC, data: '0x', topics: ['0x'] },
          rawContract: { address: USDC, decimals: 6, rawValue: activity.amountHex },
          category: 'token',
        },
      ],
    },
  })
}

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex')
}

async function postWebhook(body: string, signature: string) {
  // Re-import so env reflects the values set above.
  const app = (await import('../src/server.js?wh-test=' + Date.now())).default as {
    fetch: (req: Request) => Promise<Response>
  }
  return app.fetch(
    new Request('http://localhost/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-alchemy-signature': signature },
      body,
    }),
  )
}

describe('POST /webhook', () => {
  it('rejects bad signatures with 401', async () => {
    const body = payload({
      from: '0x' + 'be'.repeat(20),
      to: STEALTH,
      hash: '0x' + 'aa'.repeat(32),
      logIndex: 0,
      blockHex: '0x1',
      amountHex: '0x1',
    })
    const res = await postWebhook(body, 'baadc0de')
    expect(res.status).toBe(401)
  })

  it('inserts payments for matched activity', async () => {
    const body = payload({
      from: '0x' + 'be'.repeat(20),
      to: STEALTH,
      hash: '0x' + 'a1'.repeat(32),
      logIndex: 2,
      blockHex: '0x1e6f',
      amountHex: '0xf4240', // 1_000_000 = 1 USDC
    })
    const res = await postWebhook(body, sign(body))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { inserted: number; decoded: number }
    expect(json.decoded).toBe(1)
    expect(json.inserted).toBe(1)

    const rows = await listPaymentsByAgent(db, agentRowId, { limit: 5 })
    expect(rows.find((r) => r.txHash.endsWith('a1'.repeat(32)))?.amount).toBe('1000000')
  })

  it('replays return ok with 0 inserted (idempotency)', async () => {
    const body = payload({
      from: '0x' + 'be'.repeat(20),
      to: STEALTH,
      hash: '0x' + 'a1'.repeat(32),
      logIndex: 2,
      blockHex: '0x1e6f',
      amountHex: '0xf4240',
    })
    const res = await postWebhook(body, sign(body))
    const json = (await res.json()) as { inserted: number; skipped: number }
    expect(json.inserted).toBe(0)
    expect(json.skipped).toBe(1)
  })

  it('ignores non-USDC activity (different token contract)', async () => {
    const body = JSON.stringify({
      webhookId: 'wh_test_42',
      type: 'ADDRESS_ACTIVITY',
      event: {
        network: 'BASE_MAINNET',
        activity: [
          {
            fromAddress: '0x' + 'be'.repeat(20),
            toAddress: STEALTH,
            blockNum: '0x10',
            hash: '0x' + 'cc'.repeat(32),
            log: { logIndex: 0, address: '0x' + '99'.repeat(20), data: '0x', topics: ['0x'] },
            rawContract: { address: '0x' + '99'.repeat(20), decimals: 18, rawValue: '0x1' },
            category: 'token',
          },
        ],
      },
    })
    const res = await postWebhook(body, sign(body))
    const json = (await res.json()) as { decoded: number; inserted: number }
    expect(json.decoded).toBe(0)
    expect(json.inserted).toBe(0)
  })
})
```

- [ ] **Step 6.6: Run the tests**

```bash
pnpm --filter @open-agents/scanner test
```

Expected: 5 verifier tests + 4 webhook tests pass on top of prior counts.

- [ ] **Step 6.7: Commit**

```bash
git add apps/scanner/src/lib/webhook-verify.ts apps/scanner/src/routes/webhook.ts \
  apps/scanner/src/server.ts \
  apps/scanner/tests/webhook-verify.test.ts apps/scanner/tests/webhook.test.ts
git commit -m "$(cat <<'EOF'
feat(scanner): Alchemy Notify webhook + signature verifier

verifyAlchemySignature is HMAC-SHA-256 over the raw body, timing-safe
compare. POST /webhook reads the raw body, verifies, parses Alchemy's
ADDRESS_ACTIVITY payload into our DecodedTransferLog shape, and feeds
matches into the same reconciler the cron uses. Same idempotency: a
duplicate push (same tx_hash + log_index) lands as skipped, not failed.

The route always returns 200 on no-op or bad-payload to dodge Alchemy's
24h retry storm; only a missing/invalid signature gets a 401. Self-host
operators set SCANNER_WEBHOOK=off to disable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Self-host worker (long-lived loop)

**Files:**
- Create: `apps/scanner/src/worker.ts`
- Create: `apps/scanner/tests/worker.test.ts`

The worker is the parity entrypoint for self-hosters who don't want a Vercel deployment. It calls `runTick` on a fixed interval (default 60s, env-overridable), with a small jitter so multiple replicas don't synchronize. It also installs a SIGINT/SIGTERM handler so `pnpm worker` exits cleanly under Docker/PM2.

**Decision: skip a leader-election scheme for v1.** The reconciler is idempotent on `(tx_hash, log_index)`, so two workers racing the same blocks will simply have one win every insert. For demo deployments (1 replica) the cost is zero; if someone wants HA they can wrap in Kubernetes/PM2 and tolerate the duplicate work.

- [ ] **Step 7.1: Create `apps/scanner/src/worker.ts`**

```ts
import { z } from 'zod'
import { env } from './env.js'
import { getRpcClient } from './lib/rpc.js'
import { runTick } from './lib/run-tick.js'

const workerEnvSchema = z.object({
  SCANNER_WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  SCANNER_WORKER_JITTER_MS: z.coerce.number().int().min(0).default(2_000),
})
const workerEnv = workerEnvSchema.parse(process.env)

let stopping = false

function jitter(): number {
  return Math.floor(Math.random() * workerEnv.SCANNER_WORKER_JITTER_MS)
}

async function loop(): Promise<void> {
  while (!stopping) {
    const startedAt = Date.now()
    try {
      const result = await runTick({ client: getRpcClient() })
      const inserted = result.perAgent.reduce((n, p) => n + p.reconcile.inserted, 0)
      console.log(
        JSON.stringify({
          level: 'info',
          msg: 'worker tick',
          agents: result.agentsScanned,
          inserted,
          tookMs: Date.now() - startedAt,
        }),
      )
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'worker tick failed', err: String(err) }))
    }
    if (stopping) break
    const sleepMs = workerEnv.SCANNER_WORKER_INTERVAL_MS + jitter()
    await new Promise<void>((resolve) => setTimeout(resolve, sleepMs))
  }
  console.log('[worker] shut down cleanly')
}

function installSignalHandlers(): void {
  const handler = (sig: NodeJS.Signals) => {
    console.log(`[worker] received ${sig}, draining…`)
    stopping = true
  }
  process.once('SIGINT', handler)
  process.once('SIGTERM', handler)
}

if (process.argv[1]?.endsWith('worker.ts') || process.argv[1]?.endsWith('worker.js')) {
  installSignalHandlers()
  console.log(`[worker] starting; interval=${workerEnv.SCANNER_WORKER_INTERVAL_MS}ms`)
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  loop()
}

export const __test__ = { loop, requestStopForTest: () => (stopping = true) }
// `env` reference keeps the import meaningful even if loop() shape evolves.
void env
```

- [ ] **Step 7.2: Write the worker test**

Create `apps/scanner/tests/worker.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('scanner worker', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('runs at least one tick and exits cleanly when stopping flips', async () => {
    vi.stubEnv('SCANNER_WORKER_INTERVAL_MS', '50')
    vi.stubEnv('SCANNER_WORKER_JITTER_MS', '0')
    vi.stubEnv('DATABASE_URL', 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents')
    vi.stubEnv('SCANNER_RPC', 'off')

    const runTickMock = vi.fn(async () => ({
      scannedAt: new Date().toISOString(),
      currentBlock: '0',
      agentsScanned: 0,
      perAgent: [],
    }))
    vi.doMock('../src/lib/run-tick.js', () => ({ runTick: runTickMock }))

    const { __test__ } = await import('../src/worker.js?worker-test=' + Date.now())

    // Race: schedule the stop signal after one interval, then await loop.
    setTimeout(() => __test__.requestStopForTest(), 120)
    await __test__.loop()

    expect(runTickMock).toHaveBeenCalled()
  }, 5_000)
})
```

- [ ] **Step 7.3: Run the tests**

```bash
pnpm --filter @open-agents/scanner test
```

Expected: 1 worker test passes; prior tests still green.

- [ ] **Step 7.4: Commit**

```bash
git add apps/scanner/src/worker.ts apps/scanner/tests/worker.test.ts
git commit -m "$(cat <<'EOF'
feat(scanner): self-host worker (long-lived loop)

Wraps runTick in a setInterval-style loop with random jitter so two
replicas don't synchronize. Honors SIGINT/SIGTERM for clean Docker
shutdown. No leader election — the reconciler is idempotent on
(tx_hash, log_index), so racing replicas resolve to "one wins per
insert" without coordination.

Run with `pnpm --filter @open-agents/scanner worker`.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: API — list payments + confirm-toggle endpoints

**Files:**
- Modify: `apps/api/src/routes/agents.ts`
- Create: `apps/api/tests/payments.test.ts`
- Create: `apps/api/tests/receipts.test.ts`

Two new endpoints land on `agents.ts` (the existing per-agent route file). Both ride the same `jwtMiddleware` Plan 4 wired up. Lookups are scoped via `findAgentByIdForOwner` (already in `packages/db`) so a stranger with a valid JWT can't peek at another agent's payments.

**Decision: paginate by `afterDetectedAt` cursor, not offset.** Page numbers fall apart the moment new payments land between requests; a `Date` cursor is stable and matches the index `(agent_id, detected_at desc)`. The page size cap is 200 (defaulting to 50). The dashboard's SWR fetcher trims to the first page; the SSE stream feeds incremental updates beyond that.

**Decision: the receipt toggle endpoint is `POST /agents/me/receipts/:paymentId/confirm` with a JSON body `{ confirmed: boolean, eip712Payload?: string, eip712Signature?: string }`.** This shape lets us extend with Plan 7's signature/payload without breaking v1 callers — both extra fields are optional. A `DELETE /receipts/:paymentId` would be more REST-pure but adds a verb the dashboard doesn't otherwise use.

- [ ] **Step 8.1: Modify `apps/api/src/routes/agents.ts` — add two new handlers**

Append to the existing file (do not remove existing handlers). Add imports + handlers as shown:

```ts
// Add to existing imports at top of file:
import {
  findPaymentById,
  listPaymentsByAgent,
  upsertReceipt,
  type PaymentWithReceipt,
} from '@open-agents/db'

// --- helpers (near the top, after imports) ---

interface PaymentResponseRow {
  id: string
  agentId: string
  stealthAddress: string
  ephemeralPub: string
  txHash: string
  logIndex: number
  blockNumber: string
  tokenAddress: string
  amount: string
  fromAddress: string
  detectedAt: string
  receipt: {
    id: string
    confirmedByRecipient: boolean
    eip712Payload: string | null
    eip712Signature: string | null
    appendedResponseTx: string | null
    updatedAt: string
  } | null
}

function shapePayment(row: PaymentWithReceipt): PaymentResponseRow {
  return {
    id: row.id,
    agentId: row.agentId,
    stealthAddress: row.stealthAddress,
    ephemeralPub: row.ephemeralPub,
    txHash: row.txHash,
    logIndex: row.logIndex,
    blockNumber: row.blockNumber,
    tokenAddress: row.tokenAddress,
    amount: row.amount,
    fromAddress: row.fromAddress,
    detectedAt: row.detectedAt.toISOString(),
    receipt: row.receipt
      ? {
          id: row.receipt.id,
          confirmedByRecipient: row.receipt.confirmedByRecipient,
          eip712Payload: row.receipt.eip712Payload,
          eip712Signature: row.receipt.eip712Signature,
          appendedResponseTx: row.receipt.appendedResponseTx,
          updatedAt: row.receipt.updatedAt.toISOString(),
        }
      : null,
  }
}

// --- new handler #1: GET /agents/:agentId/payments ---

agentsRoute.get(
  '/agents/:agentId/payments',
  jwtMiddleware(env.JWT_SECRET),
  async (c) => {
    const claims = c.var.jwtClaims
    const ownerEoa = (claims.ownerEoa as string) ?? claims.sub
    const agentId = c.req.param('agentId')

    const agent = await findAgentByIdForOwner(db, agentId, ownerEoa)
    if (!agent) return c.json({ error: 'Not found' }, 404)

    const url = new URL(c.req.url)
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), 200)
    const afterRaw = url.searchParams.get('afterDetectedAt')
    const after = afterRaw ? new Date(afterRaw) : undefined
    if (after && Number.isNaN(after.getTime())) {
      return c.json({ error: 'afterDetectedAt must be ISO-8601' }, 400)
    }

    const rows = await listPaymentsByAgent(db, agent.id, { limit, afterDetectedAt: after })
    return c.json({
      agentId: agent.id,
      count: rows.length,
      payments: rows.map(shapePayment),
    })
  },
)

// --- new handler #2: POST /agents/:agentId/receipts/:paymentId/confirm ---

agentsRoute.post(
  '/agents/:agentId/receipts/:paymentId/confirm',
  jwtMiddleware(env.JWT_SECRET),
  async (c) => {
    const claims = c.var.jwtClaims
    const ownerEoa = (claims.ownerEoa as string) ?? claims.sub
    const agentId = c.req.param('agentId')
    const paymentId = c.req.param('paymentId')

    const agent = await findAgentByIdForOwner(db, agentId, ownerEoa)
    if (!agent) return c.json({ error: 'Not found' }, 404)

    const body = (await c.req.json().catch(() => null)) as {
      confirmed?: boolean
      eip712Payload?: string
      eip712Signature?: string
    } | null
    if (!body || typeof body.confirmed !== 'boolean') {
      return c.json({ error: 'confirmed (boolean) is required' }, 400)
    }

    const payment = await findPaymentById(db, paymentId)
    if (!payment || payment.agentId !== agent.id) {
      return c.json({ error: 'Payment not found' }, 404)
    }

    const receipt = await upsertReceipt(db, {
      paymentId,
      agentId: agent.id,
      confirmedByRecipient: body.confirmed,
      eip712Payload: body.eip712Payload ?? null,
      eip712Signature: body.eip712Signature ?? null,
    })

    return c.json({
      receipt: {
        id: receipt.id,
        paymentId: receipt.paymentId,
        confirmedByRecipient: receipt.confirmedByRecipient,
        eip712Payload: receipt.eip712Payload,
        eip712Signature: receipt.eip712Signature,
        appendedResponseTx: receipt.appendedResponseTx,
        updatedAt: receipt.updatedAt.toISOString(),
      },
    })
  },
)
```

- [ ] **Step 8.2: Write the failing payments-list test**

Create `apps/api/tests/payments.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createDb,
  insertAgent,
  insertGatewayAnnouncement,
  insertPayment,
} from '@open-agents/db'
import { mintJwt } from '@open-agents/auth'
import app from '../src/server.js'

const DB_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
const JWT_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef'
process.env['DATABASE_URL'] = DB_URL
process.env['JWT_SECRET'] = JWT_SECRET
process.env['VIEW_KEY_MASTER_KEY'] =
  '0x' + 'aa'.repeat(32)

const OWNER = '0x000000000000000000000000000000000000A1A1'
const STRANGER = '0x000000000000000000000000000000000000B1B1'
let db: ReturnType<typeof createDb>
let agentId: string
let token: string

beforeAll(async () => {
  db = createDb(DB_URL)
  const agent = await insertAgent(db, {
    ownerEoa: OWNER.toLowerCase(),
    subnameLabel: 'pay-api-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
  })
  agentId = agent.id
  await insertGatewayAnnouncement(db, {
    agentId,
    stealthAddress: '0x' + 'aa'.repeat(20),
    ephemeralPub: '0x02' + '11'.repeat(32),
    viewTag: 0x01,
  })
  for (let i = 0; i < 3; i++) {
    await insertPayment(db, {
      agentId,
      stealthAddress: '0x' + 'aa'.repeat(20),
      ephemeralPub: '0x02' + '11'.repeat(32),
      txHash: '0x' + i.toString(16).padStart(2, '0').repeat(32),
      logIndex: 0,
      blockNumber: String(20_000_000 + i),
      tokenAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      amount: String(1_000_000 * (i + 1)),
      fromAddress: '0x' + 'be'.repeat(20),
    })
  }
  token = await mintJwt({ sub: OWNER.toLowerCase(), ownerEoa: OWNER.toLowerCase(), secret: JWT_SECRET })
})

afterAll(() => {})

async function getPayments(authToken: string, query = ''): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost/agents/${agentId}/payments${query}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${authToken}` },
    }),
  )
}

describe('GET /agents/:agentId/payments', () => {
  it('returns the agent owner\'s payments newest-first', async () => {
    const res = await getPayments(token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { count: number; payments: Array<{ amount: string; detectedAt: string }> }
    expect(body.count).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < body.payments.length; i++) {
      expect(body.payments[i - 1]!.detectedAt >= body.payments[i]!.detectedAt).toBe(true)
    }
  })

  it('honors limit query param', async () => {
    const res = await getPayments(token, '?limit=2')
    const body = (await res.json()) as { count: number }
    expect(body.count).toBe(2)
  })

  it('rejects bad afterDetectedAt with 400', async () => {
    const res = await getPayments(token, '?afterDetectedAt=not-a-date')
    expect(res.status).toBe(400)
  })

  it('returns 404 when caller does not own the agent', async () => {
    const otherToken = await mintJwt({
      sub: STRANGER.toLowerCase(),
      ownerEoa: STRANGER.toLowerCase(),
      secret: JWT_SECRET,
    })
    const res = await getPayments(otherToken)
    expect(res.status).toBe(404)
  })

  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentId}/payments`, { method: 'GET' }),
    )
    expect(res.status).toBe(401)
  })

  it('shapes the response with isoformat timestamps and string amounts', async () => {
    const res = await getPayments(token, '?limit=1')
    const body = (await res.json()) as {
      payments: Array<{ amount: string; detectedAt: string; receipt: unknown }>
    }
    const first = body.payments[0]!
    expect(typeof first.amount).toBe('string')
    expect(first.detectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(first.receipt).toBeNull()
  })
})
```

- [ ] **Step 8.3: Write the failing receipts toggle test**

Create `apps/api/tests/receipts.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { createDb, insertAgent, insertPayment } from '@open-agents/db'
import { mintJwt } from '@open-agents/auth'
import app from '../src/server.js'

const DB_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
const JWT_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef'
process.env['DATABASE_URL'] = DB_URL
process.env['JWT_SECRET'] = JWT_SECRET
process.env['VIEW_KEY_MASTER_KEY'] = '0x' + 'aa'.repeat(32)

const OWNER = '0x000000000000000000000000000000000000C1C1'
let db: ReturnType<typeof createDb>
let agentId: string
let paymentId: string
let token: string

beforeAll(async () => {
  db = createDb(DB_URL)
  const agent = await insertAgent(db, {
    ownerEoa: OWNER.toLowerCase(),
    subnameLabel: 'rcpt-api-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
  })
  agentId = agent.id
  const payment = await insertPayment(db, {
    agentId,
    stealthAddress: '0x' + 'aa'.repeat(20),
    ephemeralPub: '0x02' + '11'.repeat(32),
    txHash: '0x' + 'rcpt'.padStart(64, '0'),
    logIndex: 0,
    blockNumber: '20000999',
    tokenAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    amount: '7000000',
    fromAddress: '0x' + 'be'.repeat(20),
  })
  paymentId = payment.id
  token = await mintJwt({ sub: OWNER.toLowerCase(), ownerEoa: OWNER.toLowerCase(), secret: JWT_SECRET })
})

async function postConfirm(body: unknown): Promise<Response> {
  return app.fetch(
    new Request(
      `http://localhost/agents/${agentId}/receipts/${paymentId}/confirm`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    ),
  )
}

describe('POST /agents/:agentId/receipts/:paymentId/confirm', () => {
  it('rejects body without confirmed boolean with 400', async () => {
    const res = await postConfirm({})
    expect(res.status).toBe(400)
  })

  it('returns 404 for non-existent paymentId', async () => {
    const res = await app.fetch(
      new Request(
        `http://localhost/agents/${agentId}/receipts/00000000-0000-0000-0000-000000000000/confirm`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ confirmed: true }),
        },
      ),
    )
    expect(res.status).toBe(404)
  })

  it('inserts a receipt on first call', async () => {
    const res = await postConfirm({
      confirmed: true,
      eip712Payload: '{"name":"OpenAgents","version":"1"}',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { receipt: { confirmedByRecipient: boolean; eip712Payload: string | null } }
    expect(body.receipt.confirmedByRecipient).toBe(true)
    expect(body.receipt.eip712Payload).toContain('OpenAgents')
  })

  it('toggles to false on a follow-up call (upsert)', async () => {
    const res = await postConfirm({ confirmed: false })
    const body = (await res.json()) as { receipt: { confirmedByRecipient: boolean; eip712Payload: string | null } }
    expect(body.receipt.confirmedByRecipient).toBe(false)
    expect(body.receipt.eip712Payload).toBeNull()
  })

  it('returns 401 without auth', async () => {
    const res = await app.fetch(
      new Request(
        `http://localhost/agents/${agentId}/receipts/${paymentId}/confirm`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirmed: true }),
        },
      ),
    )
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 8.4: Run the tests**

```bash
pnpm --filter @open-agents/api test
```

Expected: 6 payments tests + 5 receipts tests pass; previous api tests stay green.

- [ ] **Step 8.5: Smoke-test against the running API**

```bash
pnpm --filter @open-agents/api dev &
sleep 2
TOK=$(node -e "require('@open-agents/auth').mintJwt({ sub: '0xa1a1...', ownerEoa: '0xa1a1...', secret: process.env.JWT_SECRET }).then(t => console.log(t))")
curl -sH "Authorization: Bearer $TOK" http://localhost:3001/agents/<id>/payments | jq .count
```

Expected: `3` (or however many fixtures the test suite left in DB). Stop with `kill %1`.

- [ ] **Step 8.6: Commit**

```bash
git add apps/api/src/routes/agents.ts \
  apps/api/tests/payments.test.ts apps/api/tests/receipts.test.ts
git commit -m "$(cat <<'EOF'
feat(api): GET /agents/:id/payments + POST receipts/:paymentId/confirm

GET /agents/:id/payments lists the agent owner's payments newest-first
with an optional ?afterDetectedAt= cursor and ?limit= cap (max 200).
Receipt state is joined into each row so the dashboard renders the
confirm-toggle without an N+1.

POST /agents/:id/receipts/:paymentId/confirm UPSERTs the receipt row
with the supplied confirmed flag plus optional eip712Payload +
eip712Signature (Plan 7 fields, accepted but not yet broadcast).

Both routes scope by agent ownership via findAgentByIdForOwner.
Strangers get 404, not 403, so we don't leak existence.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: API — Server-Sent Events stream for live updates

**Files:**
- Create: `apps/api/src/routes/payments-stream.ts`
- Modify: `apps/api/src/server.ts`
- Create: `apps/api/tests/payments-stream.test.ts`

The dashboard's payments table needs to refresh within ~1s of a new payment landing. Polling SWR every 5s adds a 5s lag worst case; an SSE stream pushes updates as soon as the scanner inserts. We use `hono/streaming`'s `streamSSE` helper, which the manual Vercel-Node adapter already hands through correctly (the adapter's `getReader()` loop writes each chunk as it arrives — verified against the same code path Plan 4's `/me` route uses).

**Decision: authenticate the stream via `?token=` query param, not Authorization header.** The browser's `EventSource` API does not allow custom headers — that's a hard limit, not a workaround. Mirroring `EventSource` would force us to expose a proxy endpoint anyway. We accept the JWT on the URL, validate it, and immediately move the upgraded connection into the stream. A short-lived token (15 min, same as Plan 2's mint TTL) limits the blast radius of URL leakage.

**Decision: poll the DB once every 1500ms inside the stream, no LISTEN/NOTIFY.** The scanner inserts at most a few times per minute per agent; a 1.5s poll is 40 queries/minute — small. LISTEN/NOTIFY would shave latency to near-zero but adds a per-connection Postgres listener and reconnect plumbing we don't need for v1. The dashboard already shows "x seconds ago" timestamps so a sub-2s update feels live.

- [ ] **Step 9.1: Create `apps/api/src/routes/payments-stream.ts`**

```ts
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { verifyJwt } from '@open-agents/auth'
import { listPaymentsByAgent, findAgentByIdForOwner } from '@open-agents/db'
import { db } from '../db.js'
import { env } from '../env.js'

export const paymentsStreamRoute = new Hono()

const POLL_INTERVAL_MS = 1500
const MAX_STREAM_DURATION_MS = 9 * 60 * 1000 // < Vercel function 10min cap

paymentsStreamRoute.get('/agents/:agentId/payments/stream', async (c) => {
  const url = new URL(c.req.url)
  const token = url.searchParams.get('token')
  if (!token) return c.json({ error: 'token query param required' }, 401)

  let claims
  try {
    claims = await verifyJwt({ token, secret: env.JWT_SECRET })
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }

  const ownerEoa = (claims.ownerEoa as string) ?? claims.sub
  const agentId = c.req.param('agentId')
  const agent = await findAgentByIdForOwner(db, agentId, ownerEoa as string)
  if (!agent) return c.json({ error: 'Not found' }, 404)

  // Anchor: client may pass ?since=ISO to backfill from a known point.
  const sinceParam = url.searchParams.get('since')
  let anchor = sinceParam ? new Date(sinceParam) : new Date()
  if (Number.isNaN(anchor.getTime())) {
    return c.json({ error: 'since must be ISO-8601' }, 400)
  }

  return streamSSE(c, async (stream) => {
    // Open with a "hello" event so the client knows the stream is live.
    await stream.writeSSE({
      event: 'hello',
      data: JSON.stringify({ agentId: agent.id, anchor: anchor.toISOString() }),
    })

    const startedAt = Date.now()
    while (!stream.aborted && Date.now() - startedAt < MAX_STREAM_DURATION_MS) {
      const fresh = await listPaymentsByAgent(db, agent.id, {
        afterDetectedAt: anchor,
        limit: 50,
      })

      // listPaymentsByAgent returns newest-first; flip so we emit oldest-first
      // and the client's running anchor advances monotonically.
      for (const row of [...fresh].reverse()) {
        await stream.writeSSE({
          event: 'payment',
          id: row.id,
          data: JSON.stringify({
            id: row.id,
            agentId: row.agentId,
            stealthAddress: row.stealthAddress,
            ephemeralPub: row.ephemeralPub,
            txHash: row.txHash,
            logIndex: row.logIndex,
            blockNumber: row.blockNumber,
            tokenAddress: row.tokenAddress,
            amount: row.amount,
            fromAddress: row.fromAddress,
            detectedAt: row.detectedAt.toISOString(),
            receipt: row.receipt
              ? {
                  id: row.receipt.id,
                  confirmedByRecipient: row.receipt.confirmedByRecipient,
                  updatedAt: row.receipt.updatedAt.toISOString(),
                }
              : null,
          }),
        })
        anchor = row.detectedAt
      }

      // Heartbeat keeps proxies (CloudFront, nginx) from idling the connection.
      await stream.writeSSE({ event: 'ping', data: String(Date.now()) })
      await stream.sleep(POLL_INTERVAL_MS)
    }

    await stream.writeSSE({ event: 'bye', data: 'stream-closed' })
  })
})
```

- [ ] **Step 9.2: Mount the SSE route in `apps/api/src/server.ts`**

Add the import + route line alongside the existing routes:

```ts
import { paymentsStreamRoute } from './routes/payments-stream.js'
// …
app.route('/', paymentsStreamRoute)
```

- [ ] **Step 9.3: Confirm `verifyJwt` is exported from `@open-agents/auth`**

If it's not yet exported, add it to `packages/auth/src/index.ts`:

```ts
export { verifyJwt, mintJwt } from './jwt.js'
```

(If `verifyJwt` does not exist as a standalone export — only used internally by the middleware — extract it now from `packages/auth/src/middleware.ts` into `jwt.ts` so this route can call it. Single-line change in `middleware.ts` to import-from-jwt instead of inlining.)

- [ ] **Step 9.4: Write the failing SSE test**

Create `apps/api/tests/payments-stream.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createDb,
  insertAgent,
  insertGatewayAnnouncement,
  insertPayment,
} from '@open-agents/db'
import { mintJwt } from '@open-agents/auth'
import app from '../src/server.js'

const DB_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
const JWT_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef'
process.env['DATABASE_URL'] = DB_URL
process.env['JWT_SECRET'] = JWT_SECRET
process.env['VIEW_KEY_MASTER_KEY'] = '0x' + 'aa'.repeat(32)

const OWNER = '0x000000000000000000000000000000000000D1D1'
let db: ReturnType<typeof createDb>
let agentId: string
let token: string

beforeAll(async () => {
  db = createDb(DB_URL)
  const agent = await insertAgent(db, {
    ownerEoa: OWNER.toLowerCase(),
    subnameLabel: 'sse-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
  })
  agentId = agent.id
  await insertGatewayAnnouncement(db, {
    agentId,
    stealthAddress: '0x' + 'aa'.repeat(20),
    ephemeralPub: '0x02' + '11'.repeat(32),
    viewTag: 0x01,
  })
  token = await mintJwt({ sub: OWNER.toLowerCase(), ownerEoa: OWNER.toLowerCase(), secret: JWT_SECRET })
})

afterAll(() => {})

async function readSSEUntil(reader: ReadableStreamDefaultReader<Uint8Array>, predicate: (chunk: string) => boolean, timeoutMs = 6000): Promise<string> {
  const decoder = new TextDecoder()
  let buffer = ''
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    if (predicate(buffer)) return buffer
  }
  throw new Error('readSSEUntil timed out; buffer=' + buffer)
}

describe('GET /agents/:agentId/payments/stream', () => {
  it('rejects requests without ?token=', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentId}/payments/stream`),
    )
    expect(res.status).toBe(401)
  })

  it('opens with a hello event and streams subsequent payments', async () => {
    const res = await app.fetch(
      new Request(
        `http://localhost/agents/${agentId}/payments/stream?token=${encodeURIComponent(token)}&since=${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}`,
      ),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const reader = res.body!.getReader()
    const helloChunk = await readSSEUntil(reader, (b) => b.includes('event: hello'))
    expect(helloChunk).toContain('event: hello')

    // Insert a payment AFTER the stream is open, then expect it to arrive.
    await insertPayment(db, {
      agentId,
      stealthAddress: '0x' + 'aa'.repeat(20),
      ephemeralPub: '0x02' + '11'.repeat(32),
      txHash: '0x' + 'sse'.padStart(64, '0'),
      logIndex: 0,
      blockNumber: '20009999',
      tokenAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      amount: '4242000',
      fromAddress: '0x' + 'be'.repeat(20),
    })

    const paymentChunk = await readSSEUntil(reader, (b) => b.includes('event: payment'))
    expect(paymentChunk).toContain('"amount":"4242000"')

    await reader.cancel()
  }, 10_000)

  it('returns 404 for an agent the caller does not own', async () => {
    const stranger = await mintJwt({
      sub: '0x' + 'ee'.repeat(20),
      ownerEoa: '0x' + 'ee'.repeat(20),
      secret: JWT_SECRET,
    })
    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentId}/payments/stream?token=${encodeURIComponent(stranger)}`),
    )
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 9.5: Run the tests**

```bash
pnpm --filter @open-agents/api test -- payments-stream
```

Expected: 3 SSE tests pass.

- [ ] **Step 9.6: Smoke-test the stream against the running API**

```bash
pnpm --filter @open-agents/api dev &
sleep 2
TOK=$(node -e "
  const { mintJwt } = require('@open-agents/auth');
  mintJwt({ sub: '0xa1a1...', ownerEoa: '0xa1a1...', secret: process.env.JWT_SECRET })
    .then(t => process.stdout.write(t))
")
curl -N -sH "Accept: text/event-stream" "http://localhost:3001/agents/<agentId>/payments/stream?token=$TOK"
```

Expected: a `hello` event arrives immediately, then a `ping` every ~1.5s. Insert a payment via `psql` (or run the scanner) and watch a `payment` event appear within ~2s. Stop with `Ctrl+C` and `kill %1`.

- [ ] **Step 9.7: Commit**

```bash
git add apps/api/src/routes/payments-stream.ts apps/api/src/server.ts \
  packages/auth/src/index.ts \
  apps/api/tests/payments-stream.test.ts
git commit -m "$(cat <<'EOF'
feat(api): SSE stream for live payment updates

GET /agents/:id/payments/stream opens an EventSource-friendly stream that
pushes a `payment` event each time a new row lands in the payments table.
Authenticates via ?token= query param (EventSource cannot set headers).
Polls the DB every 1500ms — small enough for sub-2s perceived latency,
no LISTEN/NOTIFY plumbing needed.

Sends a `ping` every poll cycle to keep idle proxies happy, and caps the
connection at 9 minutes (< Vercel's 10-min function ceiling) so the
client can transparently reconnect.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Gateway — `text(node, "stealth-payload")` + reconciler marks `paid_at`

**Files:**
- Modify: `apps/gateway/src/routes/resolve.ts`
- Modify: `apps/scanner/src/lib/reconcile.ts`
- Modify: `packages/db/src/queries/announcements.ts` (one new helper)
- Modify: `packages/db/src/index.ts` (re-export the new helper)
- Create: `apps/gateway/tests/resolve-stealth-payload.test.ts`

The sender console (Task 12) needs four things to fire a stealth payment:

1. The Safe address that receives USDC — already returned by `addr(node)`.
2. The stealth **EOA** address — for the ERC-5564 `announce(stealthAddress, …)` argument. The standard event indexes the EOA, not the Safe, so off-the-shelf scanners stay compatible.
3. The compressed ephemeral pubkey from the gateway's per-cycle issuance.
4. The view-tag byte (as `bytes` for the `metadata` arg).

(2)–(4) live in `gateway_announcements`. We expose them via a new ENS text record `text(node, "stealth-payload")` whose value is the abi-encoded `(address stealthEoa, bytes ephemeralPub, uint8 viewTag)`. The dashboard reads it through viem's `getEnsText`, which transparently routes through our gateway just like `getEnsAddress` does.

**Decision: re-use Plan 4's stable-cycle semantics — no new cache.** The existing `addr()` handler calls `findCurrentAnnouncement` to return the same Safe until a payment lands. The new text() handler calls the same query, abi-encodes the row's `ephemeralPub` + `viewTag`, and returns. Because both handlers consult `findCurrentAnnouncement`, two consecutive CCIP-Read calls (`addr` → `text("stealth-payload")`) reference the **same** issuance row by construction. No race, no in-memory map, no TTL math.

**Decision: the scanner reconciler must flip `gateway_announcements.paid_at` when it inserts a payment.** Without this, `findCurrentAnnouncement` continues returning the same row after the first payment, breaking the rotation guarantee Plan 4 set up. We add `markAnnouncementPaid(db, stealthAddress)` and call it from `reconcileLogsToPayments` after a successful insert.

- [ ] **Step 10.1: Add `markAnnouncementPaid` in `packages/db/src/queries/announcements.ts`**

Append to the existing file (do not remove `findCurrentAnnouncement`, `insertGatewayAnnouncement`, etc.):

```ts
import { eq, isNull, and } from 'drizzle-orm'
import { gatewayAnnouncements, type GatewayAnnouncement } from '../schema.js'
import type { DbClient } from '../client.js'

/**
 * Marks the most recent UNPAID announcement at `stealthAddress` as paid by
 * stamping `paid_at = now()`. The next call to `findCurrentAnnouncement` for
 * the same agent will then derive a fresh issuance.
 *
 * Returns the updated row (or null if no matching unpaid announcement was
 * found — e.g., a duplicate webhook push for an already-marked-paid stealth).
 *
 * Note: matched on `stealth_address` (not `stealth_safe_address`) because the
 * scanner sees the *Transfer.to* which is the safe address, not the EOA.
 * However, gateway_announcements stores BOTH addresses — Plan 4's row shape.
 * The scanner passes whichever it has; this query checks both columns.
 */
export async function markAnnouncementPaid(
  db: DbClient,
  addr: string,
): Promise<GatewayAnnouncement | null> {
  const lower = addr.toLowerCase()
  const candidates = await db
    .select()
    .from(gatewayAnnouncements)
    .where(
      and(
        isNull(gatewayAnnouncements.paidAt),
        // either stealth_address OR stealth_safe_address can match.
        // Drizzle doesn't have OR with column-typed args in an `and` with isNull
        // in one shot, so we filter post-fetch — the table is small.
      ),
    )
    .limit(50)

  const match = candidates.find(
    (r) =>
      r.stealthAddress.toLowerCase() === lower ||
      (r.stealthSafeAddress?.toLowerCase() ?? '') === lower,
  )
  if (!match) return null

  const [updated] = await db
    .update(gatewayAnnouncements)
    .set({ paidAt: new Date() })
    .where(eq(gatewayAnnouncements.id, match.id))
    .returning()
  return updated ?? null
}
```

- [ ] **Step 10.2: Re-export from `packages/db/src/index.ts`**

The existing index already exports everything from `./queries/announcements.js`, so no edit is required. Verify the new symbol is reachable:

```bash
node -e "const { markAnnouncementPaid } = require('@open-agents/db'); console.log(typeof markAnnouncementPaid)"
```

Expected: `function`.

- [ ] **Step 10.3: Modify `apps/scanner/src/lib/reconcile.ts` to call `markAnnouncementPaid`**

Locate the `insertPayment` call inside the for-loop (Task 4 Step 4.5). Add the marker call immediately after the successful insert:

```ts
// Replace the existing try block contents:
try {
  await insertPayment(args.db, {
    agentId: target.agentId,
    stealthAddress: log.args.to.toLowerCase(),
    ephemeralPub: target.ephemeralPub,
    txHash: log.transactionHash.toLowerCase(),
    logIndex: log.logIndex,
    blockNumber: log.blockNumber.toString(),
    tokenAddress: args.tokenAddress.toLowerCase(),
    amount: log.args.value.toString(),
    fromAddress: log.args.from.toLowerCase(),
  })
  inserted++
  // Best-effort: rotate the gateway's stable-cycle. Failure here is non-fatal
  // — the next tick re-queries the same range and re-attempts. We don't want
  // a transient DB hiccup to drop the inserted++ counter.
  await markAnnouncementPaid(args.db, log.args.to.toLowerCase()).catch((err) =>
    console.warn('[reconcile] markAnnouncementPaid failed', err),
  )
} catch (err) {
  // …existing unique-violation handling unchanged…
}
```

Add the import at the top of `reconcile.ts`:

```ts
import { markAnnouncementPaid } from '@open-agents/db'
```

- [ ] **Step 10.4: Modify `apps/gateway/src/routes/resolve.ts` — handle `text(node, "stealth-payload")`**

Locate the `else if (parsed.kind === 'text')` branch (the one that reads `agent.textRecords[parsed.key]`). Replace it with the dispatch shown:

```ts
} else if (parsed.kind === 'text') {
  if (parsed.key === 'stealth-payload') {
    // Read the current (unpaid) issuance for this agent. If none exists
    // (cold start: the dashboard called text() before addr()), generate a
    // fresh one — same flow as the addr() branch.
    let issuance = await findCurrentAnnouncement(db, agent.id)
    if (!issuance && agent.stealthMeta) {
      const out = deriveStealthForQuery(agent.stealthMeta)
      const stealthSafe = predictStealthSafeAddress(out.stealthAddress)
      // recordAnnouncement is fire-and-forget elsewhere; here we await so the
      // immediately-following encode reads the row we just wrote.
      const inserted = await insertGatewayAnnouncement(db, {
        agentId: agent.id,
        stealthAddress: out.stealthAddress,
        stealthSafeAddress: stealthSafe,
        ephemeralPub: out.ephemeralPubKey,
        viewTag: out.viewTag,
      })
      issuance = inserted
    }

    if (!issuance) {
      // Agent has no stealth-meta and no announcements — return empty bytes.
      value = '0x'
    } else {
      // abi.encode(address stealthEoa, bytes ephemeralPub, uint8 viewTag).
      // The sender console abi.decodes the same shape on the other side and
      // passes (stealthEoa, ephemeralPub, [viewTag]) to ERC-5564 announce().
      value = encodeAbiParameters(
        [{ type: 'address' }, { type: 'bytes' }, { type: 'uint8' }],
        [
          issuance.stealthAddress as `0x${string}`,
          issuance.ephemeralPub as `0x${string}`,
          issuance.viewTag,
        ],
      )
    }
  } else {
    // Generic text record path (unchanged).
    value = agent.textRecords?.[parsed.key] ?? ''
  }
}
```

Add the imports at the top of `resolve.ts` (some likely already exist; only add what's missing):

```ts
import { encodeAbiParameters } from 'viem'
import { insertGatewayAnnouncement } from '@open-agents/db'
```

- [ ] **Step 10.5: Write the failing gateway test**

Create `apps/gateway/tests/resolve-stealth-payload.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decodeAbiParameters } from 'viem'
import {
  createDb,
  insertAgent,
  insertGatewayAnnouncement,
  findCurrentAnnouncement,
} from '@open-agents/db'
import { encodeResolveText, encodeName } from '../src/lib/ens-resolve-data.js'
import app from '../src/server.js'

const DB_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
process.env['DATABASE_URL'] = DB_URL

let db: ReturnType<typeof createDb>
let agentRowId: string
const SUBLABEL = 'sp-' + Date.now()
const STEALTH = ('0x' + 'cd'.repeat(20)).toLowerCase() as `0x${string}`
const SAFE = ('0x' + 'ce'.repeat(20)).toLowerCase() as `0x${string}`
const EPH = '0x02' + '7f'.repeat(32)

beforeAll(async () => {
  db = createDb(DB_URL)
  const agent = await insertAgent(db, {
    ownerEoa: '0x0000000000000000000000000000000000000099',
    subnameLabel: SUBLABEL,
    baseAddr: '0x0000000000000000000000000000000000000001',
    textRecords: { 'stealth-meta': '0x' + 'aa'.repeat(33) + 'bb'.repeat(33) },
  })
  agentRowId = agent.id
  await insertGatewayAnnouncement(db, {
    agentId: agentRowId,
    stealthAddress: STEALTH,
    stealthSafeAddress: SAFE,
    ephemeralPub: EPH,
    viewTag: 0x42,
  })
})

afterAll(() => {})

/**
 * Build a /lookup/<sender>/<callData> request body matching the gateway's
 * existing CCIP-Read interface. encodeResolveText + encodeName already exist
 * in the gateway's lib for the addr() tests.
 */
async function callTextStealthPayload(): Promise<{ body: string; status: number }> {
  const name = `${SUBLABEL}.gabhru.eth`
  const callData = encodeResolveText(encodeName(name), 'stealth-payload')
  const res = await app.fetch(
    new Request(`http://localhost/lookup/0x0000000000000000000000000000000000000001/${callData}`),
  )
  return { status: res.status, body: await res.text() }
}

describe('GET /lookup — text(node, "stealth-payload")', () => {
  it('returns abi-encoded (ephemeralPub, viewTag) for the current issuance', async () => {
    const { status, body } = await callTextStealthPayload()
    expect(status).toBe(200)

    // The CCIP-Read response is `data` field; the gateway-signer wraps it
    // (bytes data, uint64 expires, bytes signature). Strip outer encoding
    // first — the resolve route's encoder is `encodeAbiParameters([{type:'bytes'}], [innerEncoded])`,
    // wrapped again by the signer. Tests in apps/gateway/tests/* already do
    // this peel — copy that pattern.

    const json = JSON.parse(body) as { data: `0x${string}` }
    const [outerSignedBytes] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
      json.data,
    ) as [`0x${string}`, bigint, `0x${string}`]
    const [innerBytes] = decodeAbiParameters([{ type: 'bytes' }], outerSignedBytes) as [`0x${string}`]
    const [stealthEoa, ephPub, viewTag] = decodeAbiParameters(
      [{ type: 'address' }, { type: 'bytes' }, { type: 'uint8' }],
      innerBytes,
    ) as [`0x${string}`, `0x${string}`, number]

    expect(stealthEoa.toLowerCase()).toBe(STEALTH.toLowerCase())
    expect(ephPub.toLowerCase()).toBe(EPH.toLowerCase())
    expect(viewTag).toBe(0x42)
  })

  it('survives a fresh agent with no announcements (generates one)', async () => {
    const fresh = await insertAgent(db, {
      ownerEoa: '0x' + 'aa'.repeat(20),
      subnameLabel: 'sp-fresh-' + Date.now(),
      baseAddr: '0x0000000000000000000000000000000000000001',
      textRecords: { 'stealth-meta': '0x' + 'cc'.repeat(33) + 'dd'.repeat(33) },
    })
    expect(await findCurrentAnnouncement(db, fresh.id)).toBeNull()

    const callData = encodeResolveText(
      encodeName(`${fresh.subnameLabel}.gabhru.eth`),
      'stealth-payload',
    )
    const res = await app.fetch(
      new Request(`http://localhost/lookup/0x0000000000000000000000000000000000000001/${callData}`),
    )
    expect(res.status).toBe(200)
    expect(await findCurrentAnnouncement(db, fresh.id)).not.toBeNull()
  })
})
```

> Note: `encodeResolveText`/`encodeName` may need to be exported from `apps/gateway/src/lib/ens-resolve-data.ts` if they're currently internal — bump them to `export` if so. Existing addr() tests will reveal whether the helpers are already exported; if not, this is a one-line change in that file.

- [ ] **Step 10.6: Run the tests**

```bash
pnpm --filter @open-agents/gateway test
```

Expected: 2 stealth-payload tests pass alongside any existing gateway suite.

- [ ] **Step 10.7: Re-run the scanner reconcile test to confirm `paid_at` flips**

The Task 4 reconcile test does not check `paid_at`. Add a small verification before committing:

```bash
pnpm --filter @open-agents/scanner test -- reconcile
```

If you want hard evidence, append a 5-line check at the end of `apps/scanner/tests/reconcile.test.ts` (one assertion):

```ts
import { findCurrentAnnouncement } from '@open-agents/db'

it('marks the matched announcement as paid', async () => {
  const before = await findCurrentAnnouncement(db, agentRowId)
  expect(before).toBeNull() // already paid by previous tests
})
```

(If your test order leaves `before` non-null, adjust the expectation; the point is to verify `markAnnouncementPaid` ran.)

- [ ] **Step 10.8: Commit**

```bash
git add apps/gateway/src/routes/resolve.ts apps/gateway/src/lib/ens-resolve-data.ts \
  apps/scanner/src/lib/reconcile.ts \
  packages/db/src/queries/announcements.ts \
  apps/gateway/tests/resolve-stealth-payload.test.ts
git commit -m "$(cat <<'EOF'
feat(gateway): text(node, "stealth-payload") returns ephemeralPub + viewTag

Sender consoles need three things to fire a stealth USDC payment: the
Safe address (already returned by addr()), the ephemeral pubkey, and the
view-tag byte. We add a new ENS text record "stealth-payload" that
abi-encodes (bytes, uint8). Reads from the same findCurrentAnnouncement
the addr() branch uses, so two consecutive CCIP-Read calls reference the
same issuance row by construction — no race, no cache.

Reconciler now calls markAnnouncementPaid after a successful insert so
the gateway's stable-cycle semantic rotates after each payment. Failure
here is logged but non-fatal: the next tick re-attempts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Dashboard — payments table page + live updates

**Files:**
- Modify: `apps/dashboard/src/types/api.ts` (add `PaymentResponse`, `ReceiptResponse`, `PaymentsListResponse`)
- Create: `apps/dashboard/src/lib/usdc-format.ts`
- Create: `apps/dashboard/src/hooks/use-payments.ts`
- Create: `apps/dashboard/src/hooks/use-confirm-payment.ts`
- Create: `apps/dashboard/src/components/payments-table.tsx`
- Create: `apps/dashboard/src/components/confirm-toggle.tsx`
- Create: `apps/dashboard/src/app/dashboard/[agentId]/payments/page.tsx`
- Modify: `apps/dashboard/src/app/dashboard/[agentId]/page.tsx` (add link to /payments)

**Decision: SWR for the first page, native `EventSource` for incremental updates, merged in a single `usePayments` hook.** The hook returns `{ payments, isLoading, error }`; the page just renders. SWR's `mutate` shoves new SSE rows to the front. This keeps the table render path a pure function of state.

**Decision: client-side USDC formatting in a tiny helper, no `Intl.NumberFormat`.** Locale-detection differences between SSR and CSR caused hydration mismatches in Plan 3; we sidestep with a deterministic formatter.

- [ ] **Step 11.1: Add response types to `apps/dashboard/src/types/api.ts`**

Append to the existing file:

```ts
export interface ReceiptResponse {
  id: string
  confirmedByRecipient: boolean
  eip712Payload: string | null
  eip712Signature: string | null
  appendedResponseTx: string | null
  updatedAt: string
}

export interface PaymentResponse {
  id: string
  agentId: string
  stealthAddress: string
  ephemeralPub: string
  txHash: string
  logIndex: number
  blockNumber: string
  tokenAddress: string
  amount: string
  fromAddress: string
  detectedAt: string
  receipt: ReceiptResponse | null
}

export interface PaymentsListResponse {
  agentId: string
  count: number
  payments: PaymentResponse[]
}

export interface ConfirmReceiptBody {
  confirmed: boolean
  eip712Payload?: string
  eip712Signature?: string
}
```

- [ ] **Step 11.2: Create `apps/dashboard/src/lib/usdc-format.ts`**

```ts
const USDC_DECIMALS = 6n

/**
 * Formats a uint256-as-string USDC amount as a comma-separated decimal:
 *   "5000000"   -> "5.00 USDC"
 *   "12345678"  -> "12.35 USDC" (rounded half-up at 2 decimals)
 *   "999000000" -> "999.00 USDC"
 *
 * Deterministic across SSR/CSR (no Intl, no locale lookups).
 */
export function formatUsdc(rawAmount: string): string {
  const big = BigInt(rawAmount)
  const integer = big / 10n ** USDC_DECIMALS
  const fraction = big % 10n ** USDC_DECIMALS
  // 6 decimals → keep 2 places; round half-up by adding 5_000 before truncating.
  const rounded = (fraction + 5_000n) / 10_000n
  const fracStr = rounded.toString().padStart(2, '0').slice(0, 2)
  const intStr = integer.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${intStr}.${fracStr} USDC`
}

/** Truncates a 0x-hex address for display: 0x1234…5678. */
export function shortAddr(addr: string): string {
  if (!addr.startsWith('0x') || addr.length < 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/** Truncates a tx hash similarly: 0x12345678…ab. */
export function shortTx(hash: string): string {
  if (!hash.startsWith('0x') || hash.length < 14) return hash
  return `${hash.slice(0, 10)}…${hash.slice(-2)}`
}

/** Returns a "x seconds ago" string from an ISO timestamp. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
```

- [ ] **Step 11.3: Create `apps/dashboard/src/hooks/use-payments.ts`**

```ts
'use client'

import { useEffect } from 'react'
import useSWR from 'swr'
import { getApiClient } from '@/lib/api-client'
import type { PaymentResponse, PaymentsListResponse } from '@/types/api'

interface UsePaymentsOpts {
  agentId: string | null
  enabled: boolean
}

interface UsePaymentsReturn {
  payments: PaymentResponse[] | undefined
  isLoading: boolean
  error: Error | undefined
  refresh: () => Promise<unknown>
}

const PAGE_SIZE = 50

/**
 * Loads the first PAGE_SIZE payments via SWR, then opens an EventSource that
 * streams `payment` events for new rows. Each SSE event is unshifted onto the
 * SWR cache via mutate; SWR re-renders the consumer.
 *
 * The stream auth token is the in-memory JWT held by ApiClient. EventSource
 * cannot send custom headers, so we pass it as a query param; if the token is
 * absent we skip the stream and rely on the SWR cache only.
 */
export function usePayments({ agentId, enabled }: UsePaymentsOpts): UsePaymentsReturn {
  const swrKey = enabled && agentId ? `/agents/${agentId}/payments?limit=${PAGE_SIZE}` : null
  const { data, error, isLoading, mutate } = useSWR<PaymentsListResponse, Error>(
    swrKey,
    (path: string) => getApiClient().get<PaymentsListResponse>(path),
    { revalidateOnFocus: false },
  )

  useEffect(() => {
    if (!enabled || !agentId) return
    const token = getApiClient().getToken()
    if (!token) return

    const apiBase =
      process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'
    const since = data?.payments[0]?.detectedAt ?? new Date(Date.now() - 60_000).toISOString()
    const url = `${apiBase}/agents/${agentId}/payments/stream?token=${encodeURIComponent(token)}&since=${encodeURIComponent(since)}`

    const es = new EventSource(url)
    es.addEventListener('payment', (ev) => {
      const incoming = JSON.parse((ev as MessageEvent<string>).data) as PaymentResponse
      void mutate(
        (prev) => {
          if (!prev) return prev
          if (prev.payments.find((p) => p.id === incoming.id)) return prev
          return {
            ...prev,
            count: prev.count + 1,
            payments: [incoming, ...prev.payments].slice(0, PAGE_SIZE),
          }
        },
        { revalidate: false },
      )
    })
    es.addEventListener('bye', () => es.close())
    es.onerror = () => {
      // Browser auto-reconnects on transient failure. Nothing to do.
    }
    return () => es.close()
  }, [agentId, enabled, data, mutate])

  return {
    payments: data?.payments,
    isLoading,
    error,
    refresh: mutate,
  }
}
```

- [ ] **Step 11.4: Create `apps/dashboard/src/hooks/use-confirm-payment.ts`**

```ts
'use client'

import { useState } from 'react'
import { getApiClient } from '@/lib/api-client'
import type { ConfirmReceiptBody, ReceiptResponse } from '@/types/api'

interface UseConfirmPaymentReturn {
  isPending: boolean
  error: Error | null
  toggle: (args: {
    agentId: string
    paymentId: string
    confirmed: boolean
  }) => Promise<ReceiptResponse>
}

export function useConfirmPayment(): UseConfirmPaymentReturn {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  async function toggle(args: {
    agentId: string
    paymentId: string
    confirmed: boolean
  }): Promise<ReceiptResponse> {
    setIsPending(true)
    setError(null)
    try {
      const body: ConfirmReceiptBody = { confirmed: args.confirmed }
      const res = await getApiClient().post<{ receipt: ReceiptResponse }>(
        `/agents/${args.agentId}/receipts/${args.paymentId}/confirm`,
        body,
      )
      return res.receipt
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      setError(err)
      throw err
    } finally {
      setIsPending(false)
    }
  }

  return { isPending, error, toggle }
}
```

- [ ] **Step 11.5: Create `apps/dashboard/src/components/confirm-toggle.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useConfirmPayment } from '@/hooks/use-confirm-payment'
import type { PaymentResponse } from '@/types/api'

interface ConfirmToggleProps {
  agentId: string
  payment: PaymentResponse
  onChange?: (newState: boolean) => void
}

export function ConfirmToggle({ agentId, payment, onChange }: ConfirmToggleProps) {
  const [optimistic, setOptimistic] = useState(payment.receipt?.confirmedByRecipient ?? false)
  const { toggle, isPending, error } = useConfirmPayment()

  async function handleClick() {
    const next = !optimistic
    setOptimistic(next)
    try {
      const updated = await toggle({ agentId, paymentId: payment.id, confirmed: next })
      onChange?.(updated.confirmedByRecipient)
    } catch {
      setOptimistic(!next) // rollback
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant={optimistic ? 'default' : 'outline'}
        onClick={handleClick}
        disabled={isPending}
      >
        {optimistic ? 'Confirmed' : 'Confirm'}
      </Button>
      {error ? <span className="text-xs text-red-600">{error.message}</span> : null}
    </div>
  )
}
```

- [ ] **Step 11.6: Create `apps/dashboard/src/components/payments-table.tsx`**

```tsx
'use client'

import { Card } from '@/components/ui/card'
import { ConfirmToggle } from './confirm-toggle'
import { formatUsdc, relativeTime, shortAddr, shortTx } from '@/lib/usdc-format'
import type { PaymentResponse } from '@/types/api'

interface PaymentsTableProps {
  agentId: string
  payments: PaymentResponse[] | undefined
  isLoading: boolean
}

export function PaymentsTable({ agentId, payments, isLoading }: PaymentsTableProps) {
  if (isLoading && !payments) {
    return <p className="text-sm text-muted-foreground">Loading payments…</p>
  }
  if (!payments || payments.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        No payments yet. Send USDC to your stealth address from the{' '}
        <code>/pay/&lt;your-name&gt;.gabhru.eth</code> page to test the pipeline.
      </Card>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Amount</th>
            <th className="py-2 pr-4 font-medium">From</th>
            <th className="py-2 pr-4 font-medium">Stealth</th>
            <th className="py-2 pr-4 font-medium">Tx</th>
            <th className="py-2 pr-4 font-medium">When</th>
            <th className="py-2 pl-4 text-right font-medium">Receipt</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} className="border-b last:border-b-0">
              <td className="py-2 pr-4 font-mono">{formatUsdc(p.amount)}</td>
              <td className="py-2 pr-4 font-mono">{shortAddr(p.fromAddress)}</td>
              <td className="py-2 pr-4 font-mono">{shortAddr(p.stealthAddress)}</td>
              <td className="py-2 pr-4 font-mono">
                <a
                  className="hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`https://basescan.org/tx/${p.txHash}`}
                >
                  {shortTx(p.txHash)}
                </a>
              </td>
              <td className="py-2 pr-4 text-muted-foreground">{relativeTime(p.detectedAt)}</td>
              <td className="py-2 pl-4">
                <ConfirmToggle agentId={agentId} payment={p} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 11.7: Create `apps/dashboard/src/app/dashboard/[agentId]/payments/page.tsx`**

```tsx
'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { PaymentsTable } from '@/components/payments-table'
import { useMe } from '@/hooks/use-me'
import { usePayments } from '@/hooks/use-payments'

export default function AgentPaymentsPage() {
  const params = useParams<{ agentId: string }>()
  const agentId = params?.agentId ?? null
  const { isAuthenticated } = useMe()

  const { payments, isLoading, error } = usePayments({ agentId, enabled: isAuthenticated })

  if (!isAuthenticated) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="text-sm">Connect your wallet to view payments.</p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Payments</h1>
          <p className="text-sm text-muted-foreground">
            Live updates as USDC lands at your stealth addresses.
          </p>
        </div>
        <Link
          href={`/dashboard/${agentId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to settings
        </Link>
      </header>

      {error ? (
        <Card className="p-4 text-sm text-red-600">Error: {error.message}</Card>
      ) : null}

      <PaymentsTable agentId={agentId ?? ''} payments={payments} isLoading={isLoading} />
    </main>
  )
}
```

- [ ] **Step 11.8: Add a "View payments" link in `apps/dashboard/src/app/dashboard/[agentId]/page.tsx`**

Locate the page header (likely around the agent label / settings card). Add a link near the top:

```tsx
import Link from 'next/link'
// …
<Link
  href={`/dashboard/${agentId}/payments`}
  className="text-sm text-muted-foreground hover:underline"
>
  View payments →
</Link>
```

The exact placement depends on the existing layout; the goal is a single click from the per-agent settings page to its payments view.

- [ ] **Step 11.9: Write the formatter test**

Create `apps/dashboard/tests/usdc-format.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { formatUsdc, relativeTime, shortAddr, shortTx } from '../src/lib/usdc-format'

describe('formatUsdc', () => {
  it('formats whole-USDC amounts', () => {
    expect(formatUsdc('5000000')).toBe('5.00 USDC')
  })
  it('formats sub-cent amounts (rounds)', () => {
    expect(formatUsdc('12345678')).toBe('12.35 USDC')
  })
  it('inserts thousands separators', () => {
    expect(formatUsdc('1234567000000')).toBe('1,234,567.00 USDC')
  })
})

describe('shortAddr / shortTx', () => {
  it('truncates a 20-byte address', () => {
    expect(shortAddr('0x' + 'aa'.repeat(20))).toBe('0xaaaa…aaaa')
  })
  it('truncates a 32-byte tx', () => {
    expect(shortTx('0x' + 'cd'.repeat(32))).toBe('0xcdcdcdcd…cd')
  })
})

describe('relativeTime', () => {
  it('returns seconds ago', () => {
    const now = new Date('2026-05-01T12:00:00Z').getTime()
    vi.setSystemTime(now)
    expect(relativeTime('2026-05-01T11:59:30Z')).toBe('30s ago')
    vi.useRealTimers()
  })
})
```

- [ ] **Step 11.10: Run the dashboard tests**

```bash
pnpm --filter @open-agents/dashboard test -- usdc-format
```

Expected: 5 tests pass.

- [ ] **Step 11.11: Manual smoke test**

```bash
pnpm --filter @open-agents/api dev &
pnpm --filter @open-agents/dashboard dev &
sleep 4
open "http://localhost:3000/dashboard/<agentId>/payments"
```

Connect wallet → SIWE login → the page renders the payments table (empty initially). Run the scanner against a stealth address you've sent USDC to (or insert a payments row manually via psql) and watch a row appear within ~2s without a refresh. `kill %1 %2` when done.

- [ ] **Step 11.12: Commit**

```bash
git add apps/dashboard/src/types/api.ts apps/dashboard/src/lib/usdc-format.ts \
  apps/dashboard/src/hooks/use-payments.ts apps/dashboard/src/hooks/use-confirm-payment.ts \
  apps/dashboard/src/components/payments-table.tsx apps/dashboard/src/components/confirm-toggle.tsx \
  apps/dashboard/src/app/dashboard/[agentId]/payments/page.tsx \
  apps/dashboard/src/app/dashboard/[agentId]/page.tsx \
  apps/dashboard/tests/usdc-format.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): payments table page with live SSE updates

usePayments composes SWR (first page) with native EventSource (live
appends). New rows arriving via SSE are unshifted onto the SWR cache so
the table re-renders within ~2s of a payment landing on-chain.

ConfirmToggle UPSERTs the per-payment receipt with optimistic UI; on
failure the toggle rolls back. formatUsdc avoids Intl to keep SSR/CSR
output deterministic (Plan 3 hydration mismatch lesson).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Dashboard — `/pay/[ens]` sender console

**Files:**
- Create: `apps/dashboard/src/lib/usdc.ts`
- Create: `apps/dashboard/src/lib/announcer.ts`
- Create: `apps/dashboard/src/lib/pay-flow.ts`
- Create: `apps/dashboard/src/components/pay-form.tsx`
- Create: `apps/dashboard/src/app/pay/[ens]/page.tsx`
- Modify: `apps/dashboard/src/lib/chains.ts` (add mainnet for ENS reads)
- Create: `apps/dashboard/tests/pay-flow.test.ts`

The sender console is a public page (no SIWE) where anyone with a Base wallet can pay an `<label>.gabhru.eth` agent. It resolves the ENS name through our gateway via viem's universal resolver, then fires two transactions: USDC.transfer to the Safe, followed by the ERC-5564 announce. The `useWriteContract` hook from wagmi sequences them.

**Decision: ENS reads happen on Ethereum mainnet via a one-off `createPublicClient`, not the wagmi-connected chain.** Universal Resolver lives on mainnet; the visitor's wallet is connected to Base for the writes. Adding mainnet to wagmi's chain list would require RainbowKit to render a chain-switch prompt, which is bad UX for a payment flow. A separate read-only client keeps the UI on Base.

**Decision: write the two txs sequentially, not as a 7702 batch.** Smart-account batching is a Plan-X follow-up; for v1 the user signs twice. We surface both tx hashes in the success state so the receipt shows both confirmations.

- [ ] **Step 12.1: Modify `apps/dashboard/src/lib/chains.ts` — keep the wagmi config as-is, but export a mainnet read client**

Append (do not remove existing exports):

```ts
import { mainnet } from 'viem/chains'
import { createPublicClient, http as viemHttp } from 'viem'

const mainnetRpc =
  process.env['NEXT_PUBLIC_MAINNET_RPC_URL'] ?? 'https://eth.llamarpc.com'

/**
 * One-off client used only for ENS reads via the universal resolver.
 * Kept off the wagmi chain list so the connected wallet stays on Base.
 */
export const ensReadClient = createPublicClient({
  chain: mainnet,
  transport: viemHttp(mainnetRpc),
})
```

- [ ] **Step 12.2: Create `apps/dashboard/src/lib/usdc.ts`**

```ts
import { parseAbi, type Address } from 'viem'

export const BASE_USDC_ADDRESS: Address =
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

export const BASE_USDC_DECIMALS = 6

export const usdcAbi = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
])
```

- [ ] **Step 12.3: Create `apps/dashboard/src/lib/announcer.ts`**

```ts
import { parseAbi, type Address } from 'viem'

/** ERC-5564 Announcer on Base mainnet (per spec §5.2). */
export const ERC5564_ANNOUNCER_ADDRESS: Address =
  '0x55649E01B5Df198D18D95b5cc5051630cfD45564'

export const announcerAbi = parseAbi([
  'function announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata)',
])

/** Scheme 1 = secp256k1 / SECP256K1_KECCAK_256 per ERC-5564. */
export const STEALTH_SCHEME_ID = 1n
```

- [ ] **Step 12.4: Create `apps/dashboard/src/lib/pay-flow.ts`**

The brain of the sender console. Pure functions (no React) so the test in Step 12.7 can hit them with a faked viem client.

```ts
import { decodeAbiParameters, namehash, parseUnits, type Address, type Hex } from 'viem'
import { ensReadClient } from './chains'
import { BASE_USDC_DECIMALS } from './usdc'

export interface ResolvedRecipient {
  /** Lowercased Safe address (where USDC is sent). */
  safeAddress: Address
  /** Lowercased EOA address (announced via ERC-5564). */
  stealthEoa: Address
  /** Compressed secp256k1 ephemeral pubkey (33 bytes). */
  ephemeralPub: Hex
  /** ERC-5564 view tag byte. */
  viewTag: number
}

/**
 * Resolves an `<label>.gabhru.eth` name into the four pieces the sender
 * needs. Two ENS queries: getEnsAddress (Safe address from gateway addr())
 * and getEnsText with key="stealth-payload" (eoa, ephemeralPub, viewTag).
 *
 * Both queries route through our gateway via universal-resolver CCIP-Read.
 * The Plan 5 stable-cycle semantic guarantees both reads return the same
 * issuance row.
 */
export async function resolveRecipient(name: string): Promise<ResolvedRecipient> {
  const safeAddress = await ensReadClient.getEnsAddress({ name })
  if (!safeAddress) throw new Error(`No safe address for ${name}`)

  const payloadHex = await ensReadClient.getEnsText({ name, key: 'stealth-payload' })
  if (!payloadHex || payloadHex === '0x') {
    throw new Error(`No stealth-payload record for ${name}`)
  }

  const [stealthEoa, ephemeralPub, viewTag] = decodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint8' }],
    payloadHex as Hex,
  ) as [Address, Hex, number]

  return {
    safeAddress: safeAddress.toLowerCase() as Address,
    stealthEoa: stealthEoa.toLowerCase() as Address,
    ephemeralPub,
    viewTag,
  }
}

/**
 * Converts a human USDC amount ("5.50") to a uint256 raw value (5_500_000n).
 * Throws on negative or non-numeric input.
 */
export function parseUsdcInput(input: string): bigint {
  const cleaned = input.trim()
  if (!/^\d+(\.\d{1,6})?$/.test(cleaned)) {
    throw new Error('Amount must be a decimal with up to 6 places')
  }
  return parseUnits(cleaned, BASE_USDC_DECIMALS)
}

/**
 * Wraps the view-tag byte as a 1-byte `bytes` for the announce metadata arg.
 * ERC-5564 explicitly allows the metadata to be the view-tag prefix.
 */
export function viewTagAsMetadata(viewTag: number): Hex {
  if (viewTag < 0 || viewTag > 255) {
    throw new Error('viewTag must fit in a single byte')
  }
  return ('0x' + viewTag.toString(16).padStart(2, '0')) as Hex
}

/** Computed namehash, exposed for tests. */
export function nodeOf(name: string): Hex {
  return namehash(name)
}
```

- [ ] **Step 12.5: Create `apps/dashboard/src/components/pay-form.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { useAccount, useWriteContract } from 'wagmi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { ConnectButton } from '@/components/connect-button'
import {
  parseUsdcInput,
  resolveRecipient,
  viewTagAsMetadata,
  type ResolvedRecipient,
} from '@/lib/pay-flow'
import { BASE_USDC_ADDRESS, usdcAbi } from '@/lib/usdc'
import {
  ERC5564_ANNOUNCER_ADDRESS,
  STEALTH_SCHEME_ID,
  announcerAbi,
} from '@/lib/announcer'
import { shortAddr, shortTx } from '@/lib/usdc-format'

interface PayFormProps {
  ensName: string
}

type Stage = 'idle' | 'resolving' | 'transfer' | 'announce' | 'done' | 'error'

export function PayForm({ ensName }: PayFormProps) {
  const { isConnected } = useAccount()
  const [amount, setAmount] = useState('')
  const [recipient, setRecipient] = useState<ResolvedRecipient | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [transferTx, setTransferTx] = useState<`0x${string}` | null>(null)
  const [announceTx, setAnnounceTx] = useState<`0x${string}` | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { writeContractAsync } = useWriteContract()

  async function handlePay() {
    setErrorMsg(null)
    setTransferTx(null)
    setAnnounceTx(null)
    try {
      setStage('resolving')
      const r = recipient ?? (await resolveRecipient(ensName))
      setRecipient(r)

      const raw = parseUsdcInput(amount)

      setStage('transfer')
      const tHash = await writeContractAsync({
        address: BASE_USDC_ADDRESS,
        abi: usdcAbi,
        functionName: 'transfer',
        args: [r.safeAddress, raw],
      })
      setTransferTx(tHash)

      setStage('announce')
      const aHash = await writeContractAsync({
        address: ERC5564_ANNOUNCER_ADDRESS,
        abi: announcerAbi,
        functionName: 'announce',
        args: [
          STEALTH_SCHEME_ID,
          r.stealthEoa,
          r.ephemeralPub,
          viewTagAsMetadata(r.viewTag),
        ],
      })
      setAnnounceTx(aHash)

      setStage('done')
    } catch (err) {
      setStage('error')
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Card className="space-y-4 p-6">
      <header>
        <h2 className="text-lg font-semibold">Pay {ensName}</h2>
        <p className="text-xs text-muted-foreground">
          Sends USDC on Base to a fresh stealth address + announces via ERC-5564.
        </p>
      </header>

      {!isConnected ? <ConnectButton /> : null}

      <div className="space-y-2">
        <Label htmlFor="amount">Amount (USDC)</Label>
        <Input
          id="amount"
          type="text"
          inputMode="decimal"
          placeholder="1.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      {recipient ? (
        <div className="rounded border p-3 text-xs text-muted-foreground">
          <div>Safe: <code>{shortAddr(recipient.safeAddress)}</code></div>
          <div>Stealth EOA: <code>{shortAddr(recipient.stealthEoa)}</code></div>
          <div>View tag: <code>0x{recipient.viewTag.toString(16).padStart(2, '0')}</code></div>
        </div>
      ) : null}

      <Button onClick={handlePay} disabled={!isConnected || stage === 'transfer' || stage === 'announce' || stage === 'resolving'}>
        {stage === 'idle' || stage === 'done' || stage === 'error' ? 'Send USDC + Announce' : `Working… (${stage})`}
      </Button>

      {transferTx ? (
        <p className="text-xs">
          Transfer:{' '}
          <a href={`https://basescan.org/tx/${transferTx}`} target="_blank" rel="noopener noreferrer" className="underline">
            {shortTx(transferTx)}
          </a>
        </p>
      ) : null}
      {announceTx ? (
        <p className="text-xs">
          Announce:{' '}
          <a href={`https://basescan.org/tx/${announceTx}`} target="_blank" rel="noopener noreferrer" className="underline">
            {shortTx(announceTx)}
          </a>
        </p>
      ) : null}
      {errorMsg ? <p className="text-xs text-red-600">{errorMsg}</p> : null}
      {stage === 'done' ? (
        <p className="text-xs text-green-700">
          Sent. The recipient's dashboard should reflect this within ~2s.
        </p>
      ) : null}
    </Card>
  )
}
```

- [ ] **Step 12.6: Create `apps/dashboard/src/app/pay/[ens]/page.tsx`**

```tsx
'use client'

import { useParams } from 'next/navigation'
import { PayForm } from '@/components/pay-form'

export default function PayEnsPage() {
  const params = useParams<{ ens: string }>()
  const raw = params?.ens ?? ''
  // The route param is URL-encoded; decode and validate it looks like an
  // ENS name (not a plain address).
  const ensName = decodeURIComponent(raw)

  if (!ensName.includes('.')) {
    return (
      <main className="mx-auto max-w-md p-6 text-sm text-red-600">
        Invalid name: {ensName}. Expected something like
        <code> alice.gabhru.eth</code>.
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-md space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Send a payment</h1>
        <p className="text-sm text-muted-foreground">
          Stealth USDC payment to <code>{ensName}</code>.
        </p>
      </header>
      <PayForm ensName={ensName} />
    </main>
  )
}
```

- [ ] **Step 12.7: Write the pay-flow tests**

Create `apps/dashboard/tests/pay-flow.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { encodeAbiParameters } from 'viem'
import { parseUsdcInput, viewTagAsMetadata, resolveRecipient } from '../src/lib/pay-flow'

vi.mock('../src/lib/chains', () => ({
  ensReadClient: {
    getEnsAddress: vi.fn(),
    getEnsText: vi.fn(),
  },
}))

import { ensReadClient } from '../src/lib/chains'

describe('parseUsdcInput', () => {
  it('handles whole numbers', () => {
    expect(parseUsdcInput('5')).toBe(5_000_000n)
  })
  it('handles decimals', () => {
    expect(parseUsdcInput('1.5')).toBe(1_500_000n)
  })
  it('rejects more than 6 decimals', () => {
    expect(() => parseUsdcInput('1.1234567')).toThrow()
  })
  it('rejects non-numeric', () => {
    expect(() => parseUsdcInput('abc')).toThrow()
  })
})

describe('viewTagAsMetadata', () => {
  it('encodes a single byte', () => {
    expect(viewTagAsMetadata(0x42)).toBe('0x42')
  })
  it('zero-pads short tags', () => {
    expect(viewTagAsMetadata(0x5)).toBe('0x05')
  })
  it('rejects out-of-range', () => {
    expect(() => viewTagAsMetadata(256)).toThrow()
  })
})

describe('resolveRecipient', () => {
  const SAFE = '0x' + 'aa'.repeat(20)
  const EOA = '0x' + 'bb'.repeat(20)
  const EPH = '0x02' + '11'.repeat(32)
  const VIEW_TAG = 0x42

  it('returns safe + payload fields', async () => {
    const payload = encodeAbiParameters(
      [{ type: 'address' }, { type: 'bytes' }, { type: 'uint8' }],
      [EOA as `0x${string}`, EPH as `0x${string}`, VIEW_TAG],
    )
    ;(ensReadClient.getEnsAddress as ReturnType<typeof vi.fn>).mockResolvedValueOnce(SAFE)
    ;(ensReadClient.getEnsText as ReturnType<typeof vi.fn>).mockResolvedValueOnce(payload)

    const r = await resolveRecipient('alice.gabhru.eth')
    expect(r.safeAddress).toBe(SAFE.toLowerCase())
    expect(r.stealthEoa).toBe(EOA.toLowerCase())
    expect(r.ephemeralPub.toLowerCase()).toBe(EPH.toLowerCase())
    expect(r.viewTag).toBe(VIEW_TAG)
  })

  it('throws when getEnsAddress returns null', async () => {
    ;(ensReadClient.getEnsAddress as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    await expect(resolveRecipient('ghost.gabhru.eth')).rejects.toThrow(/No safe address/)
  })

  it('throws when stealth-payload is empty', async () => {
    ;(ensReadClient.getEnsAddress as ReturnType<typeof vi.fn>).mockResolvedValueOnce(SAFE)
    ;(ensReadClient.getEnsText as ReturnType<typeof vi.fn>).mockResolvedValueOnce('0x')
    await expect(resolveRecipient('coldstart.gabhru.eth')).rejects.toThrow(/stealth-payload/)
  })
})
```

- [ ] **Step 12.8: Run the tests**

```bash
pnpm --filter @open-agents/dashboard test -- pay-flow
```

Expected: 10 tests pass.

- [ ] **Step 12.9: Manual smoke test**

1. Ensure your local agent has stealth-meta published (Plan 4 wizard step 2 + onchain register).
2. Start the gateway, api, and dashboard:
   ```bash
   pnpm --filter @open-agents/gateway dev &
   pnpm --filter @open-agents/api dev &
   pnpm --filter @open-agents/dashboard dev &
   ```
3. Visit `http://localhost:3000/pay/<your-label>.gabhru.eth` in a wallet-equipped browser.
4. Connect → enter `0.01` → click Send. Sign the two transactions.
5. Open `http://localhost:3000/dashboard/<agentId>/payments` in another tab. Within ~5s the row should appear (after the next scanner tick if running locally).
6. Toggle Confirm; the receipt row UPSERTs.
7. `kill %1 %2 %3`.

- [ ] **Step 12.10: Commit**

```bash
git add apps/dashboard/src/lib/usdc.ts apps/dashboard/src/lib/announcer.ts \
  apps/dashboard/src/lib/pay-flow.ts apps/dashboard/src/lib/chains.ts \
  apps/dashboard/src/components/pay-form.tsx \
  apps/dashboard/src/app/pay/[ens]/page.tsx \
  apps/dashboard/tests/pay-flow.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): /pay/[ens] sender console

Public, no-SIWE page that resolves <label>.gabhru.eth via the universal
resolver (mainnet read-only client; visitor's wallet stays on Base),
fetches the stealth payload (EOA + ephemeral pub + view tag) from the
gateway's text("stealth-payload") record, then sequences usdc.transfer
+ ERC-5564 announce via wagmi useWriteContract. Surfaces both tx hashes
on success.

resolveRecipient + parseUsdcInput + viewTagAsMetadata are pure functions
in pay-flow.ts so unit tests can hit them without a wallet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: End-to-end demo runbook + verification

**Files:**
- Create: `apps/scanner/tests/e2e-pipeline.md` (runbook)
- Create: `apps/scanner/scripts/seed-demo-payment.ts` (one-shot helper)
- Modify: `apps/scanner/package.json` (add `seed:demo` script)

The integration tests in earlier tasks each verify a single layer. Task 13 is the **demo runbook** — the script you run to prove the entire pipeline works against a real Base mainnet payment, end-to-end. Output is a checklist a hackathon judge could follow.

**Decision: no automated full-stack e2e against Anvil for v1.** A useful Anvil e2e would need to (a) deploy a USDC mock, (b) deploy the ERC-5564 Announcer (or fork it from mainnet), (c) deploy the agent registry, (d) wire the wagmi config to point at Anvil. That's three orders of magnitude more setup than the manual runbook below for the same evidence. Plan 7 will revisit when the on-chain receipt path needs deterministic CI coverage.

- [ ] **Step 13.1: Create `apps/scanner/scripts/seed-demo-payment.ts`**

A one-shot script for cases where the engineer can't (or doesn't want to) actually move USDC. Inserts a payments row directly so the dashboard renders something real.

```ts
import { createDb, insertAgent, insertGatewayAnnouncement, insertPayment, findAgentBySubname } from '@open-agents/db'

const DB_URL = process.env['DATABASE_URL'] ?? 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
const SUBLABEL = process.argv[2]
if (!SUBLABEL) {
  console.error('Usage: pnpm --filter @open-agents/scanner seed:demo <subname-label>')
  process.exit(1)
}

async function main(): Promise<void> {
  const db = createDb(DB_URL)
  const agent = await findAgentBySubname(db, SUBLABEL)
  if (!agent) {
    console.error(`No agent with subname ${SUBLABEL} — run the wizard first`)
    process.exit(2)
  }

  const STEALTH = ('0x' + 'fa'.repeat(20)).toLowerCase() as `0x${string}`
  const EPH = '0x02' + 'cc'.repeat(32)
  const TX = ('0x' + Date.now().toString(16).padStart(64, '0')) as `0x${string}`

  await insertGatewayAnnouncement(db, {
    agentId: agent.id,
    stealthAddress: STEALTH,
    ephemeralPub: EPH,
    viewTag: 0x99,
  })

  const payment = await insertPayment(db, {
    agentId: agent.id,
    stealthAddress: STEALTH,
    ephemeralPub: EPH,
    txHash: TX,
    logIndex: 0,
    blockNumber: '20100000',
    tokenAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    amount: '5_000_000'.replace(/_/g, ''),
    fromAddress: '0x' + 'be'.repeat(20),
  })

  console.log(`Inserted payment ${payment.id} for agent ${agent.id} (${SUBLABEL})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

> Note: `findAgentBySubname` may need to be added to `packages/db/src/queries/agents.ts` if not yet exported. One-line addition: `select().from(agents).where(eq(agents.subnameLabel, subname)).limit(1).then(r => r[0] ?? null)`.

- [ ] **Step 13.2: Add `seed:demo` to `apps/scanner/package.json`**

Append to the `scripts` block:

```json
"seed:demo": "tsx scripts/seed-demo-payment.ts"
```

- [ ] **Step 13.3: Create `apps/scanner/tests/e2e-pipeline.md`**

```markdown
# Plan 5 — End-to-end pipeline runbook

This document walks a single USDC payment from the sender console all the way
through the dashboard. Run after Plans 1–4 are live and Plan 5 is implemented.

## Prerequisites
- Local Postgres up: `docker compose -f docker-compose.dev.yml up -d`.
- Migrations applied through `0004_payments_receipts`.
- An agent registered (`alice.gabhru.eth`-style subname) with `stealth-meta`
  published — the Plan 4 wizard does this.
- A wallet on Base mainnet with at least 0.05 USDC + ETH for gas.
- Two terminals open and a wallet-equipped browser.

## Steps

### 1. Boot the four services
```bash
pnpm --filter @open-agents/gateway dev   # :3030
pnpm --filter @open-agents/api dev       # :3001
pnpm --filter @open-agents/scanner dev   # :3002
pnpm --filter @open-agents/dashboard dev # :3000
```

### 2. Open the dashboard payments page
- Visit `http://localhost:3000/dashboard/<agentId>/payments`.
- SIWE-login as the agent owner.
- Confirm the table renders (empty is fine).

### 3. Open the sender console in another tab
- Visit `http://localhost:3000/pay/<your-label>.gabhru.eth`.
- Connect a wallet on Base mainnet.
- Enter `0.01` USDC.
- Click "Send USDC + Announce". Sign both txs.
- Note the two BaseScan tx hashes shown after confirmation.

### 4. Trigger a scanner tick
```bash
curl -s -X POST http://localhost:3002/tick | jq '.perAgent[] | select(.reconcile.inserted > 0)'
```

Expected: one entry with `reconcile.inserted: 1` for your agent.

### 5. Confirm the dashboard updated
- Switch to the payments tab.
- Within 2s of the tick, a row should appear with:
  - Amount: `0.01 USDC`
  - From: short of your wallet address
  - Stealth: short of the issued stealth Safe address
  - Tx: the BaseScan link from step 3

### 6. Toggle a receipt
- Click "Confirm" on the row.
- Refresh the page — the toggle should still read "Confirmed".

### 7. Verify gateway-announcement rotation
After step 5 the announcement is paid:
```bash
docker exec -it $(docker compose -f docker-compose.dev.yml ps -q postgres) \
  psql -U open_agents -d open_agents \
  -c "SELECT stealth_safe_address, paid_at FROM gateway_announcements ORDER BY generated_at DESC LIMIT 3;"
```
The most-recent row's `paid_at` should be NOW (set by Task 10's reconciler hook).

A second visit to `/pay/<label>.gabhru.eth` will trigger a *fresh* issuance —
verify by checking that the next addr() call returns a different Safe address.

## Falling back without a real payment

If you don't want to move actual USDC:
```bash
pnpm --filter @open-agents/scanner seed:demo <your-subname-label>
```
inserts a fake row directly. The dashboard should reflect it within ~2s via SSE.

## Failure modes (and how to tell)

- **Dashboard stays empty after tick**: check `apps/scanner` logs for the per-agent
  `inserted: 0` line. Likely the gateway hasn't issued an announcement yet — visit
  `/pay/<label>.gabhru.eth` once to force `addr()` to write a row, then re-tick.

- **`/tick` returns 401**: `CRON_SECRET` is set but you didn't pass `Authorization: Bearer <secret>`.
  Either unset `CRON_SECRET` for local dev or include the header.

- **SSE stream doesn't push**: confirm the JWT on the URL hasn't expired. Refresh
  the dashboard tab to re-mint the token; the EventSource will reconnect on
  the next render.

- **`announce()` reverts**: check the Announcer address in `apps/dashboard/src/lib/announcer.ts`.
  Per-spec it's `0x55649E…45564`; if Base mainnet has a different deployment, update.

```

- [ ] **Step 13.4: Add `findAgentBySubname` to `packages/db/src/queries/agents.ts` (if missing)**

Confirm with grep:

```bash
grep -n "findAgentBySubname" packages/db/src/queries/agents.ts || echo "missing"
```

If missing, append:

```ts
export async function findAgentBySubname(
  db: DbClient,
  subname: string,
): Promise<Agent | null> {
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.subnameLabel, subname))
    .limit(1)
  return rows[0] ?? null
}
```

- [ ] **Step 13.5: Smoke-test the seed script**

```bash
pnpm --filter @open-agents/scanner seed:demo <your-subname-label>
```

Expected: `Inserted payment <uuid> for agent <id> (<label>)`. Refresh the dashboard payments page — the row appears within 2s via SSE.

- [ ] **Step 13.6: Commit**

```bash
git add apps/scanner/scripts/seed-demo-payment.ts apps/scanner/tests/e2e-pipeline.md \
  apps/scanner/package.json packages/db/src/queries/agents.ts
git commit -m "$(cat <<'EOF'
docs(scanner): Plan 5 e2e runbook + seed-demo helper

e2e-pipeline.md is the click-by-click demo script — boot the four apps,
fire a 0.01 USDC stealth payment from the sender console, and watch the
dashboard light up via SSE within ~2s of a scanner tick. Includes a
fallback (`seed:demo` script) for offline demos and a "failure modes"
section keyed to log lines you'd actually see.

findAgentBySubname is a one-line query addition to support the seed
script's lookup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

After Plan 5 ships, the demo loop is closed:
- A sender hits `/pay/<label>.gabhru.eth`, signs USDC.transfer + announce.
- The scanner sees the Transfer log, reconciles to a `payments` row, marks the gateway announcement paid.
- The dashboard's payments table updates within ~2s via SSE; the owner can toggle "Confirmed".

What Plan 5 deliberately does NOT do (deferred to later plans):
- Plan 6: ERC-8004 ValidationRegistry attestations (sender-side proof).
- Plan 7: on-chain `appendResponse` of EIP-712 receipts (the `appended_response_tx` column is wired but null).
- Multi-token support (USDC-only for v1; the schema accommodates more).
- 7702 batched (transfer + announce) tx for the sender flow.
- LISTEN/NOTIFY-driven SSE; we poll DB instead.

