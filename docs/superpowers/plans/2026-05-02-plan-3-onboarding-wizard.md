# Plan 3 — Onboarding Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the developer-facing onboarding wizard that takes an EOA from "connect wallet" to "working `<label>.gabhru.eth` agent" in under 90 seconds. Build a Next.js 16 dashboard at `apps/dashboard` with wallet auth (SIWE → JWT), a 5-step wizard (claim subname → derive view-key stub → register on-chain via ERC-8004 → deploy treasury Safe → publish ENSIP-26 text records), and an agents list home that re-uses the records form. Add two new API endpoints (`POST /agents/:id/register-onchain`, `POST /agents/:id/treasury`) that verify the on-chain side of those steps before persisting.

**Architecture:** The dashboard is a pure client of `apps/api` — no DB access of its own. Auth: wallet → SIWE message → `POST /auth/siwe-verify` → JWT in httpOnly cookie + memory copy → `Authorization: Bearer <jwt>` on every API call. The `/me` poller renews the JWT via the `x-refreshed-token` response header (already implemented in Plan 2). All on-chain transactions are signed in the user's wallet (wagmi `useWriteContract`, Safe SDK in browser); the API receives transaction hashes and verifies them with viem. View-key derivation is **stubbed**: a single owner-wallet signature feeds keccak256 → 32-byte hex placeholder, PATCHed as `viewKeyEncrypted`. Plan 4 swaps this for `fluidkey-stealth-account-kit.generateKeysFromSignature` end-to-end.

**Tech Stack:** Next.js 16 (App Router, RSC where appropriate), TypeScript 5.x strict, Tailwind 4.x, shadcn/ui, wagmi 2.x + viem 2.x, RainbowKit 2.x for wallet connect UI, `@safe-global/protocol-kit` 5.x for browser Safe deployment, React Testing Library + Vitest + jsdom for component tests, `next/font` for typography, `zustand` for wizard state. Server side (apps/api additions): viem for on-chain receipt parsing.

---

## File structure

After Plan 3, the repo gains:

```
open-agents/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── lib/
│   │   │   │   ├── identity-registry.ts   # MODIFIED: getRegisterTransferLog() helper
│   │   │   │   └── safe-bytecode.ts       # NEW: Safe singleton bytecode hash check
│   │   │   └── routes/
│   │   │       └── agents.ts              # MODIFIED: + /register-onchain + /treasury
│   │   └── tests/
│   │       ├── register-onchain.test.ts   # NEW
│   │       └── treasury.test.ts           # NEW
│   └── dashboard/
│       ├── package.json
│       ├── tsconfig.json
│       ├── next.config.ts
│       ├── postcss.config.mjs
│       ├── tailwind.config.ts
│       ├── components.json                # shadcn/ui registry config
│       ├── vercel.json
│       ├── .env.example
│       ├── public/
│       │   └── favicon.ico
│       ├── src/
│       │   ├── app/
│       │   │   ├── layout.tsx
│       │   │   ├── page.tsx               # marketing + connect-wallet landing
│       │   │   ├── globals.css
│       │   │   ├── providers.tsx          # wagmi + RainbowKit + QueryClient
│       │   │   ├── onboard/
│       │   │   │   ├── page.tsx           # wizard shell
│       │   │   │   ├── _steps/
│       │   │   │   │   ├── step-1-subname.tsx
│       │   │   │   │   ├── step-2-viewkey.tsx
│       │   │   │   │   ├── step-3-register.tsx
│       │   │   │   │   ├── step-4-treasury.tsx
│       │   │   │   │   └── step-5-records.tsx
│       │   │   │   └── _store.ts          # zustand wizard state
│       │   │   └── dashboard/
│       │   │       ├── page.tsx           # agents list
│       │   │       └── [agentId]/
│       │   │           └── page.tsx       # per-agent settings (re-uses step 5)
│       │   ├── components/
│       │   │   ├── connect-button.tsx
│       │   │   ├── wizard-progress.tsx
│       │   │   ├── records-form.tsx       # ENSIP-26 form, shared step 5 / agent settings
│       │   │   └── ui/                    # shadcn primitives (button, card, input, toast, etc.)
│       │   ├── lib/
│       │   │   ├── api-client.ts          # typed fetch wrapper hitting apps/api
│       │   │   ├── auth.ts                # SIWE handshake + JWT memory store
│       │   │   ├── stealth-stub.ts        # deriveViewKeyStub() — Plan 3 placeholder
│       │   │   ├── identity-registry-abi.ts
│       │   │   ├── safe-deploy.ts         # browser Safe deploy via Protocol Kit
│       │   │   └── chains.ts              # base chain config
│       │   ├── hooks/
│       │   │   ├── use-me.ts              # SWR poller, applies x-refreshed-token
│       │   │   ├── use-siwe-login.ts
│       │   │   └── use-create-agent.ts
│       │   └── types/
│       │       └── api.ts                 # Agent, MeResponse, etc.
│       └── tests/
│           ├── stealth-stub.test.ts
│           ├── records-form.test.tsx
│           ├── api-client.test.ts
│           └── use-siwe-login.test.tsx
└── README.md                              # MODIFIED: dashboard quick-start
```

---

## Prerequisites

The engineer must have available:

- pnpm 9+ installed
- Plan 2 complete: `apps/api` boots, `/auth/siwe-nonce`, `/auth/siwe-verify`, `/me`, `POST /agents`, `GET /agents/:id`, `PATCH /agents/:id` are reachable, gateway resolves from Postgres
- Local Postgres running (`docker compose -f docker-compose.dev.yml up -d`)
- A WalletConnect Cloud project ID (https://cloud.reown.com → free tier) — used by RainbowKit
- A Base mainnet RPC URL (the same `BASE_RPC_URL` Plan 2 uses)
- A funded EOA on Base mainnet for end-to-end manual smoke tests (~$0.05 in ETH)
- Node 20+ (Next.js 16 requires it)

---

### Task 1: Scaffold `apps/dashboard` with Next.js 16 + Tailwind + shadcn/ui

**Files:**
- Create: `apps/dashboard/package.json`
- Create: `apps/dashboard/tsconfig.json`
- Create: `apps/dashboard/next.config.ts`
- Create: `apps/dashboard/postcss.config.mjs`
- Create: `apps/dashboard/tailwind.config.ts`
- Create: `apps/dashboard/components.json`
- Create: `apps/dashboard/.env.example`
- Create: `apps/dashboard/.gitignore`
- Create: `apps/dashboard/src/app/layout.tsx`
- Create: `apps/dashboard/src/app/page.tsx`
- Create: `apps/dashboard/src/app/globals.css`
- Create: `apps/dashboard/public/favicon.ico` (empty 0-byte placeholder is fine)

- [ ] **Step 1.1: Create `apps/dashboard/package.json`**

```json
{
  "name": "@open-agents/dashboard",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --port 3002",
    "build": "next build",
    "start": "next start --port 3002",
    "lint": "next lint",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@hookform/resolvers": "^3.9.1",
    "@rainbow-me/rainbowkit": "^2.2.0",
    "@safe-global/protocol-kit": "^5.0.4",
    "@tanstack/react-query": "^5.59.16",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.453.0",
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-hook-form": "^7.53.1",
    "siwe": "^3.1.2",
    "sonner": "^1.7.0",
    "swr": "^2.2.5",
    "tailwind-merge": "^2.5.4",
    "viem": "^2.21.41",
    "wagmi": "^2.13.3",
    "zod": "^3.23.8",
    "zustand": "^5.0.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.3",
    "autoprefixer": "^10.4.20",
    "eslint": "^9.13.0",
    "eslint-config-next": "^16.0.0",
    "jsdom": "^25.0.1",
    "postcss": "^8.4.47",
    "tailwindcss": "^4.0.0-alpha.31",
    "tailwindcss-animate": "^1.0.7",
    "typescript": "^5.6.0",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 1.2: Create `apps/dashboard/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowJs": false,
    "incremental": true,
    "noEmit": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    ".next/types/**/*.ts",
    "src/**/*.ts",
    "src/**/*.tsx",
    "tests/**/*.ts",
    "tests/**/*.tsx"
  ],
  "exclude": ["node_modules", ".next", "dist"]
}
```

- [ ] **Step 1.3: Create `apps/dashboard/next.config.ts`**

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  // Allow workspace packages to be transpiled (none today, but future @open-agents/* libs will need it).
  transpilePackages: [],
}

export default nextConfig
```

- [ ] **Step 1.4: Create `apps/dashboard/postcss.config.mjs`**

```js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
}
```

- [ ] **Step 1.5: Create `apps/dashboard/tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
```

- [ ] **Step 1.6: Create `apps/dashboard/components.json`**

This file is read by the shadcn CLI when adding components.

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/app/globals.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

- [ ] **Step 1.7: Create `apps/dashboard/.env.example`**

```env
# ── apps/dashboard ─────────────────────────────────────────────────────────

# URL of apps/api. Use http://localhost:3001 for local dev.
NEXT_PUBLIC_API_URL=http://localhost:3001

# WalletConnect Cloud project ID (free, https://cloud.reown.com).
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=

# Public Base RPC. Used for read-only contract calls in the browser.
NEXT_PUBLIC_BASE_RPC_URL=https://mainnet.base.org

# ENS parent domain — used in UI copy and the "preview your ENS profile" link.
NEXT_PUBLIC_PARENT_DOMAIN=gabhru.eth

# ERC-8004 IdentityRegistry on Base mainnet.
NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS=0x8004A169FB4a3325136EB29fA0ceB6D2e539a432

# Safe singleton on Base mainnet (Safe v1.4.1 L2). Used by Safe Protocol Kit defaults.
NEXT_PUBLIC_SAFE_SINGLETON_ADDRESS=0x29fcB43b46531BcA003ddC8FCB67FFE91900C762
```

- [ ] **Step 1.8: Create `apps/dashboard/.gitignore`**

```
node_modules
.next
out
.env
.env.local
.vercel
*.tsbuildinfo
next-env.d.ts
```

- [ ] **Step 1.9: Create `apps/dashboard/src/app/globals.css`**

```css
@import 'tailwindcss';

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222 47% 11%;
    --card: 0 0% 100%;
    --card-foreground: 222 47% 11%;
    --primary: 222 47% 11%;
    --primary-foreground: 210 40% 98%;
    --muted: 210 40% 96%;
    --muted-foreground: 215 16% 47%;
    --destructive: 0 84% 60%;
    --destructive-foreground: 210 40% 98%;
    --border: 214 32% 91%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222 47% 7%;
    --foreground: 210 40% 98%;
    --card: 222 47% 9%;
    --card-foreground: 210 40% 98%;
    --primary: 210 40% 98%;
    --primary-foreground: 222 47% 11%;
    --muted: 217 33% 17%;
    --muted-foreground: 215 20% 65%;
    --destructive: 0 62% 50%;
    --destructive-foreground: 210 40% 98%;
    --border: 217 33% 20%;
  }

  body {
    background: hsl(var(--background));
    color: hsl(var(--foreground));
  }
}
```

- [ ] **Step 1.10: Create `apps/dashboard/src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Open Agents — Onboard your AI agent',
  description: 'Claim a free <name>.gabhru.eth subname for your agent and receive private USDC payments.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  )
}
```

- [ ] **Step 1.11: Create `apps/dashboard/src/app/page.tsx`**

```tsx
import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-8 px-6 py-12 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">
        Open Agents
      </h1>
      <p className="text-lg text-muted-foreground">
        Claim a free <code>.gabhru.eth</code> subname for your AI agent and start receiving
        private USDC payments. Onboarding takes about ninety seconds.
      </p>
      <Link
        href="/onboard"
        className="rounded-md bg-primary px-6 py-3 text-primary-foreground hover:opacity-90"
      >
        Start onboarding
      </Link>
    </main>
  )
}
```

- [ ] **Step 1.12: Create `apps/dashboard/public/favicon.ico`**

Create an empty file:

```bash
mkdir -p apps/dashboard/public
touch apps/dashboard/public/favicon.ico
```

- [ ] **Step 1.13: Verify the workspace picks up the new app and the build succeeds**

The pnpm workspace already includes `apps/*` (from Plan 2). Running install picks it up automatically.

```bash
pnpm install
```

Expected: install completes, no peer-dep errors, `apps/dashboard` resolves.

```bash
cd apps/dashboard
pnpm build
```

Expected: Next.js prints "Compiled successfully" with two routes (`/`, `/_not-found`).

- [ ] **Step 1.14: Commit**

```bash
cd ../..
git add apps/dashboard/package.json apps/dashboard/tsconfig.json apps/dashboard/next.config.ts \
  apps/dashboard/postcss.config.mjs apps/dashboard/tailwind.config.ts apps/dashboard/components.json \
  apps/dashboard/.env.example apps/dashboard/.gitignore \
  apps/dashboard/src/app/layout.tsx apps/dashboard/src/app/page.tsx apps/dashboard/src/app/globals.css \
  apps/dashboard/public/favicon.ico pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore(dashboard): scaffold Next.js 16 + Tailwind + shadcn config

Adds apps/dashboard as a pnpm workspace member. Next.js App Router,
strict TypeScript, Tailwind 4 with shadcn-compatible CSS variables,
RainbowKit + wagmi + viem on the dependency list (wired in Task 2).
Marketing landing page links to /onboard. Build succeeds with two routes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 2: Wire RainbowKit + wagmi + React Query providers

**Files:**
- Create: `apps/dashboard/src/lib/chains.ts`
- Create: `apps/dashboard/src/app/providers.tsx`
- Modify: `apps/dashboard/src/app/layout.tsx`
- Create: `apps/dashboard/src/components/connect-button.tsx`
- Modify: `apps/dashboard/src/app/page.tsx`

The wallet UI uses RainbowKit because it ships a polished, accessible connect modal with WalletConnect, MetaMask, Coinbase Wallet, and injected wallet support out of the box — and exposes wagmi hooks underneath, which we use directly in steps 3 and 4. Decision recorded.

- [ ] **Step 2.1: Create `apps/dashboard/src/lib/chains.ts`**

```ts
import { base } from 'wagmi/chains'
import { http } from 'viem'
import { createConfig } from 'wagmi'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'

const projectId = process.env['NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID']
if (!projectId) {
  // Fail loudly in dev; in prod-built bundles Next.js inlines the value.
  // Using a non-empty fallback keeps build-time evaluation happy.
  console.warn('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set; WalletConnect will be disabled.')
}

const rpcUrl = process.env['NEXT_PUBLIC_BASE_RPC_URL'] ?? 'https://mainnet.base.org'

/**
 * Single wagmi config used by every component. We only support Base mainnet —
 * any wrong-chain state surfaces as a banner and a "switch network" button.
 */
export const wagmiConfig = getDefaultConfig({
  appName: 'Open Agents',
  projectId: projectId ?? 'placeholder-project-id-set-env-var',
  chains: [base],
  transports: {
    [base.id]: http(rpcUrl),
  },
  ssr: true,
}) as ReturnType<typeof createConfig>

export { base }
```

- [ ] **Step 2.2: Create `apps/dashboard/src/app/providers.tsx`**

```tsx
'use client'

import { ReactNode } from 'react'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RainbowKitProvider } from '@rainbow-me/rainbowkit'
import '@rainbow-me/rainbowkit/styles.css'
import { Toaster } from 'sonner'
import { wagmiConfig } from '@/lib/chains'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider modalSize="compact">
          {children}
          <Toaster position="top-right" richColors />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
```

- [ ] **Step 2.3: Wire `Providers` into `apps/dashboard/src/app/layout.tsx`**

Replace `apps/dashboard/src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'Open Agents — Onboard your AI agent',
  description: 'Claim a free <name>.gabhru.eth subname for your agent and receive private USDC payments.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```

- [ ] **Step 2.4: Create `apps/dashboard/src/components/connect-button.tsx`**

```tsx
'use client'

import { ConnectButton as RainbowConnectButton } from '@rainbow-me/rainbowkit'

/**
 * Thin wrapper around RainbowKit's ConnectButton. Centralizes label copy and
 * lets us swap the wallet library later without touching call sites.
 */
export function ConnectButton() {
  return (
    <RainbowConnectButton
      label="Connect wallet"
      accountStatus={{ smallScreen: 'avatar', largeScreen: 'full' }}
      chainStatus="icon"
      showBalance={false}
    />
  )
}
```

- [ ] **Step 2.5: Add the connect button to the landing page**

Replace `apps/dashboard/src/app/page.tsx`:

```tsx
import Link from 'next/link'
import { ConnectButton } from '@/components/connect-button'

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-8 px-6 py-12 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">
        Open Agents
      </h1>
      <p className="text-lg text-muted-foreground">
        Claim a free <code>.gabhru.eth</code> subname for your AI agent and start receiving
        private USDC payments. Onboarding takes about ninety seconds.
      </p>
      <ConnectButton />
      <Link
        href="/onboard"
        className="rounded-md bg-primary px-6 py-3 text-primary-foreground hover:opacity-90"
      >
        Start onboarding
      </Link>
    </main>
  )
}
```

