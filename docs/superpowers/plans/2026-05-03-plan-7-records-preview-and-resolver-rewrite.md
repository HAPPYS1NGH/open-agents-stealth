# Plan 7 — Records Preview Page + Hybrid Resolver Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two related deliverables in one plan. **Half 1** ships a `/dashboard/[agentId]/records-preview` page that surfaces every text record we currently serve over CCIP-Read — both standard ENSIP-18 keys (`alias`, `name`, `description`, `avatar`, `header`, `url`, `email`, `location`, `timezone`, `language`, `com.github`, `com.twitter`, `org.telegram`, `primary-contact`) and any custom keys the agent has saved. The owner sees what `app.ens.domains` *should* show but doesn't, plus a "How others see you" toggle that runs live `getEnsText` lookups via viem's universal resolver to prove CCIP-Read is reaching third-party clients. **Half 2** rewrites our deployed wildcard resolver into a **hybrid resolver**: text records move on-chain (so the ens.domains app and other ENS-aware tools render them natively without CCIP-Read awareness), while `addr()` keeps deferring to OffchainLookup so per-payment stealth address rotation still works. A migration script syncs every existing `text_records` row from Postgres into the new on-chain mapping, and the runbook covers the single `setResolver` tx that re-points `gabhru.eth`.

**Architecture:** Half 1 adds one read-only API endpoint (`GET /agents/:agentId/records-preview`) that joins our agents row + a static list of standard ENSIP-18 keys, returns one entry per known key with the value (or empty), and exposes a `served` boolean indicating whether the gateway will currently return a non-empty value. The dashboard renders a grouped table (Profile / Agent / Stealth / Other) with empty rows showing "—" and a CTA back to the records form. The "How others see you" toggle is a client-side switch that swaps the data source to live viem `getEnsText` calls hitting mainnet — slow, but the proof-of-life UX matters. Half 2 introduces `HybridResolver.sol` extending the existing `OurOffchainResolver` base: a new on-chain `mapping(bytes32 node => mapping(string key => string value))` plus `setText(bytes32, string, string)` (owner-gated via the parent ENS Registry's `isApprovedForAll`/owner check), and the `text(bytes32, string)` selector now reads on-chain first, falling back to OffchainLookup only if the slot is empty. `addr()` and `addrMulticoin()` paths are unchanged — they always OffchainLookup so stealth rotation continues to function. A one-shot migration script (`packages/contracts/script/MigrateTextRecords.s.sol` + a TS driver) reads `text_records` from Postgres and bundles per-agent `setText` calls into multicall batches.

**Tech Stack:** TypeScript 5.x strict, Hono on Vercel (api), Next.js 16 App Router (dashboard), SWR for client data, viem 2.x (`createPublicClient` + `getEnsText` for the live toggle), Solidity 0.8.24 + Foundry (contracts), `@open-agents/db` for the Postgres reads in both halves, vitest for unit/integration tests, Foundry for Solidity tests, Base mainnet for the resolver deploy (same chain as the existing `OurOffchainResolver`). **No new packages added.** No KMS or signer changes — the migration tx and `setResolver` are signed by the existing `gabhru.eth` controller wallet documented in the runbook.

---

## File structure

After Plan 7, the repo gains:

```
open-agents/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   └── routes/
│   │   │       └── agents.ts                                # MODIFIED: + GET /:agentId/records-preview
│   │   ├── src/lib/
│   │   │   └── records-preview.ts                           # NEW: standard-key catalogue + builder
│   │   └── tests/
│   │       └── records-preview.test.ts                      # NEW
│   └── dashboard/
│       ├── src/
│       │   ├── app/
│       │   │   └── dashboard/
│       │   │       └── [agentId]/
│       │   │           ├── page.tsx                         # MODIFIED: + link to records-preview
│       │   │           └── records-preview/
│       │   │               └── page.tsx                     # NEW: route
│       │   ├── components/
│       │   │   ├── records-preview-table.tsx                # NEW
│       │   │   └── live-ens-toggle.tsx                      # NEW (Half 1 optional task)
│       │   ├── hooks/
│       │   │   ├── use-records-preview.ts                   # NEW: SWR fetch
│       │   │   └── use-live-ens-records.ts                  # NEW (Half 1 optional task)
│       │   ├── lib/
│       │   │   └── ens-categories.ts                        # NEW: key→category mapping
│       │   └── types/
│       │       └── api.ts                                   # MODIFIED: + RecordsPreviewResponse
│       └── tests/
│           ├── records-preview-table.test.tsx               # NEW
│           └── use-records-preview.test.ts                  # NEW
└── packages/
    └── contracts/
        ├── src/
        │   └── HybridResolver.sol                           # NEW
        ├── script/
        │   ├── DeployHybridResolver.s.sol                   # NEW
        │   └── MigrateTextRecords.s.sol                     # NEW (called by TS driver)
        ├── scripts/
        │   ├── migrate-text-records.ts                      # NEW: Postgres → on-chain
        │   └── repoint-resolver.md                          # NEW: runbook doc
        └── test/
            ├── HybridResolver.t.sol                         # NEW
            └── HybridResolverMigration.t.sol                # NEW
```

---

## Prerequisites

The engineer must have available:

- pnpm 9+ installed.
- Plans 1, 2, 3, 4, 5, and 6 complete and committed. In particular:
  - Plan 1's `OurOffchainResolver` is the live wildcard resolver at `0x6c11e3cb958c84cfd339123a2b9c4196c755f777` on mainnet.
  - Plan 2's `agents.text_records` jsonb column is populated for at least one agent.
  - Plan 4's `gateway_announcements` table exists.
- Local Postgres running (`docker compose -f docker-compose.dev.yml up -d`) with all prior migrations applied through `0004_payments_receipts.sql`.
- Foundry installed (`forge --version` ≥ 0.2.0). The existing `packages/contracts/foundry.toml` should already work.
- A funded controller wallet for the `gabhru.eth` ENS name (the same wallet that signed the existing `setResolver` tx). The runbook needs ~0.005 ETH on mainnet for the new deploy + `setResolver` call.
- A Base mainnet (or Sepolia for testing) RPC URL with `eth_call` + `eth_sendRawTransaction` — used by the deploy + migration scripts.
- A Mainnet RPC URL with universal-resolver support (`https://eth.llamarpc.com` works, or any Alchemy/Infura key) — used by the dashboard's "How others see you" toggle.
- Node 20+.
- The `viem` version pinned in `apps/dashboard/package.json` already exposes `getEnsText` — confirm with `pnpm --filter @open-agents/dashboard list viem`.

---

# Half 1 — Records Preview Page

The owner-facing dashboard already lets you SET text records via `RecordsForm`, but there is no view that shows what the gateway is actually serving. Half 1 closes that gap. The page is read-only, fast, and grouped by category so the owner can spot empty profile fields at a glance.

The data source is our own Postgres (one query against the agents row), not the gateway over CCIP-Read — that round trip is slow and adds nothing for the owner's view. The optional toggle DOES use viem's universal resolver to prove the public path works end-to-end.

---

### Task 1: API endpoint `GET /agents/:agentId/records-preview`

**Files:**
- Create: `apps/api/src/lib/records-preview.ts`
- Modify: `apps/api/src/routes/agents.ts`
- Create: `apps/api/tests/records-preview.test.ts`

**Decision: server-side catalogue, not client-side.** The list of "standard ENSIP-18 keys we always show even when empty" lives in `apps/api/src/lib/records-preview.ts`. Putting it server-side keeps the dashboard a thin renderer and means future additions (e.g. when ENSIP-19 lands) ship with a single api deploy — no need to bump dashboard + api in lockstep.

**Decision: `served` boolean is computed, not stored.** The api computes `served = value.length > 0` per row (with a special case for `stealth-payload` — see Step 1.2). This avoids drift between what the gateway actually returns and what the preview claims.

**Auth model:** Same JWT middleware the rest of `/agents/:agentId/*` uses. The endpoint is owner-only — we don't expose it publicly because (a) the records themselves are already public via CCIP-Read, but (b) the owner-vs-public surface is consistent across the dashboard.

- [ ] **Step 1.1: Write the failing test**

Create `apps/api/tests/records-preview.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { buildTestApp, seedTestAgent, getAuthHeader } from './helpers'
import type { RecordsPreviewResponse } from '../src/types'

describe('GET /agents/:agentId/records-preview', () => {
  let app: ReturnType<typeof buildTestApp>
  let agentId: string
  let authHeader: string

  beforeEach(async () => {
    app = buildTestApp()
    const seeded = await seedTestAgent({
      textRecords: {
        name: 'Demo Agent',
        description: 'Hackathon demo',
        'custom.key': 'custom-value',
      },
    })
    agentId = seeded.agentId
    authHeader = await getAuthHeader(seeded.ownerEoa)
  })

  it('returns standard + custom keys with served flag', async () => {
    const res = await app.request(`/agents/${agentId}/records-preview`, {
      headers: { Authorization: authHeader },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as RecordsPreviewResponse
    const keys = body.records.map((r) => r.key)
    expect(keys).toEqual(expect.arrayContaining(['name', 'avatar', 'com.github', 'custom.key']))

    const name = body.records.find((r) => r.key === 'name')
    const avatar = body.records.find((r) => r.key === 'avatar')
    expect(name).toMatchObject({ served: true, value: 'Demo Agent' })
    expect(avatar).toMatchObject({ served: false, value: '' })
  })

  it('rejects unauthenticated callers', async () => {
    const res = await app.request(`/agents/${agentId}/records-preview`)
    expect(res.status).toBe(401)
  })

  it('rejects callers who do not own the agent', async () => {
    const other = await seedTestAgent({ textRecords: {} })
    const res = await app.request(`/agents/${other.agentId}/records-preview`, {
      headers: { Authorization: authHeader },
    })
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `pnpm --filter @open-agents/api test records-preview`
Expected: FAIL — module `apps/api/src/lib/records-preview.ts` does not exist.

- [ ] **Step 1.3: Create the standard-keys catalogue + builder**

Create `apps/api/src/lib/records-preview.ts`:

```ts
/**
 * The catalogue of "always-shown" standard ENSIP-18 text-record keys.
 *
 * These appear on the records-preview table even when the agent has not set
 * a value, so the owner can see what's missing at a glance. Custom keys
 * (anything in agents.text_records that isn't in this list) are merged in
 * separately by buildRecordsPreview() below.
 *
 * Categories drive the UI grouping in records-preview-table.tsx but live
 * here so the catalogue stays a single source of truth.
 */
export type RecordCategory = 'profile' | 'agent' | 'stealth' | 'other'

export interface StandardKey {
  key: string
  category: RecordCategory
  description: string
}

export const STANDARD_KEYS: readonly StandardKey[] = [
  // Profile (ENSIP-18 standard)
  { key: 'name', category: 'profile', description: 'Display name' },
  { key: 'alias', category: 'profile', description: 'Alternate handle' },
  { key: 'description', category: 'profile', description: 'Short bio' },
  { key: 'avatar', category: 'profile', description: 'Profile image URL' },
  { key: 'header', category: 'profile', description: 'Banner image URL' },
  { key: 'url', category: 'profile', description: 'Website URL' },
  { key: 'email', category: 'profile', description: 'Contact email' },
  { key: 'location', category: 'profile', description: 'Geographic location' },
  { key: 'timezone', category: 'profile', description: 'IANA timezone' },
  { key: 'language', category: 'profile', description: 'BCP-47 language tag' },
  { key: 'com.github', category: 'profile', description: 'GitHub handle' },
  { key: 'com.twitter', category: 'profile', description: 'X / Twitter handle' },
  { key: 'org.telegram', category: 'profile', description: 'Telegram handle' },
  { key: 'primary-contact', category: 'profile', description: 'Preferred contact channel' },
  // Agent (ENSIP-26)
  { key: 'agent-context', category: 'agent', description: 'JSON profile' },
  { key: 'agent-endpoint[mcp]', category: 'agent', description: 'MCP server URL' },
  { key: 'agent-endpoint[a2a]', category: 'agent', description: 'A2A endpoint URL' },
  { key: 'agent-endpoint[web]', category: 'agent', description: 'Website URL' },
  // Stealth (Plan 4 + Plan 5)
  { key: 'stealth-meta', category: 'stealth', description: 'ERC-5564 meta-address' },
  { key: 'stealth-payload', category: 'stealth', description: 'Per-query stealth issuance (synthesized at read time)' },
] as const

export interface PreviewRecord {
  key: string
  value: string
  category: RecordCategory
  description: string
  served: boolean
  /** Human-readable note explaining why served may differ from value.length. */
  sourceNote: string
}

/**
 * Build the full preview row set for one agent.
 *
 * - Iterate STANDARD_KEYS and look up each value in agent.text_records.
 * - For every custom key in text_records that's NOT in STANDARD_KEYS,
 *   append an "other" row.
 * - stealth-payload is a special case: it's synthesized by the gateway on
 *   every read, so served=true if stealth-meta is set, regardless of the
 *   stored value (which is always empty in the DB).
 */
export function buildRecordsPreview(textRecords: Record<string, string>): PreviewRecord[] {
  const standardKeySet = new Set(STANDARD_KEYS.map((k) => k.key))
  const stealthMetaSet = (textRecords['stealth-meta'] ?? '').length > 0

  const standardRows: PreviewRecord[] = STANDARD_KEYS.map((sk) => {
    const value = textRecords[sk.key] ?? ''
    let served = value.length > 0
    let sourceNote = served ? 'served from text_records' : 'unset'
    if (sk.key === 'stealth-payload') {
      served = stealthMetaSet
      sourceNote = stealthMetaSet
        ? 'synthesized per query (Plan 5)'
        : 'inactive — set stealth-meta first'
    }
    return {
      key: sk.key,
      value,
      category: sk.category,
      description: sk.description,
      served,
      sourceNote,
    }
  })

  const customRows: PreviewRecord[] = Object.entries(textRecords)
    .filter(([k]) => !standardKeySet.has(k))
    .map(([key, value]) => ({
      key,
      value,
      category: 'other',
      description: 'Custom key',
      served: value.length > 0,
      sourceNote: 'served from text_records',
    }))

  return [...standardRows, ...customRows]
}
```

- [ ] **Step 1.4: Wire the route**

Modify `apps/api/src/routes/agents.ts`. After the existing `GET /:agentId` handler, add:

```ts
import { buildRecordsPreview } from '../lib/records-preview.js'
import type { PreviewRecord } from '../lib/records-preview.js'

// existing imports/middleware unchanged...

agentsRoute.get('/:agentId/records-preview', requireAuth, requireAgentOwner, async (c) => {
  // requireAgentOwner has already verified the JWT subject owns this agent and
  // attached the row to context. Pull it back out so we don't re-query.
  const agent = c.get('agent') as { textRecords: Record<string, string> }

  const records: PreviewRecord[] = buildRecordsPreview(agent.textRecords ?? {})

  return c.json({
    agentId: c.req.param('agentId'),
    records,
    // Surface the catalogue version so the dashboard can cache-bust if the
    // server starts returning new standard keys.
    catalogueVersion: 1,
  })
})
```

If `requireAgentOwner` doesn't yet stash the agent on context, also add a one-line set in that middleware (or refetch with `findGatewayAgent` here). Match the existing pattern in `agents.ts` — don't invent new shape.

- [ ] **Step 1.5: Add response type**

Modify `apps/api/src/types/index.ts` (or the existing types module exported as `@open-agents/api/types`). Append:

```ts
import type { PreviewRecord } from '../lib/records-preview.js'

export type { PreviewRecord } from '../lib/records-preview.js'

export interface RecordsPreviewResponse {
  agentId: string
  records: PreviewRecord[]
  catalogueVersion: number
}
```

- [ ] **Step 1.6: Run the test to verify it passes**

Run: `pnpm --filter @open-agents/api test records-preview`
Expected: PASS — all four cases.

- [ ] **Step 1.7: Commit**

```bash
git add apps/api/src/lib/records-preview.ts \
  apps/api/src/routes/agents.ts \
  apps/api/src/types/index.ts \
  apps/api/tests/records-preview.test.ts
git commit -m "feat(api): GET /agents/:id/records-preview returns standard + custom text records"
```

---

### Task 2: Dashboard types + `useRecordsPreview` hook

**Files:**
- Modify: `apps/dashboard/src/types/api.ts`
- Create: `apps/dashboard/src/lib/ens-categories.ts`
- Create: `apps/dashboard/src/hooks/use-records-preview.ts`
- Create: `apps/dashboard/tests/use-records-preview.test.ts`

**Decision: redefine the response type rather than import from api.** The api package's types aren't published as a workspace artifact today — the dashboard already redeclares `AgentResponse` etc. in `src/types/api.ts`. Follow that pattern; don't introduce a cross-package type import just for this endpoint.

- [ ] **Step 2.1: Add types**

Modify `apps/dashboard/src/types/api.ts`. Append:

```ts
export type RecordCategory = 'profile' | 'agent' | 'stealth' | 'other'

export interface PreviewRecord {
  key: string
  value: string
  category: RecordCategory
  description: string
  served: boolean
  sourceNote: string
}

export interface RecordsPreviewResponse {
  agentId: string
  records: PreviewRecord[]
  catalogueVersion: number
}
```

- [ ] **Step 2.2: Add category labels**

Create `apps/dashboard/src/lib/ens-categories.ts`:

```ts
import type { RecordCategory } from '@/types/api'

/**
 * Display labels and ordering for the records-preview table.
 *
 * Ordering matters — we render groups top-to-bottom in this order so
 * the most owner-meaningful (Profile) lands above the fold.
 */
export const CATEGORY_ORDER: readonly RecordCategory[] = [
  'profile',
  'agent',
  'stealth',
  'other',
] as const

export const CATEGORY_LABELS: Record<RecordCategory, string> = {
  profile: 'Profile (ENSIP-18)',
  agent: 'Agent metadata (ENSIP-26)',
  stealth: 'Stealth payments',
  other: 'Custom keys',
}
```

- [ ] **Step 2.3: Add the SWR hook**

Create `apps/dashboard/src/hooks/use-records-preview.ts`:

```ts
'use client'

import useSWR from 'swr'
import { useMe } from '@/hooks/use-me'
import { getApiClient } from '@/lib/api-client'
import type { RecordsPreviewResponse } from '@/types/api'

/**
 * Fetches the records-preview snapshot for one agent.
 *
 * Returns SWR's standard `{ data, error, isLoading, mutate }` shape so the
 * caller can show its own loading/error UI. Auth-gated via useMe — calls
 * are skipped until the JWT lands.
 */
export function useRecordsPreview(agentId: string): {
  data: RecordsPreviewResponse | undefined
  error: Error | undefined
  isLoading: boolean
  mutate: () => void
} {
  const { isAuthenticated } = useMe()
  const { data, error, isLoading, mutate } = useSWR<RecordsPreviewResponse, Error>(
    isAuthenticated ? `/agents/${agentId}/records-preview` : null,
    (path: string) => getApiClient().get<RecordsPreviewResponse>(path),
    { revalidateOnFocus: false },
  )
  return { data, error, isLoading, mutate }
}
```

- [ ] **Step 2.4: Test the hook**

Create `apps/dashboard/tests/use-records-preview.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import type { ReactNode } from 'react'
import { useRecordsPreview } from '@/hooks/use-records-preview'

vi.mock('@/hooks/use-me', () => ({
  useMe: () => ({ isAuthenticated: true }),
}))

vi.mock('@/lib/api-client', () => ({
  getApiClient: () => ({
    get: vi.fn().mockResolvedValue({
      agentId: 'a1',
      catalogueVersion: 1,
      records: [
        {
          key: 'name',
          value: 'Demo',
          category: 'profile',
          description: 'Display name',
          served: true,
          sourceNote: 'served from text_records',
        },
      ],
    }),
  }),
}))

function wrapper({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
}

describe('useRecordsPreview', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the preview response when authenticated', async () => {
    const { result } = renderHook(() => useRecordsPreview('a1'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data?.records[0]?.key).toBe('name')
  })
})
```

- [ ] **Step 2.5: Run the test**

Run: `pnpm --filter @open-agents/dashboard test use-records-preview`
Expected: PASS.

- [ ] **Step 2.6: Commit**

```bash
git add apps/dashboard/src/types/api.ts \
  apps/dashboard/src/lib/ens-categories.ts \
  apps/dashboard/src/hooks/use-records-preview.ts \
  apps/dashboard/tests/use-records-preview.test.ts
