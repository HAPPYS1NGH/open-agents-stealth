# Plan 7 — Records Preview Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `/dashboard/[agentId]/records-preview` page that surfaces every record we serve over CCIP-Read — **text records** (standard ENSIP-18 profile keys like `name`, `description`, `avatar`, `url`, `com.github`, etc., plus any custom keys the agent has saved), **ENSIP-25 verification records** (the parameterized `agent-registration[<registry>][<agentId>]` keys that prove an agent is registered in an on-chain registry like ERC-8004), AND **address records** (the default ENS `addr()` value + the per-cycle stealth Safe address the gateway is currently issuing). The owner sees what `app.ens.domains` *should* show but doesn't (the ens.domains app skips CCIP-Read for text records and renders only the default `addr()`), plus an optional "How others see you" toggle that runs live `getEnsText` lookups via viem's universal resolver to prove CCIP-Read is reaching third-party clients.

**Architecture:** One read-only API endpoint (`GET /agents/:agentId/records-preview`) joins our agents row + the live `gateway_announcements` row + a static list of standard ENSIP-18 keys + a regex match for ENSIP-25 verification keys, and returns one entry per known key (text + address) with the value (or empty) and a `served` boolean indicating whether the gateway will currently return a non-empty value for that key. The dashboard renders a grouped table (Addresses / Profile / Agent / Stealth / Verification / Other) with empty rows showing "—" and a CTA back to the records form. The optional "How others see you" toggle is a client-side switch that swaps the data source to live viem `getEnsText` / `getEnsAddress` calls hitting mainnet — slow, but the proof-of-life UX matters when judges ask "does this actually resolve from a third-party client?"

**Tech Stack:** TypeScript 5.x strict, Hono on Vercel (api), Next.js 16 App Router (dashboard), SWR for client data, viem 2.x (`createPublicClient` + `getEnsText` + `getEnsAddress` for the live toggle), `@open-agents/db` for the Postgres reads, vitest for unit/integration tests. **No new packages added.** No KMS, contracts, or resolver changes — this is a pure read-side feature shipping on top of Plan 5's existing CCIP-Read pipeline.

> **Deferred to a follow-up plan:** moving text records on-chain (hybrid resolver) so `app.ens.domains` renders them natively. That's a separate Solidity + migration plan; Plan 7 stays read-only.

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
│       │   │   └── live-ens-toggle.tsx                      # NEW (optional task)
│       │   ├── hooks/
│       │   │   ├── use-records-preview.ts                   # NEW: SWR fetch
│       │   │   └── use-live-ens-records.ts                  # NEW (optional task)
│       │   ├── lib/
│       │   │   └── ens-categories.ts                        # NEW: key→category mapping
│       │   └── types/
│       │       └── api.ts                                   # MODIFIED: + RecordsPreviewResponse
│       └── tests/
│           ├── records-preview-table.test.tsx               # NEW
│           └── use-records-preview.test.ts                  # NEW
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

## Plan overview

The owner-facing dashboard already lets you SET text records via `RecordsForm`, but there is no view that shows what the gateway is actually serving. Plan 7 closes that gap. The page is read-only, fast, and grouped by category (Addresses / Profile / Agent metadata / Stealth / Verification / Other) so the owner can spot empty profile fields at a glance.

The data source is our own Postgres (one query against the agents row + one for the live `gateway_announcements`), not the gateway over CCIP-Read — that round trip is slow and adds nothing for the owner's view. The optional toggle DOES use viem's universal resolver to prove the public path works end-to-end.

---

### Task 1: API endpoint `GET /agents/:agentId/records-preview`

**Files:**
- Create: `apps/api/src/lib/records-preview.ts`
- Modify: `apps/api/src/routes/agents.ts`
- Create: `apps/api/tests/records-preview.test.ts`

**Decision: server-side catalogue, not client-side.** The list of "standard ENSIP-18 keys we always show even when empty" lives in `apps/api/src/lib/records-preview.ts`. Putting it server-side keeps the dashboard a thin renderer and means future additions (e.g. when ENSIP-19 lands) ship with a single api deploy — no need to bump dashboard + api in lockstep.