- [ ] **Step 2.6: Boot the dev server and verify the connect modal opens**

```bash
cd apps/dashboard
NEXT_PUBLIC_API_URL=http://localhost:3001 \
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=placeholder-for-local-dev \
pnpm dev
```

Open http://localhost:3002. Expected: landing page renders, "Connect wallet" button shows, clicking it opens the RainbowKit modal listing MetaMask, WalletConnect, Coinbase, and Injected. Stop with Ctrl-C.

- [ ] **Step 2.7: Commit**

```bash
cd ../..
git add apps/dashboard/src/lib/chains.ts apps/dashboard/src/app/providers.tsx \
  apps/dashboard/src/app/layout.tsx apps/dashboard/src/components/connect-button.tsx \
  apps/dashboard/src/app/page.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): wagmi + RainbowKit + React Query providers

Wires Base mainnet wagmi config (single chain, RainbowKit's getDefaultConfig)
into a client Providers component. Adds a typed ConnectButton wrapper.
Sonner Toaster is mounted globally for wizard error/success messages.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 3: Set up Vitest + React Testing Library

**Files:**
- Create: `apps/dashboard/vitest.config.ts`
- Create: `apps/dashboard/tests/setup.ts`
- Create: `apps/dashboard/tests/sanity.test.ts`

Vitest + React Testing Library are pre-decided. Vitest reuses our existing `vitest@^2.1.4` pin and shares config patterns with `apps/api`. RTL gives us `render`, `screen`, and user-event for component interaction tests.

- [ ] **Step 3.1: Create `apps/dashboard/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: false,
    include: ['tests/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

- [ ] **Step 3.2: Create `apps/dashboard/tests/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

// jsdom does not implement matchMedia by default; wagmi/RainbowKit poke at it.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}
```

- [ ] **Step 3.3: Create `apps/dashboard/tests/sanity.test.ts`**

```ts
import { describe, expect, it } from 'vitest'

describe('vitest sanity', () => {
  it('runs a trivial assertion', () => {
    expect(2 + 2).toBe(4)
  })
})
```

- [ ] **Step 3.4: Run tests to verify the setup works**

```bash
cd apps/dashboard
pnpm test
```

Expected: 1 test passing (sanity).

- [ ] **Step 3.5: Commit**

```bash
cd ../..
git add apps/dashboard/vitest.config.ts apps/dashboard/tests/setup.ts apps/dashboard/tests/sanity.test.ts
git commit -m "$(cat <<'EOF'
chore(dashboard): vitest + React Testing Library configuration

Adds vitest.config.ts (jsdom env, React plugin, @ alias for src),
tests/setup.ts that wires jest-dom matchers and stubs matchMedia for
RainbowKit. Sanity test passes; later tasks add component + hook tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Type-safe API client and shared types

**Files:**
- Create: `apps/dashboard/src/types/api.ts`
- Create: `apps/dashboard/src/lib/api-client.ts`
- Create: `apps/dashboard/tests/api-client.test.ts`

The API client is a small typed `fetch` wrapper that knows how to attach an `Authorization: Bearer <jwt>` header, parse `x-refreshed-token` on success, and surface JSON `{ error }` bodies as thrown `ApiError` instances. Every dashboard hook talks to apps/api through it.

- [ ] **Step 4.1: Create `apps/dashboard/src/types/api.ts`**

```ts
export interface AgentResponse {
  id: string
  ownerEoa: string
  subnameLabel: string
  agentId: string | null
  baseAddr: string
  agentWalletEoa: string | null
  textRecords: Record<string, string>
  treasurySafeAddress: string | null
  viewKeyEncrypted?: string | null
  isActive?: boolean
  createdAt: string
  updatedAt?: string
}

export interface MeResponse {
  ownerEoa: string
  agents: AgentResponse[]
}

export interface SiweNonceResponse {
  nonce: string
}

export interface SiweVerifyResponse {
  token: string
  expiresAt: string
}

export interface CreateAgentBody {
  subnameLabel: string
  baseAddr: string
  agentId?: string
  agentWalletEoa?: string
  textRecords?: Record<string, string>
  viewKeyEncrypted?: string
}

export interface PatchAgentBody {
  baseAddr?: string
  agentWalletEoa?: string
  textRecords?: Record<string, string>
  treasurySafeAddress?: string
  viewKeyEncrypted?: string
}

export interface RegisterOnchainBody {
  agentId: string       // "chainId:uint256", e.g. "8453:42"
  txHash: `0x${string}`
}

export interface RegisterOnchainResponse {
  id: string
  agentId: string
  agentWalletEoa: string
}

export interface TreasuryBody {
  safeAddress: `0x${string}`
  deployTxHash: `0x${string}`
}

export interface TreasuryResponse {
  id: string
  treasurySafeAddress: string
}
```

- [ ] **Step 4.2: Write the failing test**

Create `apps/dashboard/tests/api-client.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiClient, ApiError } from '@/lib/api-client'

const BASE_URL = 'http://localhost:3001'

describe('ApiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns parsed JSON on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient({ baseUrl: BASE_URL })
    const data = await client.get<{ ok: boolean }>('/health')
    expect(data.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('attaches Authorization header when a token is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient({ baseUrl: BASE_URL })
    client.setToken('test-jwt-value')
    await client.get('/me')

    const init = fetchMock.mock.calls[0]![1] as RequestInit
    const headers = new Headers(init.headers)
    expect(headers.get('Authorization')).toBe('Bearer test-jwt-value')
  })

  it('captures x-refreshed-token from the response and updates the in-memory token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-refreshed-token': 'new-rolling-jwt',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient({ baseUrl: BASE_URL })
    client.setToken('old-jwt')
    await client.get('/me')

    expect(client.getToken()).toBe('new-rolling-jwt')
  })

  it('throws ApiError with status and message for non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Subname label is already taken' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient({ baseUrl: BASE_URL })
    await expect(client.post('/agents', { subnameLabel: 'x' })).rejects.toMatchObject({
      status: 409,
      message: 'Subname label is already taken',
    })
  })

  it('ApiError instances pass instanceof', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('plain text', { status: 500, headers: { 'content-type': 'text/plain' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient({ baseUrl: BASE_URL })
    let caught: unknown
    try { await client.get('/x') } catch (err) { caught = err }
    expect(caught).toBeInstanceOf(ApiError)
  })
})
```

- [ ] **Step 4.3: Run test to verify it fails**

```bash
cd apps/dashboard
pnpm test
```

Expected: FAIL — `@/lib/api-client` cannot be resolved.

- [ ] **Step 4.4: Create `apps/dashboard/src/lib/api-client.ts`**

```ts
export class ApiError extends Error {
  status: number
  body: unknown

  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export interface ApiClientOptions {
  baseUrl: string
}

/**
 * Typed fetch wrapper for apps/api. Holds the JWT in memory only — never in
 * localStorage. The httpOnly cookie set by /auth/siwe-verify is the durable
 * copy; this in-memory token is the per-tab fast path.
 *
 * On every successful response, we read `x-refreshed-token` and replace the
 * in-memory token. The /me poller therefore gives us rolling 15-min sessions
 * as long as the user is active.
 */
export class ApiClient {
  private baseUrl: string
  private token: string | null = null

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '')
  }

  setToken(token: string | null): void {
    this.token = token
  }

  getToken(): string | null {
    return this.token
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body)
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
    })

    const refreshed = res.headers.get('x-refreshed-token')
    if (refreshed) this.token = refreshed

    const contentType = res.headers.get('content-type') ?? ''
    const isJson = contentType.includes('application/json')
    const parsed: unknown = isJson ? await res.json().catch(() => ({})) : await res.text()

    if (!res.ok) {
      const message =
        isJson && typeof parsed === 'object' && parsed !== null && 'error' in parsed
          ? String((parsed as { error: unknown }).error)
          : `HTTP ${res.status}`
      throw new ApiError(res.status, message, parsed)
    }

    return parsed as T
  }
}

/**
 * Singleton ApiClient. Components consume it via the hook in `lib/auth.ts`,
 * which seeds the token from the httpOnly cookie on first mount.
 */
let _client: ApiClient | null = null
export function getApiClient(): ApiClient {
  if (!_client) {
    const baseUrl =
      process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'
    _client = new ApiClient({ baseUrl })
  }
  return _client
}
```

- [ ] **Step 4.5: Run tests to verify they pass**

```bash
pnpm test
```

Expected: 6 tests passing (1 sanity + 5 api-client).

- [ ] **Step 4.6: Commit**

```bash
cd ../..
git add apps/dashboard/src/types/api.ts apps/dashboard/src/lib/api-client.ts apps/dashboard/tests/api-client.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): typed ApiClient + shared API types

ApiClient wraps fetch with Authorization injection, x-refreshed-token
capture, and ApiError throwing. credentials:'include' lets the httpOnly
cookie ride along. Types mirror the apps/api response shapes from Plan 2.
Tests cover JSON happy path, header injection, refresh-token capture,
non-2xx error mapping, and instanceof.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 5: Implement the SIWE login hook + httpOnly cookie issuance

**Files:**
- Create: `apps/dashboard/src/lib/auth.ts`
- Create: `apps/dashboard/src/hooks/use-siwe-login.ts`
- Create: `apps/dashboard/src/app/api/session/route.ts` (Next.js Route Handler that sets the httpOnly cookie)
- Create: `apps/dashboard/tests/use-siwe-login.test.tsx`

The SIWE handshake is:

1. Wallet connects via wagmi.
2. Hook requests a nonce from `apps/api` (`POST /auth/siwe-nonce`).
3. Hook builds a SIWE message (using the `siwe` package), asks wagmi to sign it (`useSignMessage`).
4. Hook posts `{ message, signature }` to `apps/api` (`POST /auth/siwe-verify`).
5. On success, hook receives `{ token, expiresAt }`. It seeds the in-memory token in `ApiClient` *and* posts the JWT to its own Next.js Route Handler (`POST /api/session`) which sets it as an httpOnly cookie. The cookie is the durable copy that survives page refresh; the in-memory copy is the fast path.

- [ ] **Step 5.1: Create `apps/dashboard/src/app/api/session/route.ts`**

```ts
import { NextResponse } from 'next/server'

const COOKIE_NAME = 'oa_session'
const FIFTEEN_MIN_SECONDS = 15 * 60

/**
 * POST /api/session
 * Body: { token: string }
 * Sets `oa_session` as an httpOnly, SameSite=Lax cookie. Used by the SIWE
 * hook to persist the JWT across page refreshes without exposing it to JS.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const token = (body as { token?: unknown } | null)?.token
  if (typeof token !== 'string' || token.split('.').length !== 3) {
    return NextResponse.json({ error: 'Missing or malformed token' }, { status: 400 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
    maxAge: FIFTEEN_MIN_SECONDS,
  })
  return res
}

/**
 * DELETE /api/session
 * Clears the cookie. Called from the dashboard's "log out" button.
 */
export async function DELETE(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true })
  res.cookies.set({
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
    maxAge: 0,
  })
  return res
}

/**
 * GET /api/session
 * Returns whether the cookie is present. The actual JWT is never returned
 * to the browser — `apps/api` reads it from the Authorization header via the
 * server-side proxy in `app/api/me/route.ts` (added in Task 6).
 */
export async function GET(req: Request): Promise<NextResponse> {
  const cookieHeader = req.headers.get('cookie') ?? ''
  const has = cookieHeader.split(';').some((c) => c.trim().startsWith(`${COOKIE_NAME}=`))
  return NextResponse.json({ authenticated: has })
}
```

- [ ] **Step 5.2: Create `apps/dashboard/src/lib/auth.ts`**

```ts
import { SiweMessage } from 'siwe'
import { getApiClient } from './api-client'
import type { SiweNonceResponse, SiweVerifyResponse } from '@/types/api'

export interface SiweRequest {
  address: string
  chainId: number
  domain: string
  uri: string
}

/**
 * Step (a) of SIWE: fetch a one-time nonce from apps/api.
 */
export async function fetchSiweNonce(): Promise<string> {
  const client = getApiClient()
  const res = await client.post<SiweNonceResponse>('/auth/siwe-nonce')
  return res.nonce
}

/**
 * Step (b) of SIWE: build the EIP-4361 message string. The dashboard signs
 * this with the connected wallet via wagmi's useSignMessage in the hook.
 */
export function buildSiweMessageString(req: SiweRequest, nonce: string): string {
  const siwe = new SiweMessage({
    domain: req.domain,
    address: req.address,
    nonce,
    chainId: req.chainId,
    statement: 'Sign in to Open Agents',
    uri: req.uri,
    version: '1',
    issuedAt: new Date().toISOString(),
    expirationTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  })
  return siwe.prepareMessage()
}

/**
 * Step (c) of SIWE: post message + signature; receive a JWT.
 */
export async function verifySiwe(message: string, signature: string): Promise<SiweVerifyResponse> {
  const client = getApiClient()
  return client.post<SiweVerifyResponse>('/auth/siwe-verify', { message, signature })
}

/**
 * Step (d) of SIWE: persist the JWT as an httpOnly cookie via our own Next.js
 * Route Handler so it survives page refresh.
 */
export async function setSessionCookie(token: string): Promise<void> {
  const res = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!res.ok) throw new Error(`Failed to set session cookie: ${res.status}`)
}

export async function clearSessionCookie(): Promise<void> {
  await fetch('/api/session', { method: 'DELETE' })
}
```

- [ ] **Step 5.3: Write the failing test for the hook**

Create `apps/dashboard/tests/use-siwe-login.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSiweLogin } from '@/hooks/use-siwe-login'

// Mock wagmi hooks: connect address + signMessageAsync.
vi.mock('wagmi', () => ({
  useAccount: () => ({ address: '0x1111111111111111111111111111111111111111', chainId: 8453 }),
  useSignMessage: () => ({
    signMessageAsync: vi.fn().mockResolvedValue('0xdeadbeef'),
  }),
}))

vi.mock('@/lib/auth', () => ({
  fetchSiweNonce: vi.fn().mockResolvedValue('test-nonce-123'),
  buildSiweMessageString: vi.fn().mockReturnValue('siwe-message-body'),
  verifySiwe: vi.fn().mockResolvedValue({
    token: 'header.payload.sig',
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
  }),
  setSessionCookie: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/api-client', () => ({
  getApiClient: () => ({
    setToken: vi.fn(),
    getToken: () => null,
  }),
  ApiError: class extends Error {},
}))

describe('useSiweLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs the full SIWE flow on login() and reports success', async () => {
    const { result } = renderHook(() => useSiweLogin())
    expect(result.current.status).toBe('idle')

    await act(async () => {
      await result.current.login()
    })

    expect(result.current.status).toBe('authenticated')
    expect(result.current.error).toBeNull()
  })

  it('captures errors and surfaces them in `error`', async () => {
    const auth = await import('@/lib/auth')
    vi.mocked(auth.verifySiwe).mockRejectedValueOnce(new Error('bad signature'))

    const { result } = renderHook(() => useSiweLogin())
    await act(async () => {
      await result.current.login()
    })
    expect(result.current.status).toBe('error')
    expect(result.current.error?.message).toContain('bad signature')
  })
})
```

- [ ] **Step 5.4: Run the test to verify it fails**

```bash
cd apps/dashboard
pnpm test
```

Expected: FAIL — `@/hooks/use-siwe-login` does not exist.

- [ ] **Step 5.5: Create `apps/dashboard/src/hooks/use-siwe-login.ts`**

```ts
'use client'

import { useCallback, useState } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import {
  buildSiweMessageString,
  fetchSiweNonce,
  setSessionCookie,
  verifySiwe,
} from '@/lib/auth'
import { getApiClient } from '@/lib/api-client'

export type SiweStatus = 'idle' | 'requesting-nonce' | 'awaiting-signature' | 'verifying' | 'authenticated' | 'error'

export interface UseSiweLoginResult {
  status: SiweStatus
  error: Error | null
  login: () => Promise<void>
  reset: () => void
}

/**
 * Drives the SIWE handshake from the connect-wallet button. The dashboard
 * landing page calls `login()` once the user has connected a wallet and
 * clicked "Sign in"; we then move through nonce → sign → verify, and on
 * success we set the in-memory token in ApiClient AND hit /api/session
 * to set the durable httpOnly cookie.
 */
export function useSiweLogin(): UseSiweLoginResult {
  const [status, setStatus] = useState<SiweStatus>('idle')
  const [error, setError] = useState<Error | null>(null)

  const { address, chainId } = useAccount()
  const { signMessageAsync } = useSignMessage()

  const login = useCallback(async () => {
    if (!address) {
      setError(new Error('Wallet not connected'))
      setStatus('error')
      return
    }
    setError(null)
    try {
      setStatus('requesting-nonce')
      const nonce = await fetchSiweNonce()

      setStatus('awaiting-signature')
      const message = buildSiweMessageString(
        {
          address,
          chainId: chainId ?? 8453,
          domain: typeof window !== 'undefined' ? window.location.host : 'localhost',
          uri: typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
        },
        nonce,
      )
      const signature = await signMessageAsync({ message })

      setStatus('verifying')
      const { token } = await verifySiwe(message, signature)

      // Memory copy (fast path) + cookie (durable copy).
      getApiClient().setToken(token)
      await setSessionCookie(token)

      setStatus('authenticated')
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      setStatus('error')
    }
  }, [address, chainId, signMessageAsync])

  const reset = useCallback(() => {
    setStatus('idle')
    setError(null)
  }, [])

  return { status, error, login, reset }
}
```