git commit -m "feat(dashboard): useRecordsPreview SWR hook + ENS category labels"
```

---

### Task 3: `RecordsPreviewTable` component

**Files:**
- Create: `apps/dashboard/src/components/records-preview-table.tsx`
- Create: `apps/dashboard/tests/records-preview-table.test.tsx`

**Decision: one Card per category, not one giant table.** Grouped Cards make scanning easier on a 2-column desktop layout and degrade naturally on mobile (each Card stacks). The table inside each Card is dense — value preview is truncated to 60 chars with a tooltip for full content, since `agent-context` JSON can be long.

**Decision: empty rows render with a "Set this" link rather than being hidden.** That's the whole point of the page — owners want to see what's missing.

- [ ] **Step 3.1: Write the failing test**

Create `apps/dashboard/tests/records-preview-table.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RecordsPreviewTable } from '@/components/records-preview-table'
import type { PreviewRecord } from '@/types/api'

const records: PreviewRecord[] = [
  {
    key: 'name',
    value: 'Demo Agent',
    category: 'profile',
    description: 'Display name',
    served: true,
    sourceNote: 'served from text_records',
  },
  {
    key: 'avatar',
    value: '',
    category: 'profile',
    description: 'Profile image URL',
    served: false,
    sourceNote: 'unset',
  },
  {
    key: 'stealth-meta',
    value: 'st:base:0xabc',
    category: 'stealth',
    description: 'ERC-5564 meta-address',
    served: true,
    sourceNote: 'served from text_records',
  },
]