**Decision: ENSIP-25 keys are matched by regex, not catalogued.** The `agent-registration[<registry>][<agentId>]` format is parameterized over two dynamic segments, so a static catalogue entry doesn't fit. The builder runs every key in `text_records` through `ENSIP25_KEY_REGEX` and emits one row per match with `category='verification'` and a parsed description showing the registry + agentId. Existing Plan 4 records like `agent-registration[8453][46488]` will be picked up automatically, even though that's our simplified `[chainId]` format rather than the spec's full ERC-7930 interoperable address — the regex tolerates both because it doesn't try to validate the inner format.

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
        // ENSIP-25 verification key (Plan 4 simplified format).
        'agent-registration[8453][46488]': '1',
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

  it('classifies ENSIP-25 agent-registration keys under the verification category', async () => {
    const res = await app.request(`/agents/${agentId}/records-preview`, {
      headers: { Authorization: authHeader },
    })
    const body = (await res.json()) as RecordsPreviewResponse
    const verif = body.records.find((r) => r.key === 'agent-registration[8453][46488]')
    expect(verif).toBeDefined()
    expect(verif).toMatchObject({
      category: 'verification',
      served: true,
      value: '1',
    })
    expect(verif!.description).toMatch(/registry=8453/)
    expect(verif!.description).toMatch(/agentId=46488/)
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
export type RecordCategory = 'profile' | 'agent' | 'stealth' | 'verification' | 'other'

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

/**
 * ENSIP-25 verification key matcher.
 *
 * Format: `agent-registration[<registry>][<agentId>]` where `<registry>` is
 * an ERC-7930 interoperable address and `<agentId>` is a registry-defined
 * id. The value is any non-empty string (recommended `"1"`); only presence
 * matters.
 *
 * Because both segments are dynamic, we can't put a single static entry in
 * STANDARD_KEYS. Instead, the builder matches this regex and renders one
 * row per matching key with category='verification' and a parsed
 * description that surfaces the registry + agentId in the UI.
 */
export const ENSIP25_KEY_REGEX = /^agent-registration\[([^\]]+)\]\[([^\]]+)\]$/

export interface ParsedEnsip25Key {
  /** ERC-7930 registry address as encoded in the key. */
  registry: string
  /** Registry-defined agent identifier (string; the spec doesn't constrain to numeric). */
  agentId: string
}