- [ ] **Step 5.6: Run the test to verify it passes**

```bash
pnpm test
```

Expected: 8 tests passing (1 sanity + 5 api-client + 2 siwe-login).

- [ ] **Step 5.7: Commit**

```bash
cd ../..
git add apps/dashboard/src/lib/auth.ts apps/dashboard/src/hooks/use-siwe-login.ts \
  apps/dashboard/src/app/api/session/route.ts apps/dashboard/tests/use-siwe-login.test.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): SIWE login hook + httpOnly cookie route

useSiweLogin orchestrates nonce → wagmi signMessageAsync → /auth/siwe-verify
→ ApiClient.setToken + /api/session POST. Next.js Route Handler at
/api/session sets `oa_session` as httpOnly SameSite=Lax. Tests mock wagmi
+ auth helpers and assert success and error transitions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `useMe` hook with rolling refresh

**Files:**
- Create: `apps/dashboard/src/app/api/me/route.ts` (server proxy that forwards the cookie as Bearer)
- Create: `apps/dashboard/src/hooks/use-me.ts`
- Create: `apps/dashboard/tests/use-me.test.tsx`

The `/me` poller is the authoritative source for "who am I + which agents do I own". It also implements rolling JWT refresh: every successful response carries `x-refreshed-token`, which `ApiClient` already captures into the in-memory token. We additionally re-issue the cookie via `/api/session` whenever the refreshed token differs from the cookie's current value.

Because `apps/api` requires the `Authorization: Bearer` header (it does not read cookies), and the dashboard wants to keep the JWT httpOnly, we proxy `/me` through a Next.js Route Handler that reads the cookie server-side and adds the header before forwarding.

- [ ] **Step 6.1: Create `apps/dashboard/src/app/api/me/route.ts`**

```ts
import { NextResponse } from 'next/server'

const COOKIE_NAME = 'oa_session'
const FIFTEEN_MIN_SECONDS = 15 * 60

function readCookie(req: Request): string | null {
  const header = req.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [k, v] = part.trim().split('=')
    if (k === COOKIE_NAME) return v ?? null
  }
  return null
}

/**
 * GET /api/me
 * Server-side proxy. Reads the httpOnly oa_session cookie, attaches it as a
 * Bearer header, forwards to apps/api's /me. Surfaces apps/api's body and
 * status. If x-refreshed-token comes back, we update the cookie inline so
 * the session keeps rolling without round-tripping through the SIWE hook.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const token = readCookie(req)
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'
  const upstream = await fetch(`${apiUrl}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  const body = await upstream.text()
  const res = new NextResponse(body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  })

  const refreshed = upstream.headers.get('x-refreshed-token')
  if (refreshed && refreshed !== token) {
    res.cookies.set({
      name: COOKIE_NAME,
      value: refreshed,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env['NODE_ENV'] === 'production',
      path: '/',
      maxAge: FIFTEEN_MIN_SECONDS,
    })
    // Also surface the refreshed token to the client-side ApiClient so the
    // memory copy stays in sync.
    res.headers.set('x-refreshed-token', refreshed)
  }

  return res
}
```

- [ ] **Step 6.2: Write the failing test**

Create `apps/dashboard/tests/use-me.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { ReactNode } from 'react'
import { useMe } from '@/hooks/use-me'

function wrapper({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
}

describe('useMe', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns data on a 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ownerEoa: '0xabc', agents: [{ id: 'a1', subnameLabel: 'mybot' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useMe(), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data!.ownerEoa).toBe('0xabc')
    expect(result.current.data!.agents).toHaveLength(1)
  })

  it('exposes 401 as a not-authenticated state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useMe(), { wrapper })
    await waitFor(() => expect(result.current.error).toBeDefined())
    expect(result.current.isAuthenticated).toBe(false)
  })

  it('forwards refreshed token to ApiClient when present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ownerEoa: '0xabc', agents: [] }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-refreshed-token': 'rolling-jwt-2',
          },
        },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useMe(), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    // The hook reads the header off the Response and sets it on ApiClient.
    const { getApiClient } = await import('@/lib/api-client')
    expect(getApiClient().getToken()).toBe('rolling-jwt-2')
  })
})
```

- [ ] **Step 6.3: Run the test to verify it fails**

```bash
cd apps/dashboard
pnpm test
```

Expected: FAIL — `@/hooks/use-me` does not exist.

- [ ] **Step 6.4: Create `apps/dashboard/src/hooks/use-me.ts`**

```ts
'use client'

import useSWR from 'swr'
import { getApiClient } from '@/lib/api-client'
import type { MeResponse } from '@/types/api'

interface MeFetchResult {
  data: MeResponse | null
  status: number
}

async function fetchMe(): Promise<MeFetchResult> {
  // We hit the Next.js Route Handler at /api/me (NOT apps/api directly).
  // The handler reads the httpOnly cookie server-side and adds the Bearer
  // header before forwarding.
  const res = await fetch('/api/me', { credentials: 'include' })

  // Pass any refreshed token back into the in-memory ApiClient.
  const refreshed = res.headers.get('x-refreshed-token')
  if (refreshed) getApiClient().setToken(refreshed)

  if (res.status === 401) return { data: null, status: 401 }
  if (!res.ok) throw new Error(`/me failed: ${res.status}`)

  const body = (await res.json()) as MeResponse
  return { data: body, status: 200 }
}

export interface UseMeResult {
  data: MeResponse | undefined
  error: Error | undefined
  isAuthenticated: boolean
  isLoading: boolean
  mutate: () => Promise<unknown>
}

/**
 * Polls /api/me. SWR refreshes every 60s (rolling token refresh) and
 * dedupes within 30s. A 401 surfaces as `isAuthenticated: false` rather
 * than an exception, so the UI can route the user to /onboard cleanly.
 */
export function useMe(): UseMeResult {
  const { data, error, isLoading, mutate } = useSWR<MeFetchResult, Error>('/api/me', fetchMe, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  })

  const isAuthenticated = !!data && data.status === 200 && !!data.data
  return {
    data: data?.data ?? undefined,
    error,
    isAuthenticated,
    isLoading,
    mutate,
  }
}
```

- [ ] **Step 6.5: Run tests to verify they pass**

```bash
pnpm test
```

Expected: 11 tests passing (1 sanity + 5 api-client + 2 siwe-login + 3 use-me).

- [ ] **Step 6.6: Commit**

```bash
cd ../..
git add apps/dashboard/src/app/api/me/route.ts apps/dashboard/src/hooks/use-me.ts \
  apps/dashboard/tests/use-me.test.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): /me proxy + useMe SWR hook with rolling refresh

Next.js Route Handler /api/me reads oa_session cookie, forwards as Bearer,
mirrors x-refreshed-token back to the browser AND rotates the cookie.
useMe is an SWR poller (60s) that surfaces 401 as isAuthenticated=false
and feeds refreshed tokens into the in-memory ApiClient.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 7: Add shadcn/ui primitives the wizard needs

**Files:**
- Create: `apps/dashboard/src/lib/cn.ts`
- Create: `apps/dashboard/src/components/ui/button.tsx`
- Create: `apps/dashboard/src/components/ui/input.tsx`
- Create: `apps/dashboard/src/components/ui/label.tsx`
- Create: `apps/dashboard/src/components/ui/card.tsx`
- Create: `apps/dashboard/src/components/ui/textarea.tsx`
- Create: `apps/dashboard/src/components/ui/badge.tsx`

We hand-write these primitives matching the shadcn/ui defaults rather than running `npx shadcn add`, because the CLI requires interactive prompts that don't fit a non-interactive plan execution. The output is identical to a fresh `shadcn init` + `shadcn add button input label card textarea badge`.

- [ ] **Step 7.1: Create `apps/dashboard/src/lib/cn.ts`**

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 7.2: Create `apps/dashboard/src/components/ui/button.tsx`**

```tsx
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90',
        outline: 'border border-border bg-background hover:bg-muted',
        ghost: 'hover:bg-muted',
        destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3',
        lg: 'h-11 px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
)
Button.displayName = 'Button'
```

- [ ] **Step 7.3: Create `apps/dashboard/src/components/ui/input.tsx`**

```tsx
import * as React from 'react'
import { cn } from '@/lib/cn'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'
```

- [ ] **Step 7.4: Create `apps/dashboard/src/components/ui/label.tsx`**

```tsx
import * as React from 'react'
import { cn } from '@/lib/cn'

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn('text-sm font-medium leading-none', className)} {...props} />
  ),
)
Label.displayName = 'Label'
```

- [ ] **Step 7.5: Create `apps/dashboard/src/components/ui/card.tsx`**

```tsx
import * as React from 'react'
import { cn } from '@/lib/cn'

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-lg border border-border bg-card text-card-foreground shadow-sm', className)}
      {...props}
    />
  ),
)
Card.displayName = 'Card'

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
  ),
)
CardHeader.displayName = 'CardHeader'

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('text-2xl font-semibold leading-none tracking-tight', className)} {...props} />
  ),
)
CardTitle.displayName = 'CardTitle'

export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
  ),
)
CardDescription.displayName = 'CardDescription'

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  ),
)
CardContent.displayName = 'CardContent'

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
  ),
)
CardFooter.displayName = 'CardFooter'
```

- [ ] **Step 7.6: Create `apps/dashboard/src/components/ui/textarea.tsx`**

```tsx
import * as React from 'react'
import { cn } from '@/lib/cn'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
```

- [ ] **Step 7.7: Create `apps/dashboard/src/components/ui/badge.tsx`**

```tsx
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-muted text-muted-foreground',
        outline: 'border-border text-foreground',
        success: 'border-transparent bg-emerald-500 text-white',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
```

- [ ] **Step 7.8: Verify the dashboard still builds**

```bash
cd apps/dashboard
pnpm build
```

Expected: build succeeds.

- [ ] **Step 7.9: Commit**

```bash
cd ../..
git add apps/dashboard/src/lib/cn.ts apps/dashboard/src/components/ui/
git commit -m "$(cat <<'EOF'
feat(dashboard): shadcn/ui primitives — Button, Input, Label, Card, Textarea, Badge

Hand-written equivalents of `shadcn add button input label card textarea badge`.
cn() merges tailwind classes via clsx + tailwind-merge. Variants powered by
class-variance-authority. Used by every wizard step + records form.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Wizard shell + zustand state store + progress component

**Files:**
- Create: `apps/dashboard/src/app/onboard/_store.ts`
- Create: `apps/dashboard/src/components/wizard-progress.tsx`
- Create: `apps/dashboard/src/app/onboard/page.tsx`

The wizard is a single page that renders one of five step components based on `step` in the zustand store. Step transitions are linear: a step component dispatches `next()` once it has succeeded. Refreshing the page resets to step 1 — wizard state is intentionally non-persistent because each step's side effects (DB row, on-chain tx) ARE the durable state.

- [ ] **Step 8.1: Create `apps/dashboard/src/app/onboard/_store.ts`**

```ts
import { create } from 'zustand'

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 'done'

export interface WizardState {
  step: WizardStep

  // Step 1 outputs
  agentRowId: string | null         // UUID returned by POST /agents
  subnameLabel: string | null

  // Step 2 outputs
  viewKeyHex: string | null         // 32-byte hex placeholder produced by deriveViewKeyStub

  // Step 3 outputs
  agentIdOnchain: string | null     // "8453:42"
  registerTxHash: `0x${string}` | null

  // Step 4 outputs
  treasurySafeAddress: `0x${string}` | null
  treasuryDeployTxHash: `0x${string}` | null

  setSubname: (id: string, label: string) => void
  setViewKey: (hex: string) => void
  setOnchain: (agentId: string, txHash: `0x${string}`) => void
  setTreasury: (safeAddress: `0x${string}`, deployTxHash: `0x${string}`) => void
  next: () => void
  reset: () => void
}

export const useWizardStore = create<WizardState>((set) => ({
  step: 1,
  agentRowId: null,
  subnameLabel: null,
  viewKeyHex: null,
  agentIdOnchain: null,
  registerTxHash: null,
  treasurySafeAddress: null,
  treasuryDeployTxHash: null,

  setSubname: (id, label) => set({ agentRowId: id, subnameLabel: label }),
  setViewKey: (hex) => set({ viewKeyHex: hex }),
  setOnchain: (agentId, txHash) => set({ agentIdOnchain: agentId, registerTxHash: txHash }),
  setTreasury: (safeAddress, deployTxHash) => set({ treasurySafeAddress: safeAddress, treasuryDeployTxHash: deployTxHash }),

  next: () =>
    set((s) => {
      if (s.step === 'done') return s
      const order: WizardStep[] = [1, 2, 3, 4, 5, 'done']
      const idx = order.indexOf(s.step)
      return { step: order[Math.min(idx + 1, order.length - 1)] ?? 'done' }
    }),
  reset: () =>
    set({
      step: 1,
      agentRowId: null,
      subnameLabel: null,
      viewKeyHex: null,
      agentIdOnchain: null,
      registerTxHash: null,
      treasurySafeAddress: null,
      treasuryDeployTxHash: null,
    }),
}))
```

- [ ] **Step 8.2: Create `apps/dashboard/src/components/wizard-progress.tsx`**

```tsx
import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'

const STEPS = [
  { idx: 1, label: 'Subname' },
  { idx: 2, label: 'View key' },
  { idx: 3, label: 'On-chain' },
  { idx: 4, label: 'Treasury' },
  { idx: 5, label: 'Records' },
] as const

export interface WizardProgressProps {
  current: number | 'done'
}