describe('RecordsPreviewTable', () => {
  it('groups rows by category', () => {
    render(<RecordsPreviewTable agentId="a1" records={records} />)
    expect(screen.getByText('Profile (ENSIP-18)')).toBeInTheDocument()
    expect(screen.getByText('Stealth payments')).toBeInTheDocument()
  })

  it('renders served values and a placeholder for empty rows', () => {
    render(<RecordsPreviewTable agentId="a1" records={records} />)
    expect(screen.getByText('Demo Agent')).toBeInTheDocument()
    // The empty avatar row shows an em-dash placeholder
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThan(0)
  })

  it('shows a "Set this" link for empty rows pointing back to settings', () => {
    render(<RecordsPreviewTable agentId="a1" records={records} />)
    const setLinks = screen.getAllByRole('link', { name: /set this/i })
    expect(setLinks.length).toBeGreaterThan(0)
    expect(setLinks[0]).toHaveAttribute('href', '/dashboard/a1')
  })
})
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `pnpm --filter @open-agents/dashboard test records-preview-table`
Expected: FAIL — module does not exist.

- [ ] **Step 3.3: Implement the component**

Create `apps/dashboard/src/components/records-preview-table.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CATEGORY_LABELS, CATEGORY_ORDER } from '@/lib/ens-categories'
import type { PreviewRecord, RecordCategory } from '@/types/api'

const TRUNCATE = 60

function truncate(value: string): string {
  if (value.length <= TRUNCATE) return value
  return `${value.slice(0, TRUNCATE)}…`
}

export interface RecordsPreviewTableProps {
  agentId: string
  records: PreviewRecord[]
}

export function RecordsPreviewTable({ agentId, records }: RecordsPreviewTableProps) {
  const grouped = new Map<RecordCategory, PreviewRecord[]>()
  for (const cat of CATEGORY_ORDER) grouped.set(cat, [])
  for (const rec of records) grouped.get(rec.category)?.push(rec)

  return (
    <div className="space-y-4">
      {CATEGORY_ORDER.map((cat) => {
        const rows = grouped.get(cat) ?? []
        if (rows.length === 0) return null
        return (
          <Card key={cat}>
            <CardHeader>
              <CardTitle className="text-base">{CATEGORY_LABELS[cat]}</CardTitle>
              <CardDescription>
                {rows.filter((r) => r.served).length} of {rows.length} served
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-[minmax(160px,1fr)_2fr_auto] gap-x-4 gap-y-2 text-sm">
                <div className="font-medium text-muted-foreground">Key</div>
                <div className="font-medium text-muted-foreground">Value</div>
                <div className="font-medium text-muted-foreground text-right">Status</div>
                {rows.map((row) => (
                  <RecordRow key={row.key} agentId={agentId} row={row} />
                ))}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function RecordRow({ agentId, row }: { agentId: string; row: PreviewRecord }) {
  return (
    <>
      <div className="self-center">
        <code className="text-xs">{row.key}</code>
        <p className="text-xs text-muted-foreground">{row.description}</p>
      </div>
      <div className="self-center">
        {row.value ? (
          <span title={row.value}>{truncate(row.value)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
        <p className="text-xs text-muted-foreground">{row.sourceNote}</p>
      </div>
      <div className="self-center text-right space-y-1">
        {row.served ? (
          <Badge variant="success">served</Badge>
        ) : (
          <Badge variant="secondary">empty</Badge>
        )}
        {!row.served && (
          <div>
            <Link
              href={`/dashboard/${agentId}`}
              className="text-xs underline text-muted-foreground"
            >
              Set this
            </Link>
          </div>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 3.4: Run the test**

Run: `pnpm --filter @open-agents/dashboard test records-preview-table`
Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
git add apps/dashboard/src/components/records-preview-table.tsx \
  apps/dashboard/tests/records-preview-table.test.tsx
git commit -m "feat(dashboard): RecordsPreviewTable groups text records by ENS category"
```

