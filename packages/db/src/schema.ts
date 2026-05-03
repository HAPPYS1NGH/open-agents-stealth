import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  numeric,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * agents — one row per registered AI agent.
 *
 * owner_eoa           The EOA that owns the ERC-8004 NFT. Used for SIWE auth
 *                     and is the address whose signature derives stealth keys.
 *
 * agent_id            The on-chain ERC-8004 agent ID in "chainId:uint256" form,
 *                     e.g. "8453:42". Null until the dev has called register()
 *                     and notified us via POST /agents/:id/register-onchain.
 *
 * agent_wallet_eoa    The delegated hot-key address (set via setAgentWallet on
 *                     IdentityRegistry). Null for solo-dev mode where ownerOf
 *                     is used for SDK auth instead. SDK JWTs are issued against
 *                     this address (or ownerOf if null).
 *
 * subname_label       The label part of <label>.gabhru.eth. Unique constraint
 *                     prevents two agents claiming the same subname.
 *
 * base_addr           The address returned by the gateway for addr() queries.
 *                     Initially set to agent_wallet_eoa during onboarding.
 *                     Plan 4 will update this to the stealth meta-address
 *                     spend pubkey derivation address once stealth keys are set.
 *
 * text_records        JSONB map of ENSIP-26 / ENSIP-25 record keys to values.
 *                     Expected keys (all optional, set during onboarding):
 *                       "agent-context"         — JSON per ENSIP-26
 *                       "agent-endpoint[mcp]"   — MCP endpoint URL
 *                       "agent-endpoint[a2a]"   — A2A endpoint URL
 *                       "agent-endpoint[web]"   — Web endpoint URL
 *                       "stealth-meta"          — 132-hex stealth meta-address
 *                       "agent-registration[<eip7930>][<agentId>]" — "1"
 *
 * view_key_encrypted  Encrypted blob of the agent's ERC-5564 view private key.
 *                     Plan 4 implements the encryption/decryption layer; this
 *                     plan persists the field as a nullable text column.
 *                     Null until the dev completes wizard step 2 (key derivation).
 *
 * treasury_safe_address  Address of the agent's consolidation Safe (deployed
 *                        during wizard step 4). Null until that step completes.
 *
 * is_active           Soft-delete flag. Inactive agents are excluded from
 *                     gateway lookups and API responses.
 */
export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Identity
  ownerEoa: text('owner_eoa').notNull(),
  agentId: text('agent_id').unique(),
  agentWalletEoa: text('agent_wallet_eoa'),
  subnameLabel: text('subname_label').notNull().unique(),

  // Gateway resolution
  baseAddr: text('base_addr').notNull(),
  textRecords: jsonb('text_records').$type<Record<string, string>>().notNull().default({}),

  // Stealth crypto (Plan 4 fills in the encryption wrapper)
  viewKeyEncrypted: text('view_key_encrypted'),

  // Onboarding completion
  treasurySafeAddress: text('treasury_safe_address'),
  isActive: boolean('is_active').notNull().default(true),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Agent = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert

/**
 * gateway_announcements — one row per stealth payment address the gateway hands out.
 *
 * agent_id              FK (uuid) into agents.id (NOT the on-chain ERC-8004 agentId).
 *
 * stealth_address       The stealth **EOA**. Derived per-query via ECDH from the
 *                       agent's stealth meta-address. The receiver re-derives
 *                       the matching private key from spendPriv + ephemeralPub
 *                       to sign sweep transactions later.
 *
 * stealth_safe_address  The CREATE2 address of a 1-of-1 Safe v1.3.0 owned by
 *                       stealth_address. This is what the gateway returns as
 *                       the addr() answer — payments arrive here. Nullable for
 *                       backward-compat with pre-Path-B rows that only stored
 *                       the EOA. NEW rows always populate it.
 *
 * ephemeral_pub         33-byte compressed secp256k1 pubkey R = r·G.
 * view_tag              First byte of keccak256(sharedSecret) for cheap pre-filtering.
 * generated_at          When the gateway wrote the row.
 * paid_at               Set when a payment is detected for this stealth address.
 *                       NULL = "current" — the gateway returns this address for new
 *                       queries. Non-NULL = paid; the gateway will derive a fresh
 *                       stealth address on the next query and write a new row.
 */
export const gatewayAnnouncements = pgTable(
  'gateway_announcements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    stealthAddress: text('stealth_address').notNull(),
    stealthSafeAddress: text('stealth_safe_address'),
    ephemeralPub: text('ephemeral_pub').notNull(),
    viewTag: integer('view_tag').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (table) => ({
    byAgent: index('gateway_announcements_agent_idx').on(table.agentId, table.generatedAt),
    uniqueEph: uniqueIndex('gateway_announcements_agent_eph_unq').on(
      table.agentId,
      table.ephemeralPub,
    ),
    bySafe: index('gateway_announcements_safe_idx').on(table.stealthSafeAddress),
  }),
)

export type GatewayAnnouncement = typeof gatewayAnnouncements.$inferSelect
export type NewGatewayAnnouncement = typeof gatewayAnnouncements.$inferInsert

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
 *                   Stored lowercased so equality checks are deterministic.
 *
 * ephemeral_pub     33-byte compressed secp256k1 ephemeral pubkey from the
 *                   gateway issuance. Denormalized so the dashboard does not
 *                   need to join gateway_announcements just to render a row.
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
 *                   v1: always Base USDC (0x833589fCD…).
 *
 * amount            Raw token units (numeric(78,0) accommodates uint256).
 *                   USDC has 6 decimals; the dashboard formats display-side.
 *
 * from_address      The Transfer.from address; surfaced in the dashboard
 *                   as the "sender" and used by Plan 7 receipts.
 *
 * detected_at       Server-side timestamp of when the scanner inserted the
 *                   row. Distinct from block timestamp.
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
 * happen from the dashboard (POST /agents/:id/receipts/:paymentId/confirm).
 *
 * confirmed_by_recipient  The toggle the agent owner flips in the UI. Plan 5
 *                         only persists this flag locally; Plan 7 broadcasts
 *                         appendResponse on-chain when it flips to true.
 *
 * eip712_payload          Stringified EIP-712 typed data the dashboard built
 *                         when the toggle was flipped.
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