export function WizardProgress({ current }: WizardProgressProps) {
  const currentNum = current === 'done' ? 6 : current
  return (
    <ol className="flex items-center justify-between gap-2">
      {STEPS.map((s) => {
        const completed = currentNum > s.idx
        const active = currentNum === s.idx
        return (
          <li key={s.idx} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold',
                completed && 'border-primary bg-primary text-primary-foreground',
                active && !completed && 'border-primary text-primary',
                !completed && !active && 'border-border text-muted-foreground',
              )}
            >
              {completed ? <Check size={14} /> : s.idx}
            </span>
            <span
              className={cn(
                'text-sm',
                active ? 'font-semibold text-foreground' : 'text-muted-foreground',
              )}
            >
              {s.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
```

- [ ] **Step 8.3: Create `apps/dashboard/src/app/onboard/page.tsx`**

This file boots the wizard and dispatches to step components added in Tasks 9–13. We stub each step with a placeholder paragraph for now; subsequent tasks replace the imports.

```tsx
'use client'

import { useEffect } from 'react'
import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ConnectButton } from '@/components/connect-button'
import { WizardProgress } from '@/components/wizard-progress'
import { useWizardStore } from './_store'
import { useSiweLogin } from '@/hooks/use-siwe-login'
import { useMe } from '@/hooks/use-me'
import { Step1Subname } from './_steps/step-1-subname'
import { Step2ViewKey } from './_steps/step-2-viewkey'
import { Step3Register } from './_steps/step-3-register'
import { Step4Treasury } from './_steps/step-4-treasury'
import { Step5Records } from './_steps/step-5-records'
import { Button } from '@/components/ui/button'

export default function OnboardPage() {
  const { isConnected } = useAccount()
  const { isAuthenticated } = useMe()
  const { status, login, error } = useSiweLogin()
  const step = useWizardStore((s) => s.step)
  const router = useRouter()

  useEffect(() => {
    if (step === 'done') router.push('/dashboard')
  }, [step, router])

  if (!isConnected) {
    return (
      <main className="mx-auto max-w-xl p-6 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Connect your wallet</CardTitle>
            <CardDescription>
              Onboarding starts with a wallet connection. We never see your private key.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConnectButton />
          </CardContent>
        </Card>
      </main>
    )
  }

  if (!isAuthenticated) {
    return (
      <main className="mx-auto max-w-xl p-6 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Sign a one-time message to prove you control this wallet. No gas, no transaction.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button disabled={status === 'requesting-nonce' || status === 'verifying'} onClick={login}>
              {status === 'idle' || status === 'authenticated' ? 'Sign in with wallet' :
                status === 'requesting-nonce' ? 'Requesting nonce…' :
                status === 'awaiting-signature' ? 'Check your wallet…' :
                status === 'verifying' ? 'Verifying…' :
                'Try again'}
            </Button>
            {error && <p className="text-sm text-destructive">{error.message}</p>}
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-2xl p-6 py-12 space-y-6">
      <WizardProgress current={step} />
      {step === 1 && <Step1Subname />}
      {step === 2 && <Step2ViewKey />}
      {step === 3 && <Step3Register />}
      {step === 4 && <Step4Treasury />}
      {step === 5 && <Step5Records />}
    </main>
  )
}
```

- [ ] **Step 8.4: Create empty step component files so the imports resolve**

The actual implementations land in Tasks 9–13. To keep this task atomic, create minimal stubs.

`apps/dashboard/src/app/onboard/_steps/step-1-subname.tsx`:

```tsx
'use client'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
export function Step1Subname() {
  return (
    <Card><CardHeader><CardTitle>Step 1 — Subname (placeholder, Task 9 implements)</CardTitle></CardHeader></Card>
  )
}
```

`apps/dashboard/src/app/onboard/_steps/step-2-viewkey.tsx`:

```tsx
'use client'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
export function Step2ViewKey() {
  return (
    <Card><CardHeader><CardTitle>Step 2 — View key (placeholder, Task 10 implements)</CardTitle></CardHeader></Card>
  )
}
```

`apps/dashboard/src/app/onboard/_steps/step-3-register.tsx`:

```tsx
'use client'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
export function Step3Register() {
  return (
    <Card><CardHeader><CardTitle>Step 3 — Register on-chain (placeholder, Task 11 implements)</CardTitle></CardHeader></Card>
  )
}
```

`apps/dashboard/src/app/onboard/_steps/step-4-treasury.tsx`:

```tsx
'use client'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
export function Step4Treasury() {
  return (
    <Card><CardHeader><CardTitle>Step 4 — Treasury Safe (placeholder, Task 12 implements)</CardTitle></CardHeader></Card>
  )
}
```

`apps/dashboard/src/app/onboard/_steps/step-5-records.tsx`:

```tsx
'use client'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
export function Step5Records() {
  return (
    <Card><CardHeader><CardTitle>Step 5 — Records (placeholder, Task 13 implements)</CardTitle></CardHeader></Card>
  )
}
```

- [ ] **Step 8.5: Verify the page renders end-to-end against the dev server**

```bash
cd apps/dashboard
NEXT_PUBLIC_API_URL=http://localhost:3001 \
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=placeholder-for-local-dev \
pnpm dev
```

Open http://localhost:3002/onboard. Expected:
- Without a connected wallet → "Connect your wallet" card.
- After connect (no JWT cookie yet) → "Sign in" card with a button that hits the SIWE flow.
- After successful SIWE → progress bar at step 1 + the placeholder card for step 1.

Stop with Ctrl-C.

- [ ] **Step 8.6: Commit**

```bash
cd ../..
git add apps/dashboard/src/app/onboard/_store.ts apps/dashboard/src/components/wizard-progress.tsx \
  apps/dashboard/src/app/onboard/page.tsx apps/dashboard/src/app/onboard/_steps/
git commit -m "$(cat <<'EOF'
feat(dashboard): wizard shell + zustand store + progress indicator

/onboard page gates on isConnected → SIWE login → 5-step wizard. Zustand
store holds per-step outputs (agentRowId, viewKeyHex, agentIdOnchain,
treasurySafeAddress) and a linear next() transition. Step components are
placeholders; Tasks 9-13 fill them in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 9: Wizard step 1 — claim subname

**Files:**
- Replace: `apps/dashboard/src/app/onboard/_steps/step-1-subname.tsx`
- Create: `apps/dashboard/src/hooks/use-create-agent.ts`

The flow:

1. User types a label.
2. We validate against `^[a-z0-9-]{1,63}$` (the same regex `apps/api` enforces in `createAgentSchema` from Plan 2).
3. On submit, POST `/agents` with `subnameLabel` + a placeholder `baseAddr` (the connected wallet address — Plan 4 will overwrite this with the stealth meta-address derivation address).
4. On 201 → store the returned UUID + label in zustand and call `next()`.
5. On 409 → toast "That name is taken. Try another."

- [ ] **Step 9.1: Create `apps/dashboard/src/hooks/use-create-agent.ts`**

```ts
'use client'

import { useCallback, useState } from 'react'
import { ApiError, getApiClient } from '@/lib/api-client'
import type { AgentResponse, CreateAgentBody } from '@/types/api'

export interface UseCreateAgentResult {
  create: (body: CreateAgentBody) => Promise<AgentResponse | null>
  isPending: boolean
  error: { code: 'conflict' | 'unknown'; message: string } | null
}

/**
 * Wraps POST /agents. Translates the 409 unique-violation case into a
 * structured error so the UI can render a label-specific message rather
 * than a generic "something went wrong".
 */
export function useCreateAgent(): UseCreateAgentResult {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<UseCreateAgentResult['error']>(null)

  const create = useCallback(async (body: CreateAgentBody) => {
    setIsPending(true)
    setError(null)
    try {
      const agent = await getApiClient().post<AgentResponse>('/agents', body)
      return agent
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError({ code: 'conflict', message: err.message })
      } else {
        setError({ code: 'unknown', message: err instanceof Error ? err.message : String(err) })
      }
      return null
    } finally {
      setIsPending(false)
    }
  }, [])

  return { create, isPending, error }
}
```

- [ ] **Step 9.2: Replace `apps/dashboard/src/app/onboard/_steps/step-1-subname.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { useAccount } from 'wagmi'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useWizardStore } from '../_store'
import { useCreateAgent } from '@/hooks/use-create-agent'

const LABEL_REGEX = /^[a-z0-9-]{1,63}$/

const PARENT_DOMAIN = process.env['NEXT_PUBLIC_PARENT_DOMAIN'] ?? 'gabhru.eth'

export function Step1Subname() {
  const [label, setLabel] = useState('')
  const { address } = useAccount()
  const { setSubname, next } = useWizardStore()
  const { create, isPending, error } = useCreateAgent()

  const labelValid = LABEL_REGEX.test(label)

  async function handleSubmit() {
    if (!address) {
      toast.error('Wallet not connected')
      return
    }
    if (!labelValid) {
      toast.error('Use 1–63 lowercase letters, numbers, or hyphens')
      return
    }
    const agent = await create({
      subnameLabel: label,
      baseAddr: address,    // placeholder until Plan 4 fills in the stealth derivation address
      textRecords: {},
    })
    if (!agent) {
      if (error?.code === 'conflict') {
        toast.error(`'${label}.${PARENT_DOMAIN}' is taken — try another label`)
      } else if (error) {
        toast.error(error.message)
      }
      return
    }
    setSubname(agent.id, agent.subnameLabel)
    toast.success(`Reserved ${agent.subnameLabel}.${PARENT_DOMAIN}`)
    next()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pick your agent name</CardTitle>
        <CardDescription>
          You will receive payments at <code>&lt;name&gt;.{PARENT_DOMAIN}</code>. Lowercase letters,
          digits, and hyphens only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="label">Subname</Label>
          <div className="flex items-center gap-2">
            <Input
              id="label"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="mybot"
              value={label}
              onChange={(e) => setLabel(e.target.value.toLowerCase())}
            />
            <span className="text-sm text-muted-foreground">.{PARENT_DOMAIN}</span>
          </div>
          {label && !labelValid && (
            <p className="text-xs text-destructive">
              Use 1–63 characters: lowercase letters, digits, or hyphens.
            </p>
          )}
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <Button disabled={!labelValid || isPending} onClick={handleSubmit}>
          {isPending ? 'Reserving…' : 'Reserve subname'}
        </Button>
      </CardFooter>
    </Card>
  )
}
```

- [ ] **Step 9.3: Smoke-test step 1 manually**

Boot the dashboard, connect a wallet, sign in, enter a label like `smoketest1`, click "Reserve subname". Expected:
- `POST /agents` returns 201.
- Store `agentRowId` is set, wizard advances to step 2 (placeholder still in place).
- Repeating the same label produces a 409 → red toast "is taken — try another label".

```bash
cd apps/dashboard
NEXT_PUBLIC_API_URL=http://localhost:3001 \
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=placeholder-for-local-dev \
pnpm dev
```

(Stop with Ctrl-C when satisfied.)

- [ ] **Step 9.4: Commit**

```bash
cd ../..
git add apps/dashboard/src/hooks/use-create-agent.ts apps/dashboard/src/app/onboard/_steps/step-1-subname.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): wizard step 1 — claim subname

useCreateAgent wraps POST /agents and structures 409 as a 'conflict'
error code. Step 1 form validates label against ^[a-z0-9-]{1,63}$ and
shows a red toast on conflict. baseAddr defaults to the connected EOA;
Plan 4 will overwrite this with the stealth derivation address.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Wizard step 2 — view-key stub derivation

**Files:**
- Create: `apps/dashboard/src/lib/stealth-stub.ts`
- Create: `apps/dashboard/tests/stealth-stub.test.ts`
- Replace: `apps/dashboard/src/app/onboard/_steps/step-2-viewkey.tsx`

This step asks the user to sign a fixed message with their EOA, then computes a 32-byte hex placeholder = `keccak256(signatureBytes)`. We PATCH `/agents/:id` with `viewKeyEncrypted = "stub:<hex>"`. The `stub:` prefix flags the value as a Plan 3 placeholder so Plan 4 can detect rows that need re-derivation.

**Plan 4 will replace this end-to-end** with `fluidkey-stealth-account-kit.generateKeysFromSignature`, which produces a real `viewPrivKey` plus `spendPrivKey`, encrypts `viewPrivKey` with a backend KMS key, and writes the actual ciphertext into `viewKeyEncrypted`. The stub keeps the wizard flow continuous in Plan 3 without pulling in stealth-crypto deps.

- [ ] **Step 10.1: Write the failing test**

Create `apps/dashboard/tests/stealth-stub.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { deriveViewKeyStub, STEALTH_DERIVATION_MESSAGE } from '@/lib/stealth-stub'

describe('STEALTH_DERIVATION_MESSAGE', () => {
  it('matches the Plan 3 v1 derivation message', () => {
    expect(STEALTH_DERIVATION_MESSAGE).toBe(
      'gabhru.eth: derive stealth keys for agent on Base mainnet (v1)',
    )
  })
})

describe('deriveViewKeyStub', () => {
  it('returns a 32-byte hex string for any signature input', () => {
    const out = deriveViewKeyStub('0xdeadbeef')
    expect(out).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('is deterministic — same signature → same key', () => {
    const sig = '0x' + 'ab'.repeat(65)
    const a = deriveViewKeyStub(sig)
    const b = deriveViewKeyStub(sig)
    expect(a).toBe(b)
  })

  it('is signature-sensitive — different signatures → different keys', () => {
    const a = deriveViewKeyStub('0x' + 'ab'.repeat(65))
    const b = deriveViewKeyStub('0x' + 'cd'.repeat(65))
    expect(a).not.toBe(b)
  })

  it('throws on a non-hex input', () => {
    expect(() => deriveViewKeyStub('not-hex')).toThrow()
  })
})
```

- [ ] **Step 10.2: Run the test to verify it fails**

```bash
cd apps/dashboard
pnpm test
```

Expected: FAIL — `@/lib/stealth-stub` does not exist.

- [ ] **Step 10.3: Create `apps/dashboard/src/lib/stealth-stub.ts`**

```ts
import { keccak256, type Hex } from 'viem'

/**
 * Fixed, domain-separated message that the wizard asks the owner EOA to sign.
 * MUST stay byte-identical between Plan 3 (stub) and Plan 4 (real derivation)
 * so that re-running the wizard regenerates the same keys.
 */
export const STEALTH_DERIVATION_MESSAGE =
  'gabhru.eth: derive stealth keys for agent on Base mainnet (v1)'

/**
 * Plan 3 PLACEHOLDER. Returns a 32-byte hex blob that is deterministic in the
 * input signature but is NOT a real ERC-5564 view private key.
 *
 * Plan 4 replaces this entirely with fluidkey-stealth-account-kit's
 * generateKeysFromSignature, which yields the real (spendPrivKey, viewPrivKey)
 * pair plus the public meta-address. Until then, the API persists this stub
 * so the onboarding flow has continuous state. Rows tagged `stub:` are
 * re-derived during the Plan 4 migration.
 */
export function deriveViewKeyStub(signatureHex: string): Hex {
  if (!/^0x[0-9a-fA-F]+$/.test(signatureHex)) {
    throw new Error('deriveViewKeyStub: input must be 0x-prefixed hex')
  }
  return keccak256(signatureHex as Hex)
}

/**
 * Wraps the stub key in a `stub:` prefix so the backend can identify
 * placeholder rows during the Plan 4 migration. Stored verbatim in
 * the agents.view_key_encrypted column for Plan 3.
 */
export function packStubViewKeyForApi(viewKeyHex: Hex): string {
  return `stub:${viewKeyHex}`
}
```

- [ ] **Step 10.4: Run the test to verify it passes**

```bash
pnpm test
```

Expected: 4 stealth-stub tests passing alongside the earlier suites.

- [ ] **Step 10.5: Replace `apps/dashboard/src/app/onboard/_steps/step-2-viewkey.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { useSignMessage } from 'wagmi'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useWizardStore } from '../_store'
import {
  STEALTH_DERIVATION_MESSAGE,
  deriveViewKeyStub,
  packStubViewKeyForApi,
} from '@/lib/stealth-stub'
import { getApiClient } from '@/lib/api-client'
import type { AgentResponse } from '@/types/api'

export function Step2ViewKey() {
  const { agentRowId, setViewKey, next } = useWizardStore()
  const { signMessageAsync } = useSignMessage()
  const [isWorking, setIsWorking] = useState(false)

  async function handleDerive() {
    if (!agentRowId) {
      toast.error('Missing agent — restart the wizard')
      return
    }
    setIsWorking(true)
    try {
      const sig = await signMessageAsync({ message: STEALTH_DERIVATION_MESSAGE })
      const viewKeyHex = deriveViewKeyStub(sig)
      const ciphertext = packStubViewKeyForApi(viewKeyHex)

      await getApiClient().patch<AgentResponse>(`/agents/${agentRowId}`, {
        viewKeyEncrypted: ciphertext,
      })

      setViewKey(viewKeyHex)
      toast.success('View key derived (Plan 3 stub)')
      next()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Derive your stealth view key <Badge variant="secondary">stub</Badge>
        </CardTitle>
        <CardDescription>
          Sign a fixed message with your wallet — no gas, no transaction. The signature deterministically
          derives a 32-byte placeholder view key. The real ERC-5564 derivation lands in the next release;
          your subname will keep working through the upgrade.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
          {STEALTH_DERIVATION_MESSAGE}
        </p>
        <p className="text-xs text-muted-foreground">
          Re-signing the same message in the same wallet always produces the same key. If you ever lose your
          local copy, return here and re-derive.
        </p>
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={handleDerive} disabled={isWorking}>
          {isWorking ? 'Check your wallet…' : 'Sign and derive'}
        </Button>
      </CardFooter>
    </Card>
  )
}
```

- [ ] **Step 10.6: Smoke-test step 2 manually**

Continue the wizard from step 1. Click "Sign and derive". Expected:
- Wallet pops up requesting a signature on the fixed message.
- After signing, the wizard advances to step 3.
- A round-trip to `apps/api` writes `view_key_encrypted = 'stub:0x...'` for the row. Verify in psql:

```bash
docker exec -it $(docker compose -f docker-compose.dev.yml ps -q postgres) \
  psql -U open_agents -d open_agents -c "SELECT subname_label, substring(view_key_encrypted from 1 for 16) FROM agents ORDER BY created_at DESC LIMIT 1;"
```

Expected: `view_key_encrypted` starts with `stub:0x`.

- [ ] **Step 10.7: Commit**

```bash
cd ../..
git add apps/dashboard/src/lib/stealth-stub.ts apps/dashboard/tests/stealth-stub.test.ts \
  apps/dashboard/src/app/onboard/_steps/step-2-viewkey.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): wizard step 2 — view-key stub derivation

deriveViewKeyStub(sig) returns keccak256(sig) as a deterministic 32-byte
placeholder. STEALTH_DERIVATION_MESSAGE is the same fixed string Plan 4
will keep using for the real Fluidkey derivation. Step 2 signs the
message via wagmi, packs the result as 'stub:0x...', and PATCHes
viewKeyEncrypted. Tests verify determinism, sensitivity, and the
canonical message string.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 11: Backend — `POST /agents/:id/register-onchain` endpoint

**Files:**
- Modify: `apps/api/src/lib/identity-registry.ts` (add `parseRegisterReceipt`)
- Modify: `apps/api/src/routes/agents.ts` (add the new route)
- Create: `apps/api/tests/register-onchain.test.ts`

The endpoint accepts `{ txHash, agentId }`, fetches the receipt from Base via viem, verifies that:

1. The receipt is mined (`status === 'success'`).
2. The receipt's logs include the IdentityRegistry's ERC-721 `Transfer(from=0x0, to=callerOwner, tokenId=<int>)` event for the supplied numeric agent ID.
3. `getAgentWalletInfo(agentId)` confirms `ownerOf(agentId) === callerOwner`.

On success, it updates `agentId` and `agentWalletEoa` columns. The dashboard kicks off the user-side `register(...)` transaction via wagmi's `useWriteContract` and POSTs the resulting tx hash here once mined.

We chose the in-dashboard wagmi tx (rather than relaying through the API) because:
- The owner EOA has to sign — there's no key the API could use.
- Showing the user the actual tx in their wallet builds trust.
- The dashboard already has wagmi set up.

Decision recorded.

- [ ] **Step 11.1: Append `parseRegisterReceipt` to `apps/api/src/lib/identity-registry.ts`**

Append the following to `apps/api/src/lib/identity-registry.ts` (do not remove existing exports):

```ts
import { parseAbiItem, decodeEventLog, type TransactionReceipt, type Log } from 'viem'

const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
)

export interface RegisterReceiptCheck {
  rpcUrl: string
  registryAddress: Address
  txHash: `0x${string}`
  expectedTokenId: bigint
  expectedTo: Address
}

export interface RegisterReceiptResult {
  ok: boolean
  reason: string | null
}

/**
 * Verifies that `txHash` minted ERC-8004 token `expectedTokenId` to
 * `expectedTo` via the IdentityRegistry on Base mainnet.
 *
 * Returns { ok: false, reason } on any mismatch — the route turns this
 * into HTTP 400. Returns { ok: true } only when:
 *   1. status === 'success'
 *   2. Logs contain a Transfer(0x0, expectedTo, expectedTokenId) emitted by
 *      registryAddress.
 */
export async function checkRegisterReceipt(
  params: RegisterReceiptCheck,
): Promise<RegisterReceiptResult> {
  const client = createPublicClient({
    chain: base,
    transport: http(params.rpcUrl, { timeout: 5_000 }),
  })

  let receipt: TransactionReceipt
  try {
    receipt = await client.getTransactionReceipt({ hash: params.txHash })
  } catch (err) {
    return { ok: false, reason: `getTransactionReceipt failed: ${String(err)}` }
  }

  if (receipt.status !== 'success') {
    return { ok: false, reason: `tx status is ${receipt.status}` }
  }

  const registryLower = params.registryAddress.toLowerCase()
  const expectedToLower = params.expectedTo.toLowerCase()

  const matchingLog = receipt.logs.find((log: Log) => {
    if (log.address.toLowerCase() !== registryLower) return false
    try {
      const decoded = decodeEventLog({
        abi: [TRANSFER_EVENT],
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName !== 'Transfer') return false
      const args = decoded.args as { from: Address; to: Address; tokenId: bigint }
      return (
        args.from === '0x0000000000000000000000000000000000000000' &&
        args.to.toLowerCase() === expectedToLower &&
        args.tokenId === params.expectedTokenId
      )
    } catch {
      return false
    }
  })

  if (!matchingLog) {
    return {
      ok: false,
      reason: `no Transfer(0x0, ${params.expectedTo}, ${params.expectedTokenId}) log from ${params.registryAddress}`,
    }
  }

  return { ok: true, reason: null }
}
```

- [ ] **Step 11.2: Write the failing route test**

Create `apps/api/tests/register-onchain.test.ts`:

```ts
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mintJwt } from '@open-agents/auth'
import { createDb, insertAgent } from '@open-agents/db'

process.env['DATABASE_URL'] = 'postgres://open_agents:open_agents_dev@localhost:5432/open_agents'
process.env['JWT_SECRET'] = 'test-secret-at-least-32-characters-here-xx'
process.env['BASE_RPC_URL'] = 'http://127.0.0.1:19999'

const OWNER = '0x0000000000000000000000000000000000000055'
const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'

vi.mock('../src/lib/identity-registry.js', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/identity-registry.js')>(
    '../src/lib/identity-registry.js',
  )
  return {
    ...actual,
    checkRegisterReceipt: vi.fn(),
    getAgentWalletInfo: vi.fn(),
  }
})

let app: { fetch: (req: Request) => Promise<Response> }
let validToken: string
let agentRowId: string

beforeAll(async () => {
  app = (await import('../src/server.js')).default
  validToken = await mintJwt({ sub: OWNER, ownerEoa: OWNER, secret: process.env['JWT_SECRET']! })

  const db = createDb(process.env['DATABASE_URL']!)
  const agent = await insertAgent(db, {
    ownerEoa: OWNER,
    subnameLabel: 'test-plan3-register-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000002',
  })
  agentRowId = agent.id
})

describe('POST /agents/:id/register-onchain', () => {
  it('200s on a valid receipt + ownerOf match, persists agentId + agentWalletEoa', async () => {
    const reg = await import('../src/lib/identity-registry.js')
    vi.mocked(reg.checkRegisterReceipt).mockResolvedValue({ ok: true, reason: null })
    vi.mocked(reg.getAgentWalletInfo).mockResolvedValue({
      ownerAddress: OWNER as `0x${string}`,
      agentWalletAddress: OWNER as `0x${string}`,
    })

    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentRowId}/register-onchain`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: '8453:42',
          txHash: '0x' + 'aa'.repeat(32),
        }),
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json() as { agentId: string; agentWalletEoa: string }
    expect(body.agentId).toBe('8453:42')
    expect(body.agentWalletEoa.toLowerCase()).toBe(OWNER.toLowerCase())
  })

  it('400s when checkRegisterReceipt fails', async () => {
    const reg = await import('../src/lib/identity-registry.js')
    vi.mocked(reg.checkRegisterReceipt).mockResolvedValue({
      ok: false,
      reason: 'tx status is reverted',
    })

    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentRowId}/register-onchain`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: '8453:43', txHash: '0x' + 'bb'.repeat(32) }),
      }),
    )

    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('reverted')
  })

  it('403s when getAgentWalletInfo.ownerAddress does not match the caller', async () => {
    const reg = await import('../src/lib/identity-registry.js')
    vi.mocked(reg.checkRegisterReceipt).mockResolvedValue({ ok: true, reason: null })
    vi.mocked(reg.getAgentWalletInfo).mockResolvedValue({
      ownerAddress: '0x0000000000000000000000000000000000000099' as `0x${string}`,
      agentWalletAddress: '0x0000000000000000000000000000000000000099' as `0x${string}`,
    })

    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentRowId}/register-onchain`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: '8453:44', txHash: '0x' + 'cc'.repeat(32) }),
      }),
    )

    expect(res.status).toBe(403)
  })

  it('400s on malformed agentId', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentRowId}/register-onchain`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'not-a-cip-id', txHash: '0x' + 'dd'.repeat(32) }),
      }),
    )

    expect(res.status).toBe(400)
  })

  it('401s without a token', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentRowId}/register-onchain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: '8453:45', txHash: '0x' + 'ee'.repeat(32) }),
      }),
    )
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 11.3: Run the test to verify it fails**

```bash
cd apps/api
pnpm test
```

Expected: FAIL — `/agents/:id/register-onchain` returns 404 because the route does not exist.

- [ ] **Step 11.4: Add the route to `apps/api/src/routes/agents.ts`**

Append to `apps/api/src/routes/agents.ts`:

```ts
import { checkRegisterReceipt, getAgentWalletInfo } from '../lib/identity-registry.js'

