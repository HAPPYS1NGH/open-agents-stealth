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
        │   └── 0002_payments_receipts.sql                # NEW
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
- Create: `packages/db/migrations/0002_payments_receipts.sql`
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

- [ ] **Step 1.2: Create the migration `packages/db/migrations/0002_payments_receipts.sql`**

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

Expected: drizzle-kit reports `0002_payments_receipts` applied. Confirm via psql:

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
  packages/db/migrations/0002_payments_receipts.sql \
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

Migration 0002 applies cleanly on top of 0001; 0001's gateway_announcements
remains untouched.

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