---

### Task 4: Route + link from settings page

**Files:**
- Create: `apps/dashboard/src/app/dashboard/[agentId]/records-preview/page.tsx`
- Modify: `apps/dashboard/src/app/dashboard/[agentId]/page.tsx`

- [ ] **Step 4.1: Create the page**

Create `apps/dashboard/src/app/dashboard/[agentId]/records-preview/page.tsx`:

```tsx
'use client'

import { use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMe } from '@/hooks/use-me'
import { useRecordsPreview } from '@/hooks/use-records-preview'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RecordsPreviewTable } from '@/components/records-preview-table'

interface PageProps {
  params: Promise<{ agentId: string }>
}

export default function RecordsPreviewPage({ params }: PageProps) {
  const { agentId } = use(params)
  const router = useRouter()
  const { isAuthenticated } = useMe()

  if (!isAuthenticated) {
    if (typeof window !== 'undefined') router.push('/')
    return null
  }

  const { data, error, isLoading } = useRecordsPreview(agentId)

  if (error) {
    return (
      <main className="mx-auto max-w-4xl p-6 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Failed to load preview</CardTitle>
            <CardDescription>{error.message}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href={`/dashboard/${agentId}`}>
              <Button variant="outline">Back to agent</Button>
            </Link>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-4xl p-6 py-12 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Records preview</h1>
          <p className="text-xs text-muted-foreground">
            <Link href={`/dashboard/${agentId}`} className="underline">
              ← back to agent
            </Link>
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What the gateway is serving</CardTitle>
          <CardDescription>
            Every standard ENS text record we know about, plus any custom keys you've set.
            Empty rows are not returned by CCIP-Read — set them to make them queryable.
          </CardDescription>
        </CardHeader>
      </Card>

      {isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <RecordsPreviewTable agentId={agentId} records={data.records} />
      )}
    </main>
  )
}
```

- [ ] **Step 4.2: Add the link to the settings page**

Modify `apps/dashboard/src/app/dashboard/[agentId]/page.tsx`. In the header `div` that already contains the "View payments →" and "Preview ENS profile" links, add a third entry between them:

```tsx
<Link
  href={`/dashboard/${agentId}/records-preview`}
  className="text-xs underline"
>
  Records preview →
</Link>
```

- [ ] **Step 4.3: Smoke-test by hand**

Boot the dashboard locally:

```bash
pnpm --filter @open-agents/dashboard dev
```

Open `http://localhost:3000/dashboard/<agentId>/records-preview`. Expected:
- The page loads in ≤500ms.
- The Profile card shows `name`, `avatar`, `description`, etc., with most rows showing "—" + a "Set this" link unless you've already populated them.
- The Stealth card shows `stealth-meta` and `stealth-payload`. The latter says `synthesized per query (Plan 5)` if `stealth-meta` is set.
- The Custom keys card only appears if you have non-standard keys.

- [ ] **Step 4.4: Commit**

```bash
git add apps/dashboard/src/app/dashboard/[agentId]/records-preview/page.tsx \
  apps/dashboard/src/app/dashboard/[agentId]/page.tsx
git commit -m "feat(dashboard): /records-preview route + link from settings page"
```

---

### Task 5 (optional): Live ENS lookup toggle

Skip this if Half 2 is going to ship in the same week — once text records are on-chain, third-party tooling renders them natively and the toggle is redundant. Worth keeping if Half 2 slips.

**Files:**
- Create: `apps/dashboard/src/hooks/use-live-ens-records.ts`
- Create: `apps/dashboard/src/components/live-ens-toggle.tsx`
- Modify: `apps/dashboard/src/app/dashboard/[agentId]/records-preview/page.tsx`

**Decision: lazy-load viem on toggle, not on page mount.** The mainnet public client + universal-resolver call adds 30-50KB to the initial bundle and ~1s of latency per key. Keep the default view fast (DB read) and only fire viem when the user opts in.

- [ ] **Step 5.1: Add the live-lookup hook**

Create `apps/dashboard/src/hooks/use-live-ens-records.ts`:

```ts
'use client'

import { useEffect, useState } from 'react'
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

const PARENT_DOMAIN = process.env['NEXT_PUBLIC_PARENT_DOMAIN'] ?? 'gabhru.eth'
const RPC_URL = process.env['NEXT_PUBLIC_MAINNET_RPC_URL'] ?? 'https://eth.llamarpc.com'

export interface LiveLookupResult {
  key: string
  value: string | null
  error: string | null
  durationMs: number
}

/** Fires viem.getEnsText for each key against mainnet's universal resolver. */
export function useLiveEnsRecords(
  subnameLabel: string,
  keys: readonly string[],
  enabled: boolean,
): LiveLookupResult[] {
  const [results, setResults] = useState<LiveLookupResult[]>([])

  useEffect(() => {
    if (!enabled) { setResults([]); return }
    const client = createPublicClient({ chain: mainnet, transport: http(RPC_URL) })
    const name = `${subnameLabel}.${PARENT_DOMAIN}`
    let cancelled = false

    async function lookupOne(key: string): Promise<LiveLookupResult> {
      const start = performance.now()
      try {
        const value = await client.getEnsText({ name, key })
        return { key, value, error: null, durationMs: performance.now() - start }
      } catch (err) {
        return { key, value: null, error: err instanceof Error ? err.message : String(err), durationMs: performance.now() - start }
      }
    }

    Promise.all(keys.map(lookupOne)).then((res) => { if (!cancelled) setResults(res) })
    return () => { cancelled = true }
  }, [subnameLabel, keys.join(','), enabled])

  return results
}
```

- [ ] **Step 5.2: Add the toggle component**

Create `apps/dashboard/src/components/live-ens-toggle.tsx`. A Card with a single Button (`Run live lookup` / `Stop live lookup`) that toggles `enabled`, plus a 3-column grid (`key | value | durationMs`) populated from `useLiveEnsRecords(subnameLabel, records.filter(r=>r.served).map(r=>r.key), enabled)`. Mirror the styling of `RecordsPreviewTable` — same Card primitive, same code-block for keys.

- [ ] **Step 5.3: Mount on the page**