const registerOnchainSchema = z.object({
  agentId: z
    .string()
    .regex(/^[0-9]+:[0-9]+$/, 'agentId must be "chainId:uint256", e.g. "8453:42"'),
  txHash: z.string().startsWith('0x').length(66) as z.ZodType<`0x${string}`>,
})

/**
 * POST /agents/:id/register-onchain
 * Body: { agentId: "8453:42", txHash: "0x..." }
 *
 * Verifies the dev's register() tx is mined and minted the supplied agent ID
 * to the authenticated owner EOA. On success, persists the agentId and sets
 * agentWalletEoa to the on-chain getAgentWallet() result (which initially
 * equals ownerOf in solo-dev mode).
 */
agentsRoute.post(
  '/agents/:id/register-onchain',
  jwtMiddleware(env.JWT_SECRET),
  zValidator('json', registerOnchainSchema),
  async (c) => {
    const claims = c.var.jwtClaims
    const ownerEoa = ((claims.ownerEoa as string) ?? claims.sub).toLowerCase()
    const id = c.req.param('id')
    const body = c.req.valid('json')

    const agent = await findAgentById(db, id)
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    if (agent.ownerEoa !== ownerEoa) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const [chainIdStr, tokenIdStr] = body.agentId.split(':')
    if (!chainIdStr || !tokenIdStr) {
      return c.json({ error: 'Malformed agentId' }, 400)
    }
    if (chainIdStr !== '8453') {
      return c.json({ error: 'Only Base mainnet (chainId 8453) is supported' }, 400)
    }
    const tokenId = BigInt(tokenIdStr)

    const receiptCheck = await checkRegisterReceipt({
      rpcUrl: env.BASE_RPC_URL,
      registryAddress: env.IDENTITY_REGISTRY_ADDRESS as `0x${string}`,
      txHash: body.txHash,
      expectedTokenId: tokenId,
      expectedTo: ownerEoa as `0x${string}`,
    })
    if (!receiptCheck.ok) {
      return c.json({ error: `Register tx verification failed: ${receiptCheck.reason}` }, 400)
    }

    const info = await getAgentWalletInfo({
      rpcUrl: env.BASE_RPC_URL,
      registryAddress: env.IDENTITY_REGISTRY_ADDRESS as `0x${string}`,
      agentId: tokenId,
    })
    if (info.ownerAddress.toLowerCase() !== ownerEoa) {
      return c.json(
        { error: 'On-chain ownerOf does not match the authenticated wallet' },
        403,
      )
    }

    const updated = await updateAgent(db, id, {
      agentId: body.agentId,
      agentWalletEoa: info.agentWalletAddress.toLowerCase(),
    })

    return c.json({
      id: updated.id,
      agentId: updated.agentId,
      agentWalletEoa: updated.agentWalletEoa,
    })
  },
)
```

- [ ] **Step 11.5: Run tests to verify they pass**

```bash
pnpm test
```

Expected: 5 new tests pass; existing tests still pass.

- [ ] **Step 11.6: Commit**

```bash
cd ../..
git add apps/api/src/lib/identity-registry.ts apps/api/src/routes/agents.ts \
  apps/api/tests/register-onchain.test.ts
git commit -m "$(cat <<'EOF'
feat(api): POST /agents/:id/register-onchain — verify ERC-8004 mint

Adds checkRegisterReceipt() to identity-registry.ts: fetches the receipt
on Base, asserts status=success and a Transfer(0x0, owner, tokenId) log
emitted by the IdentityRegistry. The new route requires JWT, asserts
caller owns the agent row, runs the receipt check, then re-checks
ownerOf via getAgentWalletInfo and persists agentId + agentWalletEoa.
Tests cover happy path, bad receipt, ownerOf mismatch, malformed agentId,
and 401.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Wizard step 3 — register on-chain via wagmi

**Files:**
- Create: `apps/dashboard/src/lib/identity-registry-abi.ts`
- Replace: `apps/dashboard/src/app/onboard/_steps/step-3-register.tsx`

The step lets the user send a `register(agentURI)` transaction directly from their wallet via wagmi, then waits for the receipt and posts `txHash` to `POST /agents/:id/register-onchain`.

For Plan 3 we use a minimal `agentURI = "ipfs://placeholder-plan3"`. The IPFS pinning of the registration JSON described in spec §6.1 step 5 lands in Plan 5 along with the scanner. Documenting that defer below.

- [ ] **Step 12.1: Create `apps/dashboard/src/lib/identity-registry-abi.ts`**

```ts
import type { Address } from 'viem'

/**
 * Minimal ERC-8004 IdentityRegistry ABI fragments the dashboard needs.
 * - register(string agentURI) returns (uint256) — emits Transfer(0x0, msg.sender, tokenId)
 *   plus an ERC-8004 event we parse server-side via the Transfer log.
 * - ownerOf(uint256) and getAgentWallet(uint256) — read-only sanity checks.
 *
 * The full ABI lives in @open-agents/contracts (Plan 1) but the dashboard
 * does not depend on that workspace package today; pinning the fragments
 * here keeps the dashboard self-contained.
 */
export const IDENTITY_REGISTRY_ABI = [
  {
    name: 'register',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'getAgentWallet',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  },
] as const

export const IDENTITY_REGISTRY_ADDRESS: Address =
  (process.env['NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS'] as Address | undefined) ??
  '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'

/**
 * Plan 3 placeholder agent URI. Plan 5's scanner pipeline will pin the real
 * registration JSON to IPFS; that work also requires backfilling the URI
 * for any agent that registered during Plan 3 with this stub.
 */
export const PLAN3_PLACEHOLDER_AGENT_URI = 'ipfs://placeholder-plan3'
```

- [ ] **Step 12.2: Replace `apps/dashboard/src/app/onboard/_steps/step-3-register.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { useWriteContract, useWaitForTransactionReceipt, useAccount, useReadContract } from 'wagmi'
import { decodeEventLog } from 'viem'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { useWizardStore } from '../_store'
import {
  IDENTITY_REGISTRY_ABI,
  IDENTITY_REGISTRY_ADDRESS,
  PLAN3_PLACEHOLDER_AGENT_URI,
} from '@/lib/identity-registry-abi'
import { getApiClient } from '@/lib/api-client'
import type { RegisterOnchainBody, RegisterOnchainResponse } from '@/types/api'

export function Step3Register() {
  const { agentRowId, setOnchain, next } = useWizardStore()
  const { address } = useAccount()
  const [submitting, setSubmitting] = useState(false)

  const { writeContractAsync, data: pendingTxHash, reset: resetWrite } = useWriteContract()
  const { data: receipt, isLoading: waitingReceipt } = useWaitForTransactionReceipt({
    hash: pendingTxHash,
  })

  // Read current nextId so we can show the user what their agent ID will be.
  // (ERC-8004's IdentityRegistry exposes ownerOf/getAgentWallet but not a
  // nextId getter; we derive the actual ID from the Transfer log instead,
  // which is what we read off the receipt below.)

  async function handleRegister() {
    if (!address) {
      toast.error('Wallet not connected')
      return
    }
    if (!agentRowId) {
      toast.error('No agent row — restart wizard')
      return
    }
    setSubmitting(true)
    try {
      const txHash = await writeContractAsync({
        address: IDENTITY_REGISTRY_ADDRESS,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'register',
        args: [PLAN3_PLACEHOLDER_AGENT_URI],
      })
      toast.message('Register tx submitted', { description: txHash })

      // Wait for the receipt via the watch hook below; the user-side render
      // shows progress while this is pending.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleConfirm() {
    if (!receipt || !pendingTxHash) {
      toast.error('Tx receipt not yet available')
      return
    }
    if (!agentRowId) return

    // Pull the tokenId out of the Transfer log so we can build "8453:<id>".
    let tokenId: bigint | null = null
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== IDENTITY_REGISTRY_ADDRESS.toLowerCase()) continue
      try {
        const decoded = decodeEventLog({
          abi: IDENTITY_REGISTRY_ABI,
          data: log.data,
          topics: log.topics,
          eventName: 'Transfer',
        })
        const args = decoded.args as { from: `0x${string}`; to: `0x${string}`; tokenId: bigint }
        if (args.from === '0x0000000000000000000000000000000000000000') {
          tokenId = args.tokenId
          break
        }
      } catch {
        // not a Transfer event, skip
      }
    }
    if (tokenId === null) {
      toast.error('Could not find Transfer log in receipt')
      return
    }
    const agentIdStr = `8453:${tokenId.toString()}`

    try {
      const body: RegisterOnchainBody = { agentId: agentIdStr, txHash: pendingTxHash }
      await getApiClient().post<RegisterOnchainResponse>(
        `/agents/${agentRowId}/register-onchain`,
        body,
      )
      setOnchain(agentIdStr, pendingTxHash)
      toast.success(`Registered as ${agentIdStr}`)
      next()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Register on Base</CardTitle>
        <CardDescription>
          Mint an ERC-8004 agent NFT to your wallet. This is the only step that costs gas (~$0.01 on Base).
          We'll verify the on-chain mint server-side and link your subname to the new agent ID.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border border-border bg-muted px-3 py-2 text-xs">
          <div>Contract: <code>{IDENTITY_REGISTRY_ADDRESS}</code></div>
          <div>Function: <code>register("{PLAN3_PLACEHOLDER_AGENT_URI}")</code></div>
        </div>
        {pendingTxHash && (
          <p className="text-xs text-muted-foreground">
            Pending tx: <code>{pendingTxHash}</code>
          </p>
        )}
        {waitingReceipt && (
          <p className="text-xs text-muted-foreground">Waiting for confirmation…</p>
        )}
        {receipt && (
          <p className="text-xs text-emerald-600">
            Confirmed in block {receipt.blockNumber.toString()}.
          </p>
        )}
      </CardContent>
      <CardFooter className="justify-end gap-2">
        {!pendingTxHash && (
          <Button onClick={handleRegister} disabled={submitting}>
            {submitting ? 'Confirming in wallet…' : 'Sign register tx'}
          </Button>
        )}
        {pendingTxHash && receipt && (
          <Button onClick={handleConfirm}>Confirm with backend</Button>
        )}
        {pendingTxHash && !receipt && (
          <Button disabled>Waiting for receipt…</Button>
        )}
        {pendingTxHash && (
          <Button
            variant="outline"
            onClick={() => {
              resetWrite()
            }}
          >
            Reset
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
```