export function parseEnsip25Key(key: string): ParsedEnsip25Key | null {
  const m = ENSIP25_KEY_REGEX.exec(key)
  if (!m) return null
  return { registry: m[1]!, agentId: m[2]! }
}

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
 * - Match every key against ENSIP25_KEY_REGEX and emit a "verification" row
 *   per match (these are dynamically-named keys, can't be in STANDARD_KEYS).
 * - For every other custom key not in STANDARD_KEYS and not ENSIP-25,
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

  const verificationRows: PreviewRecord[] = []
  const otherRows: PreviewRecord[] = []
  for (const [key, value] of Object.entries(textRecords)) {
    if (standardKeySet.has(key)) continue
    const parsed = parseEnsip25Key(key)
    if (parsed) {
      verificationRows.push({
        key,
        value,
        category: 'verification',
        description: `ENSIP-25 registry attestation — registry=${parsed.registry} agentId=${parsed.agentId}`,
        served: value.length > 0,
        sourceNote: 'served from text_records',
      })
    } else {
      otherRows.push({
        key,
        value,
        category: 'other',
        description: 'Custom key',
        served: value.length > 0,
        sourceNote: 'served from text_records',
      })
    }
  }

  return [...standardRows, ...verificationRows, ...otherRows]
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

### Task 5: Address records (default ETH addr + per-cycle stealth Safe)

The records preview must show **address records** alongside text records — otherwise the page misleads the owner about what the gateway is actually returning to clients. Two address values matter:

1. **Default `addr()`** — what `app.ens.domains` already shows. For our agents this is the **per-cycle stealth Safe** issued by the gateway: each call to `addr(node)` over CCIP-Read returns the *current* unpaid stealth Safe (Plan 4's stable-cycle semantic). The owner needs to see "this is what someone visiting your ENS profile right now would see," which is the live `gateway_announcements.stealth_safe_address` for the most recent unpaid row, NOT the static `agents.base_addr` field.
2. **Fallback `base_addr`** — the static EOA the owner registered during onboarding. Useful as the "would be served if no stealth-meta were published" fallback. Surfaces as informational so the owner understands the difference.

**Decision: serve the LIVE stealth Safe from `gateway_announcements`, not a snapshot.** A snapshot taken at request time would be stale within the next minute (Plan 5 rotates after a payment lands). Reading the latest unpaid row keeps the preview honest.

**Decision: address records are a NEW group ("Addresses") at the top of the table, above Profile.** Keeps the most-changing values where they're most visible, and matches what `app.ens.domains` shows in its profile header.

- [ ] **Step 5.1: Extend the API endpoint to return address records**

Modify `apps/api/src/lib/records-preview.ts` to also return address rows. Add to the response shape:

```ts
export interface AddressRecord {
  /** Display label (e.g., "addr (ETH)"). */
  label: string
  /** Description shown as a small italic line under the label. */
  description: string
  /** The 0x… value the gateway will currently return, or null if not served. */
  value: `0x${string}` | null
  /** Why we're serving this — e.g., "stealth Safe (per-cycle)". */
  source: string
}

export interface RecordsPreviewResponse {
  agentId: string
  subnameLabel: string
  // …existing text record fields…
  addresses: AddressRecord[]
}
```

In the builder, add (sketch — adapt to your existing query helpers):

```ts
import { findCurrentAnnouncement } from '@open-agents/db'

const current = await findCurrentAnnouncement(db, agent.id)

const addresses: AddressRecord[] = [
  {
    label: 'addr (default)',
    description: 'What `app.ens.domains` and most wallets render.',
    value: (current?.stealthSafeAddress ?? agent.baseAddr) as `0x${string}`,
    source: current?.stealthSafeAddress
      ? 'stealth Safe (per-cycle, rotates after payment)'
      : 'fallback to agents.base_addr (no stealth issuance yet)',
  },
  {
    label: 'base_addr (fallback)',
    description: 'Static EOA from onboarding. Used only when no stealth-meta is published.',
    value: agent.baseAddr as `0x${string}`,
    source: 'agents.base_addr',
  },
]
```

- [ ] **Step 5.2: Extend the API test**

In `apps/api/tests/records-preview.test.ts`, add an assertion that `addresses[0].value` equals the inserted `gateway_announcements.stealth_safe_address` when one exists, and falls back to `agents.base_addr` when none.

```ts
it('returns the live stealth Safe as the primary addr() answer', async () => {
  // …seed an agent + a fresh announcement with stealthSafeAddress = '0x…aa'…
  const res = await app.fetch(new Request(`http://localhost/agents/${agentId}/records-preview`, {
    headers: { Authorization: `Bearer ${token}` },
  }))
  const body = (await res.json()) as { addresses: Array<{ label: string; value: string }> }
  const primary = body.addresses.find((a) => a.label === 'addr (default)')
  expect(primary?.value.toLowerCase()).toBe('0x' + 'aa'.repeat(20))
})

it('falls back to base_addr when no announcement exists', async () => {
  // …seed an agent without inserting any announcement…
  const res = await app.fetch(new Request(`http://localhost/agents/${agentId}/records-preview`, {
    headers: { Authorization: `Bearer ${token}` },
  }))
  const body = (await res.json()) as { addresses: Array<{ label: string; value: string }> }
  const primary = body.addresses.find((a) => a.label === 'addr (default)')
  expect(primary?.value).toBe(agent.baseAddr.toLowerCase())
})
```

- [ ] **Step 5.3: Surface addresses in the table component**

Modify `apps/dashboard/src/components/records-preview-table.tsx` to render an "Addresses" group above the existing Profile / Agent / Stealth / Other groups. Each row shows `label` + `description` (small italic) + `value` (monospace, click-to-copy). When `value` is null, render the same "—" placeholder used for empty text records.

Mirror the styling of the text-record rows for consistency. The "Addresses" group label should use the same chip pattern (`<span className="chip">/// addresses</span>` or similar) the other group headers use.

- [ ] **Step 5.4: Update the dashboard type**

In `apps/dashboard/src/types/api.ts`, add the matching `AddressRecord` + extend `RecordsPreviewResponse` with `addresses: AddressRecord[]`.

- [ ] **Step 5.5: Smoke test + commit**