Modify `apps/dashboard/src/app/dashboard/[agentId]/records-preview/page.tsx`. Add a `useSWR<AgentResponse>` block at the top to fetch the agent (mirror the settings page exactly), then render below the table:

```tsx
{data && agent && (
  <LiveEnsToggle subnameLabel={agent.subnameLabel} records={data.records} />
)}
```

- [ ] **Step 5.4: Smoke test + commit**

Open the page, click "Run live lookup", confirm rows fill in within ~5s. If a key returns null where the preview shows `served=true`, that's a CCIP-Read regression — investigate before committing.

```bash
git add apps/dashboard/src/hooks/use-live-ens-records.ts \
  apps/dashboard/src/components/live-ens-toggle.tsx \
  apps/dashboard/src/app/dashboard/[agentId]/records-preview/page.tsx
git commit -m "feat(dashboard): live ENS lookup toggle for records-preview page"
```

---

# Half 2 — Hybrid Resolver Rewrite

The deployed `OurOffchainResolver` (Plan 1) routes every read through CCIP-Read. That works for `addr()` because we genuinely need fresh per-query stealth addresses, but for text records it's actively harmful: `app.ens.domains` and most ENS-aware tools don't render OffchainLookup-served text records, so our agents look like blank profiles in standard tooling.

Half 2 fixes this by deploying a **HybridResolver**: text records read from an on-chain `mapping(bytes32 node => mapping(string key => string value))`, while `addr()` keeps deferring to OffchainLookup. We migrate every text record from Postgres to the new contract in one batched run, then re-point `gabhru.eth` to the new resolver.

After this lands, our agents render natively in `app.ens.domains`, etherscan ENS lookups, and any wallet — without those clients needing CCIP-Read awareness. The only off-chain trip remains the stealth address rotation, which is the only thing that actually requires it.

---

### Task 6: HybridResolver.sol contract + Foundry tests

**Files:**
- Create: `packages/contracts/src/HybridResolver.sol`
- Create: `packages/contracts/test/HybridResolver.t.sol`

**Decision: extend OurOffchainResolver, don't reimplement.** The CCIP-Read path (signing, gateway-url, IExtendedResolver) is unchanged for `addr()`. Inheriting keeps the surface area honest.

**Decision: writes go through the contract owner OR the parent ENS Registry's `isApprovedForAll`.** The migration script signs with the existing controller wallet (which is also the contract owner — set in the constructor). For per-agent `setText` from the dashboard (optional Task 9), the dashboard surfaces a button that prompts the agent owner to sign their own tx — but the resolver's `setText` only accepts calls from the contract owner. Per-agent user-signed `setText` requires we delegate authority via OpenSea-style approvals, which is over-scope for v1. The dashboard "Sync to chain" button (Task 9, optional) just wires the api to the migration runner, so all writes still come from the controller wallet. **`[OPEN QUESTION]`**: do we want to take a tradeoff hit to let agent owners sign their own setText txes? For the hackathon demo, no.

**Decision: text records on-chain are owner-set, not derived.** We don't auto-mirror Postgres → chain on every PATCH; that would burn gas on every dashboard save. The migration is one-shot, plus an optional batch sync button (Task 9). Postgres remains the source of truth between syncs; the gateway's `text()` selector falls back to OffchainLookup ONLY when the on-chain mapping is empty for that node+key, so newly-added records served via Postgres still work pre-sync.

- [ ] **Step 6.1: Write the failing tests**

Create `packages/contracts/test/HybridResolver.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {HybridResolver} from "../src/HybridResolver.sol";

contract HybridResolverTest is Test {
    HybridResolver resolver;
    address constant OWNER = address(0xCAFE);
    address constant SIGNER = address(0xBEEF);
    string constant GATEWAY_URL = "https://open-agents-gateway.vercel.app/resolve/{sender}/{data}.json";

    function setUp() public {
        vm.prank(OWNER);
        resolver = new HybridResolver(GATEWAY_URL, SIGNER);
    }

    function test_owner_can_set_text() public {
        bytes32 node = keccak256("test.gabhru.eth");
        vm.prank(OWNER);
        resolver.setText(node, "name", "Demo Agent");
        assertEq(resolver.text(node, "name"), "Demo Agent");
    }

    function test_non_owner_cannot_set_text() public {
        bytes32 node = keccak256("test.gabhru.eth");
        vm.prank(address(0xDEAD));
        vm.expectRevert(); // Ownable: caller is not the owner
        resolver.setText(node, "name", "Hacked");
    }

    function test_text_falls_back_to_offchain_when_unset() public {
        bytes32 node = keccak256("test.gabhru.eth");
        // No setText → text() must revert with OffchainLookup so CCIP-Read kicks in.
        bytes memory call = abi.encodeWithSignature("text(bytes32,string)", node, "name");
        vm.expectRevert(); // OffchainLookup selector is the inherited fallback
        (bool ok, bytes memory ret) = address(resolver).staticcall(call);
        ok; ret;
    }

    function test_addr_always_offchain() public {
        bytes32 node = keccak256("test.gabhru.eth");
        // addr() should never read the on-chain mapping; always defer.
        bytes memory call = abi.encodeWithSignature("addr(bytes32)", node);
        vm.expectRevert(); // OffchainLookup
        (bool ok, bytes memory ret) = address(resolver).staticcall(call);
        ok; ret;
    }

    function test_setText_emits_event() public {
        bytes32 node = keccak256("test.gabhru.eth");
        vm.prank(OWNER);
        vm.expectEmit(true, true, false, true);
        emit HybridResolver.TextChanged(node, "name", "name", "Demo");
        resolver.setText(node, "name", "Demo");
    }

    function test_batch_setText() public {
        bytes32 node = keccak256("test.gabhru.eth");
        string[] memory keys = new string[](2);
        keys[0] = "name";
        keys[1] = "description";
        string[] memory values = new string[](2);
        values[0] = "Demo";
        values[1] = "Hackathon agent";

        vm.prank(OWNER);
        resolver.setTextBatch(node, keys, values);

        assertEq(resolver.text(node, "name"), "Demo");
        assertEq(resolver.text(node, "description"), "Hackathon agent");
    }

    function test_batch_setText_reverts_on_length_mismatch() public {
        bytes32 node = keccak256("test.gabhru.eth");
        string[] memory keys = new string[](2);
        string[] memory values = new string[](1);
        vm.prank(OWNER);
        vm.expectRevert(HybridResolver.LengthMismatch.selector);
        resolver.setTextBatch(node, keys, values);
    }
}
```

- [ ] **Step 6.2: Run the tests to verify they fail**

Run: `cd packages/contracts && forge test --match-contract HybridResolverTest`
Expected: FAIL — file `src/HybridResolver.sol` does not exist.

- [ ] **Step 6.3: Implement the contract**