- [ ] **Step 12.3: Smoke-test step 3 (requires real Base ETH)**

This step requires a wallet funded on Base mainnet. Skip in plain dev unless you have funds.

```bash
cd apps/dashboard
NEXT_PUBLIC_API_URL=http://localhost:3001 \
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<real-project-id> \
NEXT_PUBLIC_BASE_RPC_URL=https://mainnet.base.org \
pnpm dev
```

In `apps/api`, run with a real `BASE_RPC_URL`. Walk through wizard steps 1–3. Expected: `register()` tx fires, receipt arrives, "Confirm with backend" hits the new endpoint, the row's `agent_id` and `agent_wallet_eoa` populate.

- [ ] **Step 12.4: Commit**

```bash
cd ../..
git add apps/dashboard/src/lib/identity-registry-abi.ts \
  apps/dashboard/src/app/onboard/_steps/step-3-register.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): wizard step 3 — register on-chain via wagmi

Step 3 sends register(agentURI) on the IdentityRegistry via wagmi
useWriteContract, waits for the receipt with useWaitForTransactionReceipt,
parses the Transfer(0x0, owner, tokenId) log to derive 8453:<tokenId>, and
POSTs to /agents/:id/register-onchain. Plan 3 uses
'ipfs://placeholder-plan3' as the agent URI; Plan 5's scanner pipeline
will pin the real registration JSON.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 13: Backend — `POST /agents/:id/treasury` endpoint + Safe bytecode check

**Files:**
- Create: `apps/api/src/lib/safe-bytecode.ts`
- Modify: `apps/api/src/routes/agents.ts`
- Create: `apps/api/tests/treasury.test.ts`

The endpoint accepts `{ safeAddress, deployTxHash }` and verifies:

1. The deploy tx is mined (`status === 'success'`).
2. The bytecode currently at `safeAddress` is a Safe-singleton-backed proxy. We do this by checking the runtime code starts with the well-known Safe minimal proxy prefix and embeds the Safe singleton address that we know from `NEXT_PUBLIC_SAFE_SINGLETON_ADDRESS`.

On success, persists `treasurySafeAddress`. The dashboard deploys the Safe in the browser via Safe Protocol Kit (next task).

- [ ] **Step 13.1: Create `apps/api/src/lib/safe-bytecode.ts`**

```ts
import { createPublicClient, http, type Address } from 'viem'
import { base } from 'viem/chains'

/**
 * The Safe v1.4.1-L2 singleton on Base mainnet. Safe Protocol Kit's default
 * deployment points new proxies at this address. We assert the runtime
 * bytecode at the target address embeds this singleton address — that's a
 * cheap-to-check, hard-to-fake property because the Safe proxy code is a
 * tiny well-known DELEGATECALL stub.
 */
export const SAFE_L2_SINGLETON_BASE: Address = '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762'

/**
 * The Safe minimal proxy runtime bytecode. The first ~30 bytes are constant;
 * the singleton address is appended as the last 20 bytes of the runtime
 * code (see SafeProxyFactory's createProxyWithNonce — the deployed runtime
 * is `0x363d3d373d3d3d363d73<singleton>5af43d82803e903d91602b57fd5bf3`).
 */
export const SAFE_PROXY_RUNTIME_PREFIX = '0x363d3d373d3d3d363d73'.toLowerCase()
export const SAFE_PROXY_RUNTIME_SUFFIX = '5af43d82803e903d91602b57fd5bf3'.toLowerCase()

export interface SafeBytecodeCheckParams {
  rpcUrl: string
  safeAddress: Address
  expectedSingleton?: Address
}

export interface SafeBytecodeCheckResult {
  ok: boolean
  reason: string | null
}

/**
 * Reads the runtime code at `safeAddress` and confirms it is a Safe proxy
 * pointing at the expected singleton. Returns { ok: false, reason } on any
 * mismatch — the route turns this into HTTP 400.
 */
export async function checkSafeBytecode(
  params: SafeBytecodeCheckParams,
): Promise<SafeBytecodeCheckResult> {
  const expectedSingleton = (params.expectedSingleton ?? SAFE_L2_SINGLETON_BASE).toLowerCase()
  const client = createPublicClient({
    chain: base,
    transport: http(params.rpcUrl, { timeout: 5_000 }),
  })

  let bytecode: `0x${string}` | undefined
  try {
    bytecode = await client.getCode({ address: params.safeAddress })
  } catch (err) {
    return { ok: false, reason: `getCode failed: ${String(err)}` }
  }

  if (!bytecode || bytecode === '0x') {
    return { ok: false, reason: 'no contract deployed at address' }
  }

  const lower = bytecode.toLowerCase()
  if (!lower.startsWith(SAFE_PROXY_RUNTIME_PREFIX)) {
    return { ok: false, reason: 'bytecode does not start with Safe proxy prefix' }
  }
  if (!lower.endsWith(SAFE_PROXY_RUNTIME_SUFFIX)) {
    return { ok: false, reason: 'bytecode does not end with Safe proxy suffix' }
  }

  // The singleton address is the 20 bytes between prefix (10 chars after 0x)
  // and suffix (the runtime is exactly 0x + 20 + 40 + 30 = 92 chars long).
  const singletonStart = SAFE_PROXY_RUNTIME_PREFIX.length            // includes 0x
  const singletonHex = '0x' + lower.slice(singletonStart, singletonStart + 40)
  if (singletonHex !== expectedSingleton) {
    return {
      ok: false,
      reason: `proxy points at ${singletonHex}, expected ${expectedSingleton}`,
    }
  }

  return { ok: true, reason: null }
}

/**
 * Confirms the deploy tx is mined and successful. Used together with
 * checkSafeBytecode to assert "this safe really was just deployed by this tx".
 */
export async function checkSafeDeployTx(params: {
  rpcUrl: string
  txHash: `0x${string}`
}): Promise<{ ok: boolean; reason: string | null }> {
  const client = createPublicClient({
    chain: base,
    transport: http(params.rpcUrl, { timeout: 5_000 }),
  })
  try {
    const receipt = await client.getTransactionReceipt({ hash: params.txHash })
    if (receipt.status !== 'success') {
      return { ok: false, reason: `tx status is ${receipt.status}` }
    }
    return { ok: true, reason: null }
  } catch (err) {
    return { ok: false, reason: `getTransactionReceipt failed: ${String(err)}` }
  }
}
```

- [ ] **Step 13.2: Write the failing route test**

Create `apps/api/tests/treasury.test.ts`:

```ts
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mintJwt } from '@open-agents/auth'
import { createDb, insertAgent } from '@open-agents/db'

process.env['DATABASE_URL'] = 'postgres://open_agents:open_agents_dev@localhost:5432/open_agents'
process.env['JWT_SECRET'] = 'test-secret-at-least-32-characters-here-xx'
process.env['BASE_RPC_URL'] = 'http://127.0.0.1:19999'

const OWNER = '0x0000000000000000000000000000000000000066'

vi.mock('../src/lib/safe-bytecode.js', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/safe-bytecode.js')>(
    '../src/lib/safe-bytecode.js',
  )
  return {
    ...actual,
    checkSafeBytecode: vi.fn(),
    checkSafeDeployTx: vi.fn(),
  }
})

let app: { fetch: (req: Request) => Promise<Response> }
let validToken: string
let agentRowId: string

beforeAll(async () => {
  app = (await import('../src/server.js')).default
  validToken = await mintJwt({ sub: OWNER, ownerEoa: OWNER, secret: process.env['JWT_SECRET']! })

  const db = createDb(process.env['DATABASE_URL']!)
  const agent = await insertAgent(db, {
    ownerEoa: OWNER,
    subnameLabel: 'test-plan3-treasury-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000002',
  })
  agentRowId = agent.id
})

describe('POST /agents/:id/treasury', () => {
  it('200s on success, persists treasurySafeAddress', async () => {
    const safe = await import('../src/lib/safe-bytecode.js')
    vi.mocked(safe.checkSafeBytecode).mockResolvedValue({ ok: true, reason: null })
    vi.mocked(safe.checkSafeDeployTx).mockResolvedValue({ ok: true, reason: null })

    const safeAddr = '0x' + '11'.repeat(20)
    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentRowId}/treasury`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ safeAddress: safeAddr, deployTxHash: '0x' + 'aa'.repeat(32) }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json() as { treasurySafeAddress: string }
    expect(body.treasurySafeAddress.toLowerCase()).toBe(safeAddr.toLowerCase())
  })

  it('400s when bytecode check fails', async () => {
    const safe = await import('../src/lib/safe-bytecode.js')
    vi.mocked(safe.checkSafeDeployTx).mockResolvedValue({ ok: true, reason: null })
    vi.mocked(safe.checkSafeBytecode).mockResolvedValue({
      ok: false,
      reason: 'no contract deployed at address',
    })

    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentRowId}/treasury`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          safeAddress: '0x' + '22'.repeat(20),
          deployTxHash: '0x' + 'bb'.repeat(32),
        }),
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('no contract deployed')
  })

  it('400s when deploy tx is not mined', async () => {
    const safe = await import('../src/lib/safe-bytecode.js')
    vi.mocked(safe.checkSafeBytecode).mockResolvedValue({ ok: true, reason: null })
    vi.mocked(safe.checkSafeDeployTx).mockResolvedValue({
      ok: false,
      reason: 'tx status is reverted',
    })

    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentRowId}/treasury`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          safeAddress: '0x' + '33'.repeat(20),
          deployTxHash: '0x' + 'cc'.repeat(32),
        }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('403s when caller does not own the agent', async () => {
    const otherToken = await mintJwt({
      sub: '0x0000000000000000000000000000000000000099',
      ownerEoa: '0x0000000000000000000000000000000000000099',
      secret: process.env['JWT_SECRET']!,
    })
    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentRowId}/treasury`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          safeAddress: '0x' + '44'.repeat(20),
          deployTxHash: '0x' + 'dd'.repeat(32),
        }),
      }),
    )
    expect(res.status).toBe(403)
  })

  it('401s without a token', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentRowId}/treasury`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          safeAddress: '0x' + '55'.repeat(20),
          deployTxHash: '0x' + 'ee'.repeat(32),
        }),
      }),
    )
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 13.3: Run the test to verify it fails**

```bash
cd apps/api
pnpm test
```

Expected: FAIL — `/treasury` route does not exist.

- [ ] **Step 13.4: Add the route to `apps/api/src/routes/agents.ts`**

Append to `apps/api/src/routes/agents.ts`:

```ts
import {
  checkSafeBytecode,
  checkSafeDeployTx,
  SAFE_L2_SINGLETON_BASE,
} from '../lib/safe-bytecode.js'

const treasurySchema = z.object({
  safeAddress: z.string().startsWith('0x').length(42) as z.ZodType<`0x${string}`>,
  deployTxHash: z.string().startsWith('0x').length(66) as z.ZodType<`0x${string}`>,
})

/**
 * POST /agents/:id/treasury
 * Body: { safeAddress, deployTxHash }
 *
 * Verifies (a) the deploy tx is mined, (b) the bytecode at safeAddress is
 * a Safe proxy pointing at the canonical Base singleton. Persists
 * treasurySafeAddress on the agent row.
 */
agentsRoute.post(
  '/agents/:id/treasury',
  jwtMiddleware(env.JWT_SECRET),
  zValidator('json', treasurySchema),
  async (c) => {
    const claims = c.var.jwtClaims
    const ownerEoa = ((claims.ownerEoa as string) ?? claims.sub).toLowerCase()
    const id = c.req.param('id')
    const body = c.req.valid('json')

    const agent = await findAgentById(db, id)
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    if (agent.ownerEoa !== ownerEoa) return c.json({ error: 'Forbidden' }, 403)

    const txCheck = await checkSafeDeployTx({
      rpcUrl: env.BASE_RPC_URL,
      txHash: body.deployTxHash,
    })
    if (!txCheck.ok) {
      return c.json({ error: `Safe deploy tx verification failed: ${txCheck.reason}` }, 400)
    }

    const codeCheck = await checkSafeBytecode({
      rpcUrl: env.BASE_RPC_URL,
      safeAddress: body.safeAddress,
      expectedSingleton: SAFE_L2_SINGLETON_BASE,
    })
    if (!codeCheck.ok) {
      return c.json({ error: `Safe bytecode check failed: ${codeCheck.reason}` }, 400)
    }

    const updated = await updateAgent(db, id, {
      treasurySafeAddress: body.safeAddress.toLowerCase(),
    })

    return c.json({
      id: updated.id,
      treasurySafeAddress: updated.treasurySafeAddress,
    })
  },
)
```

- [ ] **Step 13.5: Run tests to verify they pass**

```bash
pnpm test
```

Expected: 5 new tests pass; all earlier tests still pass.

- [ ] **Step 13.6: Commit**

```bash
cd ../..
git add apps/api/src/lib/safe-bytecode.ts apps/api/src/routes/agents.ts apps/api/tests/treasury.test.ts
git commit -m "$(cat <<'EOF'
feat(api): POST /agents/:id/treasury — verify Safe deploy

checkSafeDeployTx asserts the deploy tx is mined-success.
checkSafeBytecode confirms the runtime code at safeAddress is the Safe
v1.4.1-L2 minimal proxy prefix/suffix with the expected singleton
(0x29fcB43b46531BcA003ddC8FCB67FFE91900C762 on Base) embedded inside.
The route updates treasurySafeAddress only after both checks pass. Tests
cover happy path, bad bytecode, bad receipt, 403, and 401.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Wizard step 4 — deploy treasury Safe in the browser

**Files:**
- Create: `apps/dashboard/src/lib/safe-deploy.ts`
- Replace: `apps/dashboard/src/app/onboard/_steps/step-4-treasury.tsx`

The Safe Protocol Kit deploys the proxy from inside the browser using the connected wallet as both the deployer and the 1-of-1 owner. We pass an `EthersAdapter`-style signer derived from wagmi's `walletClient`.

- [ ] **Step 14.1: Create `apps/dashboard/src/lib/safe-deploy.ts`**

```ts
import Safe, { SafeAccountConfig, SafeDeploymentConfig } from '@safe-global/protocol-kit'
import type { WalletClient } from 'viem'

export interface DeployTreasuryParams {
  walletClient: WalletClient
  ownerEoa: `0x${string}`
}

export interface DeployTreasuryResult {
  safeAddress: `0x${string}`
  deployTxHash: `0x${string}`
}

/**
 * Deploys a 1-of-1 Safe owned by `ownerEoa` on the chain configured in
 * `walletClient` (Base mainnet in our setup). Returns the deployed Safe's
 * address and the deployment tx hash.
 *
 * Implementation uses Safe Protocol Kit's Safe.init({ provider, signer })
 * + createSafeDeploymentTransaction flow. The walletClient sends the tx
 * via wagmi's underlying transport, so the user sees it in their wallet.
 */
export async function deployTreasurySafe(
  params: DeployTreasuryParams,
): Promise<DeployTreasuryResult> {
  const { walletClient, ownerEoa } = params

  const safeAccountConfig: SafeAccountConfig = {
    owners: [ownerEoa],
    threshold: 1,
  }

  const safeDeploymentConfig: SafeDeploymentConfig = {
    saltNonce: BigInt(Date.now()).toString(),
  }

  // protocol-kit accepts an EIP-1193 provider (window.ethereum) and a signer
  // address. In wagmi v2 the walletClient.transport already exposes the
  // request method that protocol-kit expects.
  const provider = walletClient.transport as unknown as { request: (args: unknown) => Promise<unknown> }

  const protocolKit = await Safe.init({
    provider: provider as unknown as Safe.Eip1193Provider,
    signer: ownerEoa,
    predictedSafe: {
      safeAccountConfig,
      safeDeploymentConfig,
    },
  })

  const deploymentTx = await protocolKit.createSafeDeploymentTransaction()
  const predictedAddress = (await protocolKit.getAddress()) as `0x${string}`

  const txHash = await walletClient.sendTransaction({
    account: ownerEoa,
    to: deploymentTx.to as `0x${string}`,
    data: deploymentTx.data as `0x${string}`,
    value: BigInt(deploymentTx.value ?? 0),
    chain: walletClient.chain,
  })

  return {
    safeAddress: predictedAddress,
    deployTxHash: txHash as `0x${string}`,
  }
}
```