Open `/dashboard/<agentId>/records-preview` in the browser. Confirm:
- Two address rows visible at the top under "Addresses"
- The first (`addr (default)`) shows the live stealth Safe (or `base_addr` if no announcement yet)
- After triggering a payment (which marks the announcement paid), refresh the page — the value should rotate to a fresh stealth Safe within the next gateway query

```bash
git add apps/api/src/lib/records-preview.ts apps/api/tests/records-preview.test.ts \
  apps/dashboard/src/components/records-preview-table.tsx \
  apps/dashboard/src/types/api.ts
git commit -m "feat(dashboard): show address records (live stealth Safe + fallback) on records-preview"
```

---

### Task 6 (optional): Live ENS lookup toggle

Skip this if a future plan moves text records on-chain — once that lands, third-party tooling renders them natively and the toggle is redundant. Worth keeping until then.

**Files:**
- Create: `apps/dashboard/src/hooks/use-live-ens-records.ts`
- Create: `apps/dashboard/src/components/live-ens-toggle.tsx`
- Modify: `apps/dashboard/src/app/dashboard/[agentId]/records-preview/page.tsx`

**Decision: lazy-load viem on toggle, not on page mount.** The mainnet public client + universal-resolver call adds 30-50KB to the initial bundle and ~1s of latency per key. Keep the default view fast (DB read) and only fire viem when the user opts in.

- [ ] **Step 6.1: Add the live-lookup hook**

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

- [ ] **Step 6.2: Add the toggle component**

Create `apps/dashboard/src/components/live-ens-toggle.tsx`. A Card with a single Button (`Run live lookup` / `Stop live lookup`) that toggles `enabled`, plus a 3-column grid (`key | value | durationMs`) populated from `useLiveEnsRecords(subnameLabel, records.filter(r=>r.served).map(r=>r.key), enabled)`. Mirror the styling of `RecordsPreviewTable` — same Card primitive, same code-block for keys.

- [ ] **Step 6.3: Mount on the page**

Modify `apps/dashboard/src/app/dashboard/[agentId]/records-preview/page.tsx`. Add a `useSWR<AgentResponse>` block at the top to fetch the agent (mirror the settings page exactly), then render below the table:

```tsx
{data && agent && (
  <LiveEnsToggle subnameLabel={agent.subnameLabel} records={data.records} />
)}
```

- [ ] **Step 6.4: Smoke test + commit**

Open the page, click "Run live lookup", confirm rows fill in within ~5s. If a key returns null where the preview shows `served=true`, that's a CCIP-Read regression — investigate before committing.

```bash
git add apps/dashboard/src/hooks/use-live-ens-records.ts \
  apps/dashboard/src/components/live-ens-toggle.tsx \
  apps/dashboard/src/app/dashboard/[agentId]/records-preview/page.tsx
git commit -m "feat(dashboard): live ENS lookup toggle for records-preview page"
```

---

## Self-review

After Plan 7 ships, `/dashboard/[agentId]/records-preview` exists. It shows:

- Every standard ENSIP-18 text record key + every custom key the agent has, with empty rows clearly marked and a CTA back to the records form.
- Both **address records**: the live per-cycle stealth Safe (what `app.ens.domains` would render today) AND the static `base_addr` fallback (what would be served if no stealth-meta were published). The owner can see in one glance which value is currently authoritative.
- An optional Task 6 toggle that proves the public CCIP-Read path works end-to-end via viem's universal resolver against mainnet.

What Plan 7 deliberately does NOT do:

- Move text records on-chain (i.e., a hybrid resolver). That's a separate plan with Solidity work, a deploy, a migration script, and a `setResolver` runbook — deferred to a future plan once the demo is in the bag.
- Per-agent owner-signed setters of any kind (the records form already exists; this page is read-only).
- Change `addr()` or `text("stealth-payload")` semantics in the gateway (Plan 5 contract preserved).
- Auto-mirror Postgres → chain on every PATCH.

**`[OPEN QUESTION]`** Should the address-record group also display the agent's deployed treasury Safe (`agents.treasury_safe_address`)? It's not served via ENS today — it's purely a destination the owner sweeps stealth funds to — so showing it here is informational, not "this is what clients see." Recommendation: include it as a third row labeled `treasury (off-chain, owner-only)` so the owner has a complete picture without confusing it with served records.