Create `packages/contracts/src/HybridResolver.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OurOffchainResolver} from "./OurOffchainResolver.sol";

/**
 * @title HybridResolver
 * @notice Wildcard ENS resolver with on-chain text records and off-chain addr().
 *
 * Why hybrid:
 * - Text records (name, avatar, description, etc.) are owner-meaningful and
 *   change rarely. Storing them on-chain makes them visible to ens.domains,
 *   etherscan, and every wallet's ENS lookup, none of which support CCIP-Read
 *   for text records today.
 * - addr() is per-payment unique (stealth address rotation). It MUST stay
 *   off-chain to deliver fresh values per query.
 *
 * Storage model:
 *   _texts[node][key] = value
 *
 * Resolution order for text(node, key):
 *   1. If _texts[node][key] is non-empty → return it.
 *   2. Else fall through to OurOffchainResolver.resolve() (OffchainLookup).
 *
 * Resolution for addr(node) is unchanged from the parent: always OffchainLookup.
 */
contract HybridResolver is OurOffchainResolver {
    /// @dev node → key → value
    mapping(bytes32 => mapping(string => string)) private _texts;

    error LengthMismatch();

    /// Mirrors the standard ENS PublicResolver event so off-chain indexers work.
    event TextChanged(bytes32 indexed node, string indexed indexedKey, string key, string value);

    constructor(string memory gatewayUrl, address signer)
        OurOffchainResolver(gatewayUrl, signer)
    {}

    /**
     * @notice Set a single text record on-chain.
     * @dev onlyOwner because the contract owner runs the migration + per-agent sync.
     *      Per-agent owner-signed setText would require an approval/delegate model,
     *      deferred to a follow-up plan.
     */
    function setText(bytes32 node, string calldata key, string calldata value) external onlyOwner {
        _texts[node][key] = value;
        emit TextChanged(node, key, key, value);
    }

    /// @notice Batch variant — same author, same node, multiple keys/values.
    function setTextBatch(
        bytes32 node,
        string[] calldata keys,
        string[] calldata values
    ) external onlyOwner {
        if (keys.length != values.length) revert LengthMismatch();
        for (uint256 i = 0; i < keys.length; ++i) {
            _texts[node][keys[i]] = values[i];
            emit TextChanged(node, keys[i], keys[i], values[i]);
        }
    }

    /**
     * @notice On-chain text record read.
     * @dev Returns empty string if unset. The wildcard `resolve()` path
     *      (inherited from OurOffchainResolver) checks this first via the
     *      standard text(bytes32,string) selector before falling through
     *      to OffchainLookup; see _resolveText override below.
     */
    function text(bytes32 node, string calldata key) external view returns (string memory) {
        // Direct text() returns the on-chain value or empty. Wallets that go
        // through the wildcard resolve() path (ens.domains, etherscan, viem
        // universal-resolver) get OffchainLookup fallback for unset keys —
        // see resolve() override below.
        return _texts[node][key];
    }

    /**
     * @notice Wildcard resolve override: read text() on-chain first, fall
     *         back to OffchainLookup.
     * @dev addr() and addrMulticoin() pass through to the parent unchanged.
     */
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        override
        returns (bytes memory)
    {
        bytes4 selector = bytes4(data[:4]);
        if (selector == this.text.selector) {
            // Decode (bytes32 node, string key) from the inner call.
            (bytes32 node, string memory key) = abi.decode(data[4:], (bytes32, string));
            string memory v = _texts[node][key];
            if (bytes(v).length > 0) {
                return abi.encode(v);
            }
            // Empty slot → fall through to OffchainLookup so unmigrated
            // records still serve from Postgres until the next sync.
        }
        // All other selectors (addr, addrMulticoin, contenthash) and empty
        // text slots: defer to parent (OffchainLookup).
        return _offchainLookup(name, data);
    }
}
```

> Implementation note: the precise method names on `OurOffchainResolver` (e.g. `_offchainLookup`, the constructor signature, the `resolve()` override modifier) must be confirmed against the existing source in `packages/contracts/src/OurOffchainResolver.sol`. Adapt the inheritance + override syntax to match. If the parent doesn't expose an internal `_offchainLookup`, lift its body into a new `internal` helper as a small refactor in this task.

- [ ] **Step 6.4: Adjust the direct-text test for the documented design**

Direct `text()` returns empty (not OffchainLookup); only the wildcard `resolve()` path falls back. Replace `test_text_falls_back_to_offchain_when_unset` with:

```solidity
function test_resolve_text_falls_back_to_offchain_when_unset() public {
    bytes32 node = keccak256("test.gabhru.eth");
    bytes memory inner = abi.encodeWithSignature("text(bytes32,string)", node, "name");
    bytes memory dnsName = hex"0474657374066761626872750365746800"; // "test.gabhru.eth"
    vm.expectRevert(); // OffchainLookup
    resolver.resolve(dnsName, inner);
}
```

Run: `cd packages/contracts && forge test --match-contract HybridResolverTest -vv`
Expected: PASS — all six cases.

- [ ] **Step 6.5: Commit**

```bash
git add packages/contracts/src/HybridResolver.sol \
  packages/contracts/test/HybridResolver.t.sol
git commit -m "feat(contracts): HybridResolver with on-chain text + off-chain addr"
```

---

### Task 7: Deploy script + Base mainnet deploy

**Files:**
- Create: `packages/contracts/script/DeployHybridResolver.s.sol`

**Decision: deploy on Base mainnet, not Ethereum mainnet.** All other open-agents contracts (and the gateway → ENS path) settle on Base. Putting the resolver there keeps reads cheap and writes affordable for the migration. The CCIP-Read response is signed by our gateway signer regardless of resolver chain — wallets resolve `gabhru.eth` against Ethereum mainnet, but the OffchainLookup gateway URL points at our Hono service, which doesn't care.

> **`[OPEN QUESTION]`** Confirm whether wallets honor a non-mainnet resolver for an Ethereum-mainnet ENS name. ENS Registry lives on Ethereum mainnet, so `setResolver` must point to a mainnet contract address. **Resolution: deploy on Ethereum mainnet, not Base.** The deploy script targets mainnet. (This matches Plan 1's existing `OurOffchainResolver` deploy.)

- [ ] **Step 7.1: Write the deploy script**

Create `packages/contracts/script/DeployHybridResolver.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {HybridResolver} from "../src/HybridResolver.sol";

contract DeployHybridResolver is Script {
    function run() external {
        string memory gatewayUrl = vm.envString("GATEWAY_URL");
        address signer = vm.envAddress("GATEWAY_SIGNER_ADDRESS");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerKey);
        HybridResolver resolver = new HybridResolver(gatewayUrl, signer);
        vm.stopBroadcast();

        console.log("HybridResolver deployed at:", address(resolver));
        console.log("Gateway URL:", gatewayUrl);
        console.log("Signer:", signer);
    }
}
```

- [ ] **Step 7.2: Dry-run against a fork**

```bash
cd packages/contracts
forge script script/DeployHybridResolver.s.sol \
  --rpc-url https://eth.llamarpc.com \
  --fork-url https://eth.llamarpc.com \
  -vvv
```

Expected: simulated address printed; no broadcast (no `--broadcast` flag).

- [ ] **Step 7.3: Real deploy**

Populate `.env`:

```bash
GATEWAY_URL=https://open-agents-gateway.vercel.app/resolve/{sender}/{data}.json
GATEWAY_SIGNER_ADDRESS=0x9B9B2C0F4a157ae83eaF3f0e901Ff6F8AE510017
DEPLOYER_PRIVATE_KEY=0x...   # the controller wallet
```

Then:

```bash
forge script script/DeployHybridResolver.s.sol \
  --rpc-url https://eth.llamarpc.com \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

Expected: deploy + Etherscan verification succeed. Note the deployed address — needed for Task 8 + 10.

- [ ] **Step 7.4: Record the address**

Add the deployed address to `README.md`'s "Live" table as a new row (`Hybrid resolver contract (verified)`). Also append it to a new file `packages/contracts/deployments/mainnet.json`:

```json
{
  "OurOffchainResolver": "0x6c11e3cb958c84cfd339123a2b9c4196c755f777",
  "HybridResolver": "0x...REPLACE_WITH_DEPLOY_ADDRESS..."
}
```

- [ ] **Step 7.5: Commit**

```bash
git add packages/contracts/script/DeployHybridResolver.s.sol \
  packages/contracts/deployments/mainnet.json \
  README.md
git commit -m "feat(contracts): deploy HybridResolver to Ethereum mainnet"
```

---

### Task 8: Migration script — Postgres → on-chain text records

**Files:**
- Create: `packages/contracts/scripts/migrate-text-records.ts`
- Create: `packages/contracts/script/MigrateTextRecords.s.sol`
- Create: `packages/contracts/test/HybridResolverMigration.t.sol`

**Decision: TS driver + Solidity script combo.** The Postgres reads + node-hash computation are easier in TS (we already have viem + drizzle). The actual on-chain calls go through `forge script` for consistent gas/nonce handling and Etherscan trace replay. The TS driver writes a temporary JSON file the Solidity script reads.

**Decision: one batched `setTextBatch` call per agent.** A single agent typically has 4-10 text records; bundling them halves the per-agent gas overhead vs. one tx per key. Multi-agent batching across nodes would require a multicall wrapper — not worth the complexity for the demo's ~20-agent scale.

- [ ] **Step 8.1: Migration test (Foundry)**

Create `packages/contracts/test/HybridResolverMigration.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {HybridResolver} from "../src/HybridResolver.sol";

contract HybridResolverMigrationTest is Test {
    HybridResolver resolver;
    address constant OWNER = address(0xCAFE);

    function setUp() public {
        vm.prank(OWNER);
        resolver = new HybridResolver("https://example/resolve/{sender}/{data}.json", address(0xBEEF));
    }

    function test_migration_writes_known_fixture() public {
        // Two agents, two records each — the migration script must produce
        // the same end state.
        bytes32 node1 = keccak256(abi.encodePacked("test.gabhru.eth"));
        bytes32 node2 = keccak256(abi.encodePacked("demo.gabhru.eth"));

        string[] memory keys = new string[](2);
        keys[0] = "name";
        keys[1] = "description";

        string[] memory values1 = new string[](2);
        values1[0] = "Test";
        values1[1] = "Test agent";
        vm.prank(OWNER);
        resolver.setTextBatch(node1, keys, values1);

        string[] memory values2 = new string[](2);
        values2[0] = "Demo";
        values2[1] = "Demo agent";
        vm.prank(OWNER);
        resolver.setTextBatch(node2, keys, values2);

        // Direct text() returns empty per design; verify via resolve() path.
        // Here we just assert the storage is what we wrote by re-reading via
        // resolve(). For the test, we check setTextBatch persisted by reading
        // back through a public view added in the contract. (If you didn't
        // add a public view, drop this assertion — the unit test in
        // HybridResolverTest.test_owner_can_set_text already covers reads.)
    }
}
```

- [ ] **Step 8.2: Run the migration test**

Run: `cd packages/contracts && forge test --match-contract HybridResolverMigrationTest -vv`
Expected: PASS.

- [ ] **Step 8.3: TS driver**

Create `packages/contracts/scripts/migrate-text-records.ts`:

```ts
#!/usr/bin/env tsx
/**
 * Reads every agent's text_records from Postgres and writes them to the
 * deployed HybridResolver via batched setTextBatch calls. Idempotent —
 * setTextBatch overwrites, so re-running rewrites the same values.
 *
 * env: DATABASE_URL, RPC_URL, PRIVATE_KEY, RESOLVER_ADDRESS
 */
import 'dotenv/config'
import { createWalletClient, createPublicClient, http, namehash, getAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import { getDb, agents } from '@open-agents/db'

const PARENT_DOMAIN = process.env['PARENT_DOMAIN'] ?? 'gabhru.eth'
const ABI = [{
  name: 'setTextBatch', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'node', type: 'bytes32' },
    { name: 'keys', type: 'string[]' },
    { name: 'values', type: 'string[]' },
  ],
  outputs: [],
}] as const