- [ ] **Step 14.2: Replace `apps/dashboard/src/app/onboard/_steps/step-4-treasury.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { useAccount, useWalletClient, useWaitForTransactionReceipt } from 'wagmi'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { useWizardStore } from '../_store'
import { deployTreasurySafe } from '@/lib/safe-deploy'
import { getApiClient } from '@/lib/api-client'
import type { TreasuryBody, TreasuryResponse } from '@/types/api'

export function Step4Treasury() {
  const { agentRowId, setTreasury, next } = useWizardStore()
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const [pending, setPending] = useState(false)
  const [predicted, setPredicted] = useState<`0x${string}` | null>(null)
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)

  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash ?? undefined })

  async function handleDeploy() {
    if (!address || !walletClient) {
      toast.error('Wallet not connected')
      return
    }
    if (!agentRowId) {
      toast.error('No agent row — restart wizard')
      return
    }
    setPending(true)
    try {
      const { safeAddress, deployTxHash } = await deployTreasurySafe({
        walletClient,
        ownerEoa: address,
      })
      setPredicted(safeAddress)
      setTxHash(deployTxHash)
      toast.message('Safe deploy tx submitted', { description: deployTxHash })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  async function handleConfirm() {
    if (!predicted || !txHash || !agentRowId) return
    try {
      const body: TreasuryBody = { safeAddress: predicted, deployTxHash: txHash }
      const res = await getApiClient().post<TreasuryResponse>(
        `/agents/${agentRowId}/treasury`,
        body,
      )
      setTreasury(predicted, txHash)
      toast.success(`Treasury Safe persisted: ${res.treasurySafeAddress}`)
      next()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deploy your treasury Safe</CardTitle>
        <CardDescription>
          A 1-of-1 Safe owned by your wallet. Stealth-payment sweeps consolidate funds here. Heads-up:
          transfers from stealth addresses to this Safe are visible on-chain — keep this Safe separate from
          your main wallet for maximum privacy.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {predicted && (
          <p className="text-xs">
            Predicted address: <code>{predicted}</code>
          </p>
        )}
        {txHash && (
          <p className="text-xs">
            Deploy tx: <code>{txHash}</code>
          </p>
        )}
        {receipt && (
          <p className="text-xs text-emerald-600">
            Confirmed in block {receipt.blockNumber.toString()}.
          </p>
        )}
      </CardContent>
      <CardFooter className="justify-end gap-2">
        {!txHash && (
          <Button onClick={handleDeploy} disabled={pending}>
            {pending ? 'Confirming in wallet…' : 'Deploy Safe'}
          </Button>
        )}
        {txHash && receipt && (
          <Button onClick={handleConfirm}>Confirm with backend</Button>
        )}
        {txHash && !receipt && <Button disabled>Waiting for receipt…</Button>}
      </CardFooter>
    </Card>
  )
}
```

- [ ] **Step 14.3: Smoke-test step 4 (requires real Base ETH)**

Continue the wizard from step 3. Click "Deploy Safe". Expected:
- Wallet pops up to send the proxy-creation tx (~$0.02 in gas).
- After the receipt arrives, "Confirm with backend" hits `POST /agents/:id/treasury`.
- The row's `treasury_safe_address` gets populated.

- [ ] **Step 14.4: Commit**

```bash
cd ../..
git add apps/dashboard/src/lib/safe-deploy.ts \
  apps/dashboard/src/app/onboard/_steps/step-4-treasury.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): wizard step 4 — deploy treasury Safe in browser

deployTreasurySafe uses Safe Protocol Kit's Safe.init({ predictedSafe })
to predict the address, then sends the deployment tx via wagmi's
walletClient. Step 4 captures the predicted address + deploy tx hash,
waits for the receipt, then POSTs to /agents/:id/treasury for the
backend to verify and persist.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 15: Records form component (shared by step 5 + agent settings)

**Files:**
- Create: `apps/dashboard/src/components/records-form.tsx`
- Create: `apps/dashboard/tests/records-form.test.tsx`

The records form lives in its own component because it is also re-used by the per-agent settings page (Task 17). It edits five ENSIP-26 fields:

- `agent-context` — JSON describing the agent (name, description, image)
- `agent-endpoint[mcp]` — URL
- `agent-endpoint[a2a]` — URL
- `agent-endpoint[web]` — URL
- `stealth-meta` — pre-filled in Plan 4; in Plan 3 we leave it empty / read-only

The form validates `agent-context` parses as JSON and that endpoint fields parse as URLs (or are blank). Submit calls the supplied `onSubmit` with a `Record<string, string>`.

- [ ] **Step 15.1: Write the failing test**

Create `apps/dashboard/tests/records-form.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecordsForm } from '@/components/records-form'

describe('RecordsForm', () => {
  it('renders inputs pre-filled from `initial`', () => {
    render(
      <RecordsForm
        initial={{
          'agent-context': '{"name":"hi"}',
          'agent-endpoint[mcp]': 'https://mybot.example/mcp',
        }}
        onSubmit={() => {}}
      />,
    )

    expect((screen.getByLabelText(/agent-context/i) as HTMLTextAreaElement).value)
      .toBe('{"name":"hi"}')
    expect((screen.getByLabelText(/mcp/i) as HTMLInputElement).value)
      .toBe('https://mybot.example/mcp')
  })

  it('rejects invalid JSON in agent-context', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<RecordsForm initial={{}} onSubmit={onSubmit} />)

    const textarea = screen.getByLabelText(/agent-context/i)
    await user.clear(textarea)
    await user.type(textarea, '{not json')
    await user.click(screen.getByRole('button', { name: /save records/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/agent-context must be valid JSON/i)).toBeInTheDocument()
  })

  it('rejects malformed URLs in endpoint fields', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<RecordsForm initial={{}} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/mcp/i), 'not-a-url')
    await user.click(screen.getByRole('button', { name: /save records/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/agent-endpoint\[mcp\] must be a valid URL/i)).toBeInTheDocument()
  })

  it('strips empty fields and submits a Record<string,string>', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<RecordsForm initial={{}} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/agent-context/i), '{"name":"alice"}')
    await user.type(screen.getByLabelText(/web/i), 'https://alice.example')
    await user.click(screen.getByRole('button', { name: /save records/i }))

    expect(onSubmit).toHaveBeenCalledOnce()
    const arg = onSubmit.mock.calls[0]![0] as Record<string, string>
    expect(arg['agent-context']).toBe('{"name":"alice"}')
    expect(arg['agent-endpoint[web]']).toBe('https://alice.example')
    // Empty fields are not serialized.
    expect(arg['agent-endpoint[mcp]']).toBeUndefined()
  })
})
```

- [ ] **Step 15.2: Run the test to verify it fails**

```bash
cd apps/dashboard
pnpm test
```

Expected: FAIL — `@/components/records-form` does not exist.

- [ ] **Step 15.3: Create `apps/dashboard/src/components/records-form.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const ENDPOINT_KEYS = ['mcp', 'a2a', 'web'] as const
type EndpointKey = (typeof ENDPOINT_KEYS)[number]

export interface RecordsFormProps {
  initial: Record<string, string>
  onSubmit: (records: Record<string, string>) => Promise<void> | void
  submitLabel?: string
}

interface ValidationErrors {
  context?: string
  endpoints: Partial<Record<EndpointKey, string>>
}

function validate(
  contextValue: string,
  endpoints: Record<EndpointKey, string>,
): ValidationErrors {
  const errors: ValidationErrors = { endpoints: {} }
  if (contextValue.trim().length > 0) {
    try {
      JSON.parse(contextValue)
    } catch {
      errors.context = 'agent-context must be valid JSON'
    }
  }
  for (const key of ENDPOINT_KEYS) {
    const v = endpoints[key].trim()
    if (v.length === 0) continue
    try {
      const u = new URL(v)
      if (!['http:', 'https:'].includes(u.protocol)) {
        errors.endpoints[key] = `agent-endpoint[${key}] must be a valid URL`
      }
    } catch {
      errors.endpoints[key] = `agent-endpoint[${key}] must be a valid URL`
    }
  }
  return errors
}

export function RecordsForm({ initial, onSubmit, submitLabel = 'Save records' }: RecordsFormProps) {
  const [contextValue, setContextValue] = useState(initial['agent-context'] ?? '')
  const [endpoints, setEndpoints] = useState<Record<EndpointKey, string>>({
    mcp: initial['agent-endpoint[mcp]'] ?? '',
    a2a: initial['agent-endpoint[a2a]'] ?? '',
    web: initial['agent-endpoint[web]'] ?? '',
  })
  const [errors, setErrors] = useState<ValidationErrors>({ endpoints: {} })
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    const validation = validate(contextValue, endpoints)
    setErrors(validation)
    if (validation.context || Object.keys(validation.endpoints).length > 0) return

    const records: Record<string, string> = {}
    if (contextValue.trim()) records['agent-context'] = contextValue.trim()
    for (const key of ENDPOINT_KEYS) {
      const v = endpoints[key].trim()
      if (v) records[`agent-endpoint[${key}]`] = v
    }
    setSubmitting(true)
    try {
      await onSubmit(records)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>ENSIP-26 records</CardTitle>
        <CardDescription>
          These are read by ENS-aware clients when they look up your agent. <code>agent-context</code> is a
          JSON profile (name, description, image). The endpoint fields point to your agent's MCP server,
          A2A endpoint, or website.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="agent-context">agent-context (JSON)</Label>
          <Textarea
            id="agent-context"
            placeholder='{"name":"My agent","description":"…","image":"https://…"}'
            rows={4}
            value={contextValue}
            onChange={(e) => setContextValue(e.target.value)}
          />
          {errors.context && <p className="text-xs text-destructive">{errors.context}</p>}
        </div>
        {ENDPOINT_KEYS.map((key) => (
          <div key={key} className="space-y-2">
            <Label htmlFor={`agent-endpoint-${key}`}>agent-endpoint[{key}]</Label>
            <Input
              id={`agent-endpoint-${key}`}
              placeholder={`https://your-agent.example/${key}`}
              value={endpoints[key]}
              onChange={(e) => setEndpoints((prev) => ({ ...prev, [key]: e.target.value }))}
            />
            {errors.endpoints[key] && (
              <p className="text-xs text-destructive">{errors.endpoints[key]}</p>
            )}
          </div>
        ))}
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Saving…' : submitLabel}
        </Button>
      </CardFooter>
    </Card>
  )
}
```

- [ ] **Step 15.4: Run the test to verify it passes**

```bash
pnpm test
```

Expected: 4 records-form tests pass alongside the rest.

- [ ] **Step 15.5: Commit**

```bash
cd ../..
git add apps/dashboard/src/components/records-form.tsx apps/dashboard/tests/records-form.test.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): RecordsForm component for ENSIP-26 fields

Editable agent-context (JSON) + agent-endpoint[mcp/a2a/web] fields with
inline validation. Returns a Record<string,string> with empty fields
stripped. Re-used by wizard step 5 (Task 16) and the per-agent settings
page (Task 17).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Wizard step 5 — publish ENSIP-26 records + completion

**Files:**
- Replace: `apps/dashboard/src/app/onboard/_steps/step-5-records.tsx`

Step 5 wraps the shared `RecordsForm` and on submit PATCHes `/agents/:id` with the new `textRecords`. After success, it advances the store to `'done'` (which the wizard shell already routes to `/dashboard`).

The "preview your ENS profile" link points at `https://app.ens.domains/<label>.<parent>` so the user can see records propagate.

- [ ] **Step 16.1: Replace `apps/dashboard/src/app/onboard/_steps/step-5-records.tsx`**

```tsx
'use client'

import Link from 'next/link'
import { toast } from 'sonner'
import { useWizardStore } from '../_store'
import { RecordsForm } from '@/components/records-form'
import { getApiClient } from '@/lib/api-client'
import type { AgentResponse, PatchAgentBody } from '@/types/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

const PARENT_DOMAIN = process.env['NEXT_PUBLIC_PARENT_DOMAIN'] ?? 'gabhru.eth'

export function Step5Records() {
  const { agentRowId, subnameLabel, next } = useWizardStore()

  async function handleSubmit(records: Record<string, string>) {
    if (!agentRowId) {
      toast.error('No agent row — restart wizard')
      return
    }
    const body: PatchAgentBody = { textRecords: records }
    try {
      await getApiClient().patch<AgentResponse>(`/agents/${agentRowId}`, body)
      toast.success('Records published')
      next()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-4">
      <RecordsForm initial={{}} onSubmit={handleSubmit} submitLabel="Publish records & finish" />
      {subnameLabel && (
        <Card>
          <CardHeader>
            <CardTitle>Almost done</CardTitle>
            <CardDescription>
              After publishing, you can preview your full ENS profile:
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              className="text-sm underline"
              href={`https://app.ens.domains/${subnameLabel}.${PARENT_DOMAIN}`}
              target="_blank"
              rel="noreferrer"
            >
              app.ens.domains/{subnameLabel}.{PARENT_DOMAIN}
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
```

- [ ] **Step 16.2: Smoke-test step 5**

Continue the wizard from step 4. Fill the records form (just `agent-context` is enough), click "Publish records & finish". Expected:
- `PATCH /agents/:id` returns 200 with the new `textRecords`.
- Wizard transitions to `'done'`, which routes the user to `/dashboard` (Task 17 implements that page; until then it 404s — that's expected).

- [ ] **Step 16.3: Commit**

```bash
cd ../..
git add apps/dashboard/src/app/onboard/_steps/step-5-records.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): wizard step 5 — publish ENSIP-26 records

Step 5 hosts the shared RecordsForm. On submit, PATCH /agents/:id with
the validated textRecords, advance store to 'done' (router pushes to
/dashboard). Includes the "preview your ENS profile" deep link to
app.ens.domains.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 17: Dashboard home — agents list with copy-receive-link

**Files:**
- Create: `apps/dashboard/src/app/dashboard/page.tsx`

The dashboard home is JWT-gated and shows every agent owned by the connected wallet. Each row shows the subname, on-chain agent ID (or "not registered"), copy-receive-link button, treasury Safe (or "not deployed"), and a link to the per-agent settings page. A top-right "+ New agent" button routes to `/onboard`.

- [ ] **Step 17.1: Create `apps/dashboard/src/app/dashboard/page.tsx`**

```tsx
'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { Copy, ExternalLink, Plus } from 'lucide-react'
import { useMe } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const PARENT_DOMAIN = process.env['NEXT_PUBLIC_PARENT_DOMAIN'] ?? 'gabhru.eth'

export default function DashboardPage() {
  const router = useRouter()
  const { data, isAuthenticated, isLoading, error } = useMe()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.push('/')
  }, [isAuthenticated, isLoading, router])

  if (isLoading) return <main className="p-8 text-sm text-muted-foreground">Loading…</main>
  if (error || !data) return <main className="p-8 text-sm text-destructive">Failed to load agents.</main>

  return (
    <main className="mx-auto max-w-3xl p-6 py-12 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Your agents</h1>
          <p className="text-sm text-muted-foreground">Signed in as <code>{data.ownerEoa}</code></p>
        </div>
        <Link href="/onboard">
          <Button>
            <Plus size={16} /> New agent
          </Button>
        </Link>
      </div>

      {data.agents.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No agents yet</CardTitle>
          </CardHeader>
          <CardContent>
            <Link href="/onboard">
              <Button>Onboard your first agent</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <ul className="space-y-3">
        {data.agents.map((agent) => {
          const fullName = `${agent.subnameLabel}.${PARENT_DOMAIN}`
          return (
            <li key={agent.id}>
              <Card>
                <CardContent className="flex items-center justify-between gap-4 py-4">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{fullName}</span>
                      {agent.agentId ? (
                        <Badge variant="success">{agent.agentId}</Badge>
                      ) : (
                        <Badge variant="secondary">not registered</Badge>
                      )}
                      {agent.treasurySafeAddress ? (
                        <Badge variant="outline">treasury</Badge>
                      ) : (
                        <Badge variant="secondary">no treasury</Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Created {new Date(agent.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(fullName)
                        toast.success(`Copied ${fullName}`)
                      }}
                    >
                      <Copy size={14} /> Copy receive link
                    </Button>
                    <Link href={`/dashboard/${agent.id}` as never}>
                      <Button size="sm" variant="ghost">
                        Settings <ExternalLink size={14} />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
```

- [ ] **Step 17.2: Smoke-test the home**

```bash
cd apps/dashboard
NEXT_PUBLIC_API_URL=http://localhost:3001 \
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=placeholder-for-local-dev \
pnpm dev
```

Open http://localhost:3002/dashboard. Expected (after completing the wizard at least once):
- The signed-in EOA is shown.
- Each agent row has the subname, badges for on-chain/treasury status, "Copy receive link" copies `<label>.gabhru.eth` to the clipboard, "Settings" navigates to `/dashboard/<agentId>` (404 until Task 18).

- [ ] **Step 17.3: Commit**

```bash
cd ../..
git add apps/dashboard/src/app/dashboard/page.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): /dashboard home — agents list with copy-receive-link

Lists every active agent owned by the connected wallet via useMe. Each
row shows subname, on-chain ID badge, treasury badge, "Copy receive
link" button, and a Settings link. Empty state CTAs to /onboard. The
page redirects to / when unauthenticated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: Per-agent settings page that re-uses RecordsForm

**Files:**
- Create: `apps/dashboard/src/app/dashboard/[agentId]/page.tsx`

The settings page renders `<RecordsForm initial={agent.textRecords} onSubmit={...}>` to let the user edit ENSIP-26 records after onboarding. It also surfaces the agent's identity fields (subname, on-chain ID, agent wallet, treasury Safe) read-only for context.

- [ ] **Step 18.1: Create `apps/dashboard/src/app/dashboard/[agentId]/page.tsx`**

```tsx
'use client'

import { use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import useSWR from 'swr'
import { useMe } from '@/hooks/use-me'
import { getApiClient } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RecordsForm } from '@/components/records-form'
import type { AgentResponse, PatchAgentBody } from '@/types/api'

const PARENT_DOMAIN = process.env['NEXT_PUBLIC_PARENT_DOMAIN'] ?? 'gabhru.eth'

interface PageProps {
  params: Promise<{ agentId: string }>
}

export default function AgentSettingsPage({ params }: PageProps) {
  const { agentId } = use(params)
  const router = useRouter()
  const { isAuthenticated } = useMe()

  const { data: agent, error, mutate } = useSWR<AgentResponse, Error>(
    isAuthenticated ? `/agents/${agentId}` : null,
    (path: string) => getApiClient().get<AgentResponse>(path),
    { revalidateOnFocus: false },
  )

  if (!isAuthenticated) {
    if (typeof window !== 'undefined') router.push('/')
    return null
  }

  if (error) {
    return (
      <main className="mx-auto max-w-2xl p-6 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Agent not found</CardTitle>
            <CardDescription>{error.message}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard">
              <Button variant="outline">Back to agents</Button>
            </Link>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (!agent) return <main className="p-8 text-sm text-muted-foreground">Loading…</main>

  async function handleSave(records: Record<string, string>) {
    const body: PatchAgentBody = { textRecords: records }
    try {
      await getApiClient().patch<AgentResponse>(`/agents/${agentId}`, body)
      toast.success('Records updated')
      mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const fullName = `${agent.subnameLabel}.${PARENT_DOMAIN}`
  return (
    <main className="mx-auto max-w-2xl p-6 py-12 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{fullName}</h1>
          <p className="text-xs text-muted-foreground">
            <Link href="/dashboard" className="underline">
              ← back to agents
            </Link>
          </p>
        </div>
        <Link
          href={`https://app.ens.domains/${fullName}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs underline"
        >
          Preview ENS profile
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Owner: </span>
            <code>{agent.ownerEoa}</code>
          </div>
          <div>
            <span className="text-muted-foreground">On-chain ID: </span>
            {agent.agentId ? <Badge variant="success">{agent.agentId}</Badge> : <Badge variant="secondary">not registered</Badge>}
          </div>
          <div>
            <span className="text-muted-foreground">Agent wallet: </span>
            <code>{agent.agentWalletEoa ?? 'not set'}</code>
          </div>
          <div>
            <span className="text-muted-foreground">Treasury Safe: </span>
            <code>{agent.treasurySafeAddress ?? 'not deployed'}</code>
          </div>
        </CardContent>
      </Card>

      <RecordsForm initial={agent.textRecords} onSubmit={handleSave} />
    </main>
  )
}
```

- [ ] **Step 18.2: Smoke-test the settings page**

Open http://localhost:3002/dashboard/<some-agent-uuid>. Expected:
- Identity fields populate from `GET /agents/:id`.
- RecordsForm pre-fills with the row's `textRecords`.
- Edit a field, click "Save records" → PATCH succeeds, toast confirms, SWR mutates and re-renders.

- [ ] **Step 18.3: Commit**

```bash
cd ../..
git add apps/dashboard/src/app/dashboard/[agentId]/page.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): per-agent settings page reuses RecordsForm

/dashboard/[agentId] fetches the agent via SWR, surfaces identity
fields (owner, on-chain ID, agent wallet, treasury) read-only, and
hosts the same RecordsForm used in wizard step 5 — pre-filled with the
existing textRecords. Save calls PATCH /agents/:id and revalidates.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 19: End-to-end flow run + repo-wide test pass

**Files:** none (verification task)

This task confirms the full wizard runs against the local stack and that all test suites still pass after the dashboard and api additions.

- [ ] **Step 19.1: Boot the local stack**

In three terminals:

```bash
# T1: Postgres
docker compose -f docker-compose.dev.yml up -d
```

```bash
# T2: API
cd apps/api
DATABASE_URL=postgres://open_agents:open_agents_dev@localhost:5432/open_agents \
JWT_SECRET=local-dev-secret-32-characters-min-here \
BASE_RPC_URL=https://mainnet.base.org \
SIWE_DOMAIN=localhost \
pnpm dev
```

```bash
# T3: Dashboard
cd apps/dashboard
NEXT_PUBLIC_API_URL=http://localhost:3001 \
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<your-wc-id> \
NEXT_PUBLIC_BASE_RPC_URL=https://mainnet.base.org \
NEXT_PUBLIC_PARENT_DOMAIN=gabhru.eth \
pnpm dev
```

Open http://localhost:3002.

- [ ] **Step 19.2: Walk the full wizard**

1. Click "Connect wallet". Connect MetaMask (or any wallet) on Base.
2. Click "Sign in with wallet". Approve the SIWE message.
3. Wizard step 1: enter `e2e-<timestamp>`, click "Reserve subname".
4. Wizard step 2: click "Sign and derive". Approve the message.
5. Wizard step 3: click "Sign register tx". Approve. Wait for receipt. Click "Confirm with backend".
6. Wizard step 4: click "Deploy Safe". Approve. Wait. Click "Confirm with backend".
7. Wizard step 5: enter `{"name":"e2e"}` for agent-context, click "Publish records & finish".
8. You should land on `/dashboard` with the new agent visible.
9. Click "Settings" on the agent, change `agent-endpoint[web]` to `https://example.org`, click "Save records". Toast confirms.

Expected: every step succeeds with no console errors.

- [ ] **Step 19.3: Run the full test suite from the repo root**

```bash
DATABASE_URL=postgres://open_agents:open_agents_dev@localhost:5432/open_agents \
JWT_SECRET=test-secret-at-least-32-characters-here-xx \
GATEWAY_SIGNER_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000001 \
BASE_RPC_URL=http://127.0.0.1:19999 \
pnpm test
```

Expected: all packages pass.

- Gateway: 11 tests (Plan 1+2 baseline)
- DB: 8 tests (Plan 2 baseline)
- Auth: 7 tests (Plan 2 baseline)
- API: ~21 tests (Plan 2's ~11 + Plan 3's 10 new register-onchain + treasury)
- Dashboard: ~15 tests (sanity + api-client + siwe-login + use-me + stealth-stub + records-form)

- [ ] **Step 19.4: Run typecheck across the workspace**

```bash
pnpm typecheck
```

Expected: zero errors.

- [ ] **Step 19.5: Commit (no file changes — verification only)**

If steps 19.1–19.4 pass, no commit is needed. If you fixed any small issues along the way (e.g., import order, missing dep), commit those fixes here:

```bash
git add -p   # review and stage
git commit -m "$(cat <<'EOF'
chore: e2e fixes from Plan 3 wizard walkthrough

Minor adjustments uncovered during the full wizard run + test pass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 20: Vercel deployment configs for `apps/dashboard` (and updated `apps/api`)

**Files:**
- Create: `apps/dashboard/vercel.json`
- Modify: `README.md`

The dashboard ships as a standard Next.js Vercel project. The api was already configured in Plan 2 — Plan 3's only api-side change is the two new routes, which are picked up automatically.

**Reminder:** The deployment-expert agent owns `apps/dashboard/vercel.json` content if it conflicts with their changes — coordinate. Plan 3 contributes the dashboard-side config.

- [ ] **Step 20.1: Create `apps/dashboard/vercel.json`**

```json
{
  "buildCommand": "pnpm build",
  "installCommand": "pnpm install",
  "framework": "nextjs",
  "outputDirectory": ".next"
}
```

- [ ] **Step 20.2: Document the deploy in `README.md`**

Open `README.md` and append to the existing Plan 2 quick-start section:

```markdown
## Deploying to Vercel (after Plan 3)

Three Vercel projects, each linked to its own subdirectory:

| Vercel project              | Root directory     | Purpose                          |
| --------------------------- | ------------------ | -------------------------------- |
| `open-agents-gateway`       | `apps/gateway`     | CCIP-Read offchain resolver      |
| `open-agents-api`           | `apps/api`         | REST API for dashboard + SDK     |
| `open-agents-dashboard`     | `apps/dashboard`   | Onboarding wizard + agents UI    |

For each project, set the same env vars documented in `.env.example`. The
dashboard additionally needs `NEXT_PUBLIC_*` variants — Vercel inlines those
at build time. Domains: gateway → `gateway.gabhru.eth`, api →
`api.gabhru.eth`, dashboard → `app.gabhru.eth` (or the root marketing site).

To deploy via the Vercel CLI from the repo root:

```bash
# (one-time per project) link each subdirectory:
cd apps/dashboard && vercel link --project open-agents-dashboard && cd ../..
cd apps/api && vercel link --project open-agents-api && cd ../..

# preview deploys
cd apps/dashboard && vercel && cd ../..

# production deploys
cd apps/dashboard && vercel --prod && cd ../..
cd apps/api && vercel --prod && cd ../..
```
```

- [ ] **Step 20.3: Commit**

```bash
git add apps/dashboard/vercel.json README.md
git commit -m "$(cat <<'EOF'
chore(dashboard): vercel.json + deploy docs

apps/dashboard ships as a standard Next.js Vercel project. README gains
a three-project deploy table (gateway, api, dashboard) with the per-app
env-var pointer to .env.example.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

### 1. Spec coverage

- **§5.5 frontend `/onboard` 4-step wizard** — Plan 3 expands to 5 steps by separating "view-key derivation" (spec step 2) from "register on-chain" (spec step 3) into independent UI pages, plus the final ENSIP-26 records step. The spec called out that records get written by the backend after step 3; we instead make records explicit step 5 to give the dev a place to enter `agent-context` JSON, MCP/A2A/web URLs, and to allow editing later via `/dashboard/[agentId]`. Net coverage: same fields, clearer UX. ✓
- **§5.5 `/dashboard` payments table + reputation summary + per-payment toggle + withdraw** — DEFERRED to Plan 5 (scanner) and Plan 7 (reputation). Plan 3 ships the agents list and per-agent settings only — no payments UI yet. The dashboard route is intentionally minimal. ✓ (deferral)
- **§5.5 `/pay/[ens]` sender demo console** — DEFERRED. The dashboard does not include the sender-side demo. The CCIP-Read gateway is already public, so any wallet can pay an agent today; the in-app sender experience is Plan 5+ polish. ✓ (deferral)
- **§5.3 onboarding API — `POST /api/agents/:id/register-onchain`** — Task 11 implements this with Transfer-log verification and `ownerOf` re-check. ✓
- **§5.3 onboarding API — `POST /api/agents/:id/treasury`** — Task 13 implements this with deploy-tx + Safe bytecode verification. ✓
- **§4.4 three-key model** — view key: stub written by step 2 (Plan 4 replaces). Owner key: drives every wizard step via wagmi. Agent wallet hot key: spec calls for client-side generation + `setAgentWallet` in step 7 of §6.1; Plan 3 instead uses solo-dev mode (`agentWalletEoa = ownerOf`) which the schema and the SDK auth (Plan 6) explicitly support. The "promote to delegated wallet" upgrade path stays for Plan 6. ✓ (intentional simplification matching spec §4.4 "solo-dev simplification")
- **§4.2 stealth scheme — fluidkey-stealth-account-kit derivation** — DEFERRED to Plan 4 by design. Plan 3's `deriveViewKeyStub` reserves the same fixed message string `STEALTH_DERIVATION_MESSAGE` so Plan 4 can re-derive in place without prompting the user again with a different message. ✓ (deferral with bridge)
- **§6.1 step 5 IPFS-pinned registration JSON** — DEFERRED to Plan 5 along with the scanner. Plan 3 uses `'ipfs://placeholder-plan3'` as the agent URI. The on-chain verification in Task 11 only checks the Transfer log, not the URI contents, so the placeholder does not block. Plan 5 will need to backfill URIs for Plan 3 agents. ✓ (deferral)
- **§6.1 step 8 final `.env` download** — DEFERRED to Plan 6 (SDK shipping). Plan 3's wizard ends on the dashboard; the SDK `.env` template lands when the SDK exists. ✓ (deferral)
- **§8.2 SIWE handshake** — Plan 2 already shipped the api side. Plan 3 wires the dashboard side: nonce → wagmi sign → verify → JWT in cookie + memory. ✓
- **§8.2 `GET /api/agents/me`** — used by `useMe` hook (server-proxied through `/api/me` to keep the cookie httpOnly). ✓
- **§8.2 `POST /api/agents`** — used by `useCreateAgent` hook. ✓

**Gaps identified (intentional deferrals):**

| Spec section | Item | Deferred to |
| --- | --- | --- |
| §4.2 | Real ERC-5564 stealth key derivation | Plan 4 |
| §6.1 step 5 | IPFS pinning of registration JSON | Plan 5 |
| §6.1 step 7 | `setAgentWallet` delegated hot key flow | Plan 6 |
| §6.1 step 8 | Downloadable `.env` for the SDK | Plan 6 |
| §5.5 | `/dashboard` payments table, per-payment confirm, withdraw button | Plans 5 + 7 |
| §5.5 | `/pay/[ens]` sender console | Plan 5+ |
| §8.2 | `GET /api/agents/me/payments`, `POST /api/agents/me/withdraw`, receipts confirm | Plan 5/6 |
| §8.3 | SDK wallet-challenge endpoints | Plan 6 |

### 2. Placeholder scan

Searched the plan for "TBD", "TODO", "implement appropriate", "similar to", "...":

- The string "placeholder" appears in deliberate, well-scoped contexts only:
  - `PLAN3_PLACEHOLDER_AGENT_URI = 'ipfs://placeholder-plan3'` — pinned constant used in the actual code, not a writing-time placeholder.
  - `'stub:'` prefix on `viewKeyEncrypted` — explicit Plan 4 migration marker.
  - Step component "Step N — ... (placeholder, Task M implements)" — these are inside Task 8 which **explicitly** scaffolds shells that are replaced in Tasks 9–13. Each replacement is shown verbatim in its own task.
- No "TBD", "TODO", "implement appropriate", "similar to", or "..." appear anywhere as instructional shorthand. Every code block is complete and immediately runnable in the engineer's terminal.

### 3. Type consistency

- `AgentResponse` shape in `apps/dashboard/src/types/api.ts` mirrors the JSON shape returned by `apps/api/src/routes/agents.ts` — `id`, `ownerEoa`, `subnameLabel`, `agentId | null`, `baseAddr`, `agentWalletEoa | null`, `textRecords`, `treasurySafeAddress | null`, `viewKeyEncrypted?`, `isActive?`, `createdAt`, `updatedAt?`. ✓
- `ApiClient.setToken / getToken` accept `string | null` and store the same type. The `x-refreshed-token` capture only assigns when truthy, so the type stays `string | null`. ✓
- `WizardState` in zustand store types every per-step output. `setOnchain` accepts `(agentId: string, txHash: 0x{string})` matching `RegisterOnchainBody` exactly. `setTreasury` accepts `(safeAddress: 0x{string}, deployTxHash: 0x{string})` matching `TreasuryBody`. ✓
- `RecordsFormProps.onSubmit: (records: Record<string, string>) => Promise<void> | void` — both wizard step 5 and `/dashboard/[agentId]` pass an `async` handler that returns `Promise<void>`, satisfying the union. ✓
- `checkRegisterReceipt` parameters in `apps/api/src/lib/identity-registry.ts` use `Address` from viem; the route casts `env.IDENTITY_REGISTRY_ADDRESS` and `ownerEoa` to `0x${string}` consistently. ✓
- `checkSafeBytecode` returns `{ ok: boolean; reason: string | null }` — the route narrows on `!ok` and uses `reason` as a string in the error message. ✓
- `useMe` returns `MeResponse | undefined` (SWR convention); consumers either gate on `data` or fall back to `[]` on `data?.agents`. ✓
- `deployTreasurySafe` returns `{ safeAddress: 0x{string}; deployTxHash: 0x{string} }`, which step 4 stores via `setTreasury` and posts as `TreasuryBody`. ✓
- The `siwe` package's `SiweMessage.prepareMessage()` returns `string`; `useSignMessage` accepts `{ message: string }`. ✓