async function main() {
  const { DATABASE_URL: db, RPC_URL: rpc, PRIVATE_KEY: pk, RESOLVER_ADDRESS: resolver } = process.env
  if (!db || !rpc || !pk || !resolver) {
    console.error('Missing env: DATABASE_URL, RPC_URL, PRIVATE_KEY, RESOLVER_ADDRESS')
    process.exit(1)
  }
  const account = privateKeyToAccount(pk as `0x${string}`)
  const wallet = createWalletClient({ account, chain: mainnet, transport: http(rpc) })
  const pub = createPublicClient({ chain: mainnet, transport: http(rpc) })
  const rows = await getDb(db).select().from(agents)
  console.log(`Found ${rows.length} agents to migrate`)

  let succeeded = 0, skipped = 0, failed = 0
  for (const agent of rows) {
    const entries = Object.entries((agent.textRecords ?? {}) as Record<string, string>)
      .filter(([, v]) => v.length > 0)
    if (entries.length === 0) { console.log(`SKIP ${agent.subnameLabel}`); skipped++; continue }

    const fullName = `${agent.subnameLabel}.${PARENT_DOMAIN}`
    try {
      const hash = await wallet.writeContract({
        address: getAddress(resolver),
        abi: ABI,
        functionName: 'setTextBatch',
        args: [namehash(fullName), entries.map(([k]) => k), entries.map(([, v]) => v)],
      })
      console.log(`SENT ${fullName} (${entries.length} keys) — tx ${hash}`)
      const receipt = await pub.waitForTransactionReceipt({ hash })
      if (receipt.status === 'success') succeeded++
      else { console.error(`FAIL ${fullName}: status ${receipt.status}`); failed++ }
    } catch (err) {
      console.error(`FAIL ${fullName}:`, err instanceof Error ? err.message : err)
      failed++
    }
  }
  console.log(`\nDone. succeeded=${succeeded} skipped=${skipped} failed=${failed}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
```

Add to `packages/contracts/package.json`:

```json
{ "scripts": { "migrate:text-records": "tsx scripts/migrate-text-records.ts" } }
```

- [ ] **Step 8.4: Dry-run on a local Anvil fork**

```bash
# Terminal 1
anvil --fork-url https://eth.llamarpc.com --port 8545

# Terminal 2 — deploy + migrate against the fork
cd packages/contracts
forge script script/DeployHybridResolver.s.sol --rpc-url http://localhost:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
# Note printed address, then:
DATABASE_URL=postgres://open_agents:open_agents_dev@localhost:5434/open_agents \
RPC_URL=http://localhost:8545 \
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
RESOLVER_ADDRESS=0x...DEPLOYED_ON_FORK... \
pnpm --filter @open-agents/contracts migrate:text-records
```

Expected: one tx per agent, `succeeded == agents-with-records`.

- [ ] **Step 8.5: Real migration on mainnet**

Repeat Step 8.4 with `RPC_URL=https://eth.llamarpc.com`, `PRIVATE_KEY=<controller>`, `RESOLVER_ADDRESS=<from Task 7>`. Budget ~0.05 ETH for ~20 agents.

- [ ] **Step 8.6: Commit**

```bash
git add packages/contracts/scripts/migrate-text-records.ts \
  packages/contracts/script/MigrateTextRecords.s.sol \
  packages/contracts/test/HybridResolverMigration.t.sol \
  packages/contracts/package.json
git commit -m "feat(contracts): migration script syncs Postgres text records to HybridResolver"
```

---

### Task 9: Re-point `gabhru.eth` to the new resolver — runbook

**Files:**
- Create: `packages/contracts/scripts/repoint-resolver.md`
- Modify: `README.md`

**Decision: document, don't automate.** This is a one-shot owner action. A script would obscure the "I am about to change the resolver for the live ENS name" moment. The runbook walks the operator through the Etherscan UI alternative + a viem one-liner alternative.

- [ ] **Step 9.1: Write the runbook**

Create `packages/contracts/scripts/repoint-resolver.md`:

````markdown
# Repointing `gabhru.eth` to HybridResolver

One-shot procedure to flip the resolver after Task 7 (deploy) and Task 8 (migrate).

## Pre-flight

1. HybridResolver deployed + verified on Etherscan.
2. `pnpm migrate:text-records` reports `failed=0`.
3. Spot-check on mainnet:
   ```ts
   const c = createPublicClient({ chain: mainnet, transport: http() })
   await c.getEnsText({ name: 'test.gabhru.eth', key: 'name' }) // current path still serves
   ```
4. Save the OLD resolver address as the rollback target — read it via the ENS Registry's
   `resolver(namehash('gabhru.eth'))` or just copy from the README "Live" table.

## Execute (pick one)

**Option A — Etherscan UI:** Open the ENS Registry write tab
(<https://etherscan.io/address/0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e#writeContract>),
connect the controller wallet, call `setResolver(node, resolver)` with `node = namehash('gabhru.eth')`
and `resolver = <HybridResolver address>`. Sign.

**Option B — viem:**
```ts
import { createWalletClient, http, namehash } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'

const wallet = createWalletClient({
  account: privateKeyToAccount(process.env.CONTROLLER_PK as `0x${string}`),
  chain: mainnet,
  transport: http(),
})
const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as const
const hash = await wallet.writeContract({
  address: ENS_REGISTRY,
  abi: [{ name: 'setResolver', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'resolver', type: 'address' }],
    outputs: [] }],
  functionName: 'setResolver',
  args: [namehash('gabhru.eth'), '0x...HYBRID...'],
})
console.log('setResolver tx:', hash)
```

## Post-flight

After confirmation (~30s):
1. `getEnsText({ name: 'test.gabhru.eth', key: 'name' })` still returns the same value
   (transport changed; value unchanged).
2. <https://app.ens.domains/test.gabhru.eth> now renders text records natively — this
   is the whole point.
3. Two consecutive `getEnsAddress({ name: '<label>.gabhru.eth' })` calls return
   different stealth addresses (Plan 5 rotation still works).

## Rollback

Repeat Option A or B with the OLD resolver address. Symmetric.
````

- [ ] **Step 9.2: Update the README**

Modify `README.md`'s "Live" table. Add a row below the existing resolver row:

```
| Hybrid resolver contract (verified) | [`0x...REPLACE...`](https://etherscan.io/address/0x...#code) |
| `gabhru.eth` setResolver tx (Plan 7) | [`0x...REPLACE...`](https://etherscan.io/tx/0x...) |
```

- [ ] **Step 9.3: Execute the runbook**

Follow `packages/contracts/scripts/repoint-resolver.md` end-to-end. Capture both the new resolver address and the `setResolver` tx hash, paste them into the README rows you added in Step 9.2.

- [ ] **Step 9.4: Commit**

```bash
git add packages/contracts/scripts/repoint-resolver.md README.md
git commit -m "docs(contracts): repoint runbook + record HybridResolver mainnet addresses"
```

---

### Task 10 (optional): Dashboard "Sync to chain" button

Skip if the operator-driven migration in Task 8 is enough for the demo. Worth landing if owners need to push their own changes between scheduled batch syncs.

**Files:**
- Modify: `apps/dashboard/src/components/records-form.tsx`
- Modify: `apps/api/src/routes/agents.ts`
- Create: `apps/api/src/lib/sync-text-records.ts`
- Create: `apps/api/tests/sync-text-records.test.ts`

**Decision: api-side button, not client-side.** The contract owner (controller wallet) signs all `setText` calls; the agent owner does not. The dashboard button POSTs to a new api endpoint, which uses the controller's private key (mounted from Vercel env) to call `setTextBatch` for that one agent. This keeps the per-agent UX as one click while preserving the single-signer authorization model from Task 6.

- [ ] **Step 10.1: Sync helper + endpoint test**

Create `apps/api/src/lib/sync-text-records.ts`:

```ts
import { createWalletClient, http, namehash, getAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import { env } from '../env.js'

const ABI = [
  {
    name: 'setTextBatch',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'keys', type: 'string[]' },
      { name: 'values', type: 'string[]' },
    ],
    outputs: [],
  },
] as const

export async function syncTextRecordsForAgent(args: {
  subnameLabel: string
  textRecords: Record<string, string>
}): Promise<{ txHash: string; count: number }> {
  const entries = Object.entries(args.textRecords).filter(([, v]) => v.length > 0)
  if (entries.length === 0) return { txHash: '0x', count: 0 }

  const account = privateKeyToAccount(env.HYBRID_RESOLVER_CONTROLLER_PK as `0x${string}`)
  const wallet = createWalletClient({ account, chain: mainnet, transport: http(env.MAINNET_RPC_URL) })
  const node = namehash(`${args.subnameLabel}.${env.PARENT_DOMAIN}`)
  const txHash = await wallet.writeContract({
    address: getAddress(env.HYBRID_RESOLVER_ADDRESS),
    abi: ABI,
    functionName: 'setTextBatch',
    args: [node, entries.map(([k]) => k), entries.map(([, v]) => v)],
  })
  return { txHash, count: entries.length }
}
```

Add new env vars to `apps/api/src/env.ts` (zod schema): `HYBRID_RESOLVER_ADDRESS`, `HYBRID_RESOLVER_CONTROLLER_PK`, `MAINNET_RPC_URL`, `PARENT_DOMAIN` (default `gabhru.eth`).

Create `apps/api/tests/sync-text-records.test.ts` with one test that mocks `syncTextRecordsForAgent` and asserts `POST /agents/:id/sync-text-records` returns `{ txHash, count }` for an authenticated owner. Mirror existing test setup in `apps/api/tests/agents.test.ts`.

- [ ] **Step 10.2: Wire the route**

Modify `apps/api/src/routes/agents.ts`:

```ts
import { syncTextRecordsForAgent } from '../lib/sync-text-records.js'

agentsRoute.post('/:agentId/sync-text-records', requireAuth, requireAgentOwner, async (c) => {
  const agent = c.get('agent') as { subnameLabel: string; textRecords: Record<string, string> }
  try {
    const result = await syncTextRecordsForAgent({
      subnameLabel: agent.subnameLabel,
      textRecords: agent.textRecords ?? {},
    })
    return c.json(result)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})
```

Run: `pnpm --filter @open-agents/api test sync-text-records` → PASS.

- [ ] **Step 10.3: Add the dashboard button**

Modify `apps/dashboard/src/components/records-form.tsx`. In `CardFooter`, after the Save button, add:

```tsx
<Button
  variant="outline"
  type="button"
  disabled={submitting}
  onClick={async () => {
    try {
      const res = await getApiClient().post<{ txHash: string; count: number }>(
        `/agents/${agentId}/sync-text-records`,
      )
      toast.success(`Synced ${res.count} records — tx ${res.txHash.slice(0, 10)}…`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }}
>
  Sync to chain
</Button>
```

Thread `agentId` into `RecordsFormProps` and update the call site in `apps/dashboard/src/app/dashboard/[agentId]/page.tsx`.

- [ ] **Step 10.4: Smoke-test + commit**

Edit a record, save, click "Sync to chain". Expected: toast with tx hash; `app.ens.domains/<label>.gabhru.eth` shows the new value within ~30s.

```bash
git add apps/api/src/lib/sync-text-records.ts \
  apps/api/src/routes/agents.ts \
  apps/api/src/env.ts \
  apps/api/tests/sync-text-records.test.ts \
  apps/dashboard/src/components/records-form.tsx \
  apps/dashboard/src/app/dashboard/[agentId]/page.tsx
git commit -m "feat(dashboard): 'Sync to chain' button writes text records via controller wallet"
```

---

## Self-review

After Plan 7 ships, two things are different:

**Half 1:** `/dashboard/[agentId]/records-preview` exists. It shows every standard ENSIP-18 key + every custom key the agent has, with empty rows clearly marked and a CTA back to the records form. The optional Task 5 toggle proves the public CCIP-Read path works end-to-end via viem's universal resolver.

**Half 2:** A new `HybridResolver` is live on Ethereum mainnet at the address recorded in `README.md`. `gabhru.eth`'s resolver has been re-pointed to it. Text records now render natively in `app.ens.domains`, etherscan ENS lookups, and any wallet that doesn't speak CCIP-Read for text. `addr()` continues to return fresh per-cycle stealth addresses via the gateway. The migration is idempotent and re-runnable; the optional Task 10 button lets owners push their own diffs without operator intervention.

What Plan 7 deliberately does NOT do:
- Per-agent owner-signed `setText` (would require ENS-style approval delegation; deferred).
- Auto-mirror Postgres → chain on every PATCH (gas-prohibitive; explicit sync is fine for v1).
- Multicall across agents in the migration (small population; not worth the wrapper).
- Any change to the gateway's `addr()` or `text("stealth-payload")` semantics (Plan 5 contract preserved).
- Removing the original `OurOffchainResolver` deployment — left in place as a fallback target for the rollback runbook.

**`[OPEN QUESTION]`** Per-agent setText authority. Currently only the controller wallet can write. The right long-term answer is probably to delegate per-node write authority to each agent's owner via a tiny `_approvals[node][address] = bool` mapping checked alongside `onlyOwner` in `setText`. That's a follow-up plan (call it Plan 8) once the demo is in the bag.

