<div align="center">

# Gabhru

### Pay AI agents privately, by name.

ENS-addressable stealth-payment infrastructure for ERC-8004 AI agents.
Pay any agent at `<name>.gabhru.eth`; settle to a fresh, unlinkable address.
The mempool sees nothing. The agent sees USDC.

[**Live demo →**](https://open-agents-dashboard.vercel.app) &nbsp;·&nbsp;
[**Wildcard resolver**](https://etherscan.io/address/0x6c11e3cb958c84cfd339123a2b9c4196c755f777#code) &nbsp;·&nbsp;
[**Pay test.gabhru.eth**](https://open-agents-dashboard.vercel.app/pay/test.gabhru.eth) &nbsp;·&nbsp;
[**Architecture spec**](docs/superpowers/specs/2026-05-02-private-agent-payments-design.md)

Built for **ETHGlobal OpenAgents · ENS track**.

</div>

---

## Why this exists

The AI agent economy has a privacy problem. ERC-8004 gives every agent an
on-chain identity, and a public x402 endpoint to charge for work. But every
payment to that endpoint is permanent, public, and trivially linkable:
who hired which agent, how much, how often, on what schedule.

Gabhru fixes that without changing how a sender pays:

```ts
// the sender's experience — same as paying any ENS name today
const recipient = await client.getEnsAddress({ name: "alice.gabhru.eth" })
await wallet.transfer({ to: recipient, amount: "5 USDC" })
```

Behind that one-liner, our resolver returns a **fresh stealth address every
time** (ERC-5564 + ERC-6538), an **announce** is posted on-chain so only the
agent's view key can find it, and the agent's dashboard sees the payment in
~2 seconds. No subgraph linkability. No mempool fingerprint. No special wallet.

## What's live (mainnet, today)

| | |
|---|---|
| ENS parent | [`gabhru.eth`](https://app.ens.domains/gabhru.eth) |
| Wildcard resolver (verified) | [`0x6c11e3cb958c84cfd339123a2b9c4196c755f777`](https://etherscan.io/address/0x6c11e3cb958c84cfd339123a2b9c4196c755f777#code) |
| Resolver deploy tx | [`0x969bd6…056c6c`](https://etherscan.io/tx/0x969bd60bc389c38623775aef6eb271bfdf3e9828db9f673bdcc7a08e17056c6c) |
| `gabhru.eth setResolver` tx | [`0xaa5cae…02a33258`](https://etherscan.io/tx/0xaa5cae905d6d436cdef5c502bb665e539fd836c33ba22548bbc089dd02a33258) |
| CCIP-Read gateway | [`open-agents-gateway.vercel.app`](https://open-agents-gateway.vercel.app/health) |
| REST API | [`open-agents-api.vercel.app`](https://open-agents-api.vercel.app) |
| Dashboard (this UI) | [`open-agents-dashboard.vercel.app`](https://open-agents-dashboard.vercel.app) |
| Gateway signer | `0x9B9B2C0F4a157ae83eaF3f0e901Ff6F8AE510017` |

```ts
import { createPublicClient, http } from "viem"
import { mainnet } from "viem/chains"

const client = createPublicClient({ chain: mainnet, transport: http() })
await client.getEnsAddress({ name: "test.gabhru.eth" })
// → 0x000000000000000000000000000000000000bEEF
```

> Any ENS-aware client (viem, ethers, Rainbow, MetaMask) resolves
> `*.gabhru.eth` via CCIP-Read with no extra config. Owners register their
> agent through the REST API; the gateway reads from Postgres and signs
> EIP-712 payloads on the fly — **no L1 write per agent**.

## How a payment travels

```
┌──────────┐   alice.gabhru.eth     ┌──────────────┐
│  sender  │ ─────────────────────► │  ENS  L1     │
└──────────┘                        │  CCIP-Read   │
                                    └──────┬───────┘
                                           │ revert OffchainLookup
                                           ▼
                                    ┌──────────────┐
                                    │  gateway     │  EIP-712 sign
                                    │  (Vercel)    │  · meta-address
                                    └──────┬───────┘  · ephemeral pub
                                           │          · view tag
            stealth EOA + ERC-5564 announce│
                                           ▼
┌──────────┐                        ┌──────────────┐
│  sender  │ ───── transfer ──────► │  recipient   │
│  wallet  │ ───── announce ──────► │  Safe (Base) │
└──────────┘                        └──────┬───────┘
                                           │ scanner streams logs
                                           ▼
                                    ┌──────────────┐
                                    │  agent       │  ~2s after tx
                                    │  dashboard   │
                                    └──────────────┘
```

**Four hops. Zero linkability between any two payments to the same agent.**

## Stack at a glance

| Layer | What it does |
|---|---|
| **ENS wildcard resolver** | One contract, one parent name, infinite agents |
| **ERC-5564 / ERC-6538** | Stealth meta-address standard + announcer |
| **ERC-8004** | On-chain agent identity (ID minted on Base) |
| **Safe on Base** | Per-agent treasury, sweeps stealth balances on schedule |
| **Hono / Fluid Compute** | Gateway + REST API on Vercel |
| **Next.js 16 + RainbowKit** | Dashboard, onboarding wizard, sender pay flow |
| **Drizzle + Postgres** | Agent registry, encrypted view keys, payment ledger |

## Repo layout

```
open-agents/
├── apps/
│   ├── gateway/          CCIP-Read offchain resolver gateway (Hono / Vercel)
│   ├── api/              REST API for dashboard + SDK auth (SIWE + JWT)
│   ├── dashboard/        Next.js 16 onboarding + agents UI + pay flow
│   └── scanner/          Watches ERC-5564 announcements, indexes payments
├── packages/
│   ├── contracts/        Foundry — OurOffchainResolver + tests
│   ├── crypto/           ERC-5564 stealth address derivation
│   ├── db/               Drizzle schema, migrations, query helpers
│   └── auth/             SIWE verification, JWT mint/verify, Hono middleware
├── docs/superpowers/
│   ├── specs/            Threat model, key model, ENS strategy
│   └── plans/            Per-plan implementation notes
├── scripts/
│   └── local-e2e.sh      One-shot anvil-fork verification of the full loop
└── docker-compose.dev.yml
```

## Roadmap

| #  | Title                                          | Status     |
|----|------------------------------------------------|------------|
| 01 | Foundation + ENS resolver                      | ✅ shipped — live on mainnet |
| 02 | Backend foundation (Postgres, SIWE, agent CRUD)| ✅ shipped |
| 03 | Onboarding wizard                              | ✅ shipped |
| 04 | Stealth crypto + gateway integration           | ✅ shipped |
| 05 | Scanner + dashboard                            | 🔄 in progress |
| 06 | TypeScript SDK                                 | ⏳ next     |
| 07 | Sweep + reputation + demo polish               | ⏳ next     |

## Quick start

```bash
# 1. Start local Postgres (used by packages/db, apps/api, apps/gateway tests)
docker compose -f docker-compose.dev.yml up -d

# 2. Install workspace deps
pnpm install

# 3. Run DB migrations
DATABASE_URL=postgres://open_agents:open_agents_dev@localhost:5434/open_agents \
  pnpm --filter @open-agents/db db:migrate

# 4. Run the full test suite
DATABASE_URL=postgres://open_agents:open_agents_dev@localhost:5434/open_agents \
JWT_SECRET=any-32-char-string-for-local-dev-xxxxxx \
GATEWAY_SIGNER_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000001 \
  pnpm -r test

# 5. Run the dashboard locally
pnpm --filter @open-agents/dashboard dev   # http://localhost:3002
```

To verify the full mainnet CCIP-Read loop locally against an anvil fork
(no real ETH spent), populate `.env` with `MAINNET_RPC_URL`,
`GATEWAY_SIGNER_PRIVATE_KEY`, `GATEWAY_SIGNER_ADDRESS`, then:

```bash
./scripts/local-e2e.sh
```

For per-package development, see each package's README.

## Try the live demo

1. Open [`open-agents-dashboard.vercel.app`](https://open-agents-dashboard.vercel.app).
2. Connect a wallet, sign in (no gas).
3. **Onboard** in ~90 seconds: pick a subname, derive stealth keys, mint ERC-8004 ID, deploy a Safe, publish ENS records.
4. From any other wallet, hit `/pay/<your-name>.gabhru.eth` and send USDC on Base.
5. Watch your agent dashboard light up within ~2 seconds.

## For judges

- **Single-line demo**: any `*.gabhru.eth` resolves with stock viem/ethers — see live snippet at the top of this README.
- **Verified resolver contract** on Etherscan, deploy + setResolver tx hashes inline.
- **Threat model + key model** in `docs/superpowers/specs/`.
- **Hackathon track**: ENS — wildcard CCIP-Read resolver, ENSIP-26 records, treasury linked via stealth-meta and reputation records.

## Migrating Plan 3 stub rows after Plan 4

Plan 3 wrote `view_key_encrypted = 'stub:<keccak256(signature)>'` because the
real Fluidkey derivation hadn't landed yet. Plan 4 changes the wizard so any
new agent gets a real `v1:`-prefixed envelope. Existing stub rows must be
re-onboarded (the spend private key was never derived in Plan 3).

```bash
pnpm node scripts/flag-stub-agents.mjs --list     # see what's still on stubs
pnpm node scripts/flag-stub-agents.mjs --notify   # mark for "re-derive" banners
pnpm node scripts/flag-stub-agents.mjs --delete   # later, soft-delete holdouts
```

## Deploying

Three Vercel projects, each linked to its own subdirectory:

| Vercel project          | Root directory   | Purpose                       |
| ----------------------- | ---------------- | ----------------------------- |
| `open-agents-gateway`   | `apps/gateway`   | CCIP-Read offchain resolver   |
| `open-agents-api`       | `apps/api`       | REST API for dashboard + SDK  |
| `open-agents-dashboard` | `apps/dashboard` | Onboarding wizard + agents UI |

For each project, set the same env vars documented in `.env.example`. The
dashboard additionally needs `NEXT_PUBLIC_*` variants — Vercel inlines those
at build time.

```bash
# (one-time per project) link each subdirectory:
cd apps/dashboard && vercel link --project open-agents-dashboard && cd ../..

# preview / production deploys
cd apps/dashboard && vercel --prod && cd ../..
cd apps/api && vercel --prod && cd ../..
cd apps/gateway && vercel --prod && cd ../..
```

The scanner runs as a Fly.io worker (see `apps/scanner/fly.toml`) with a
daily cron fallback on Vercel (28h lookback to fit Hobby plan limits).

---

<div align="center">

**Built with care, in public.**
[GitHub](https://github.com/HAPPYS1NGH/open-agents-stealth) · [Architecture spec](docs/superpowers/specs/2026-05-02-private-agent-payments-design.md) · [Resolver on Etherscan](https://etherscan.io/address/0x6c11e3cb958c84cfd339123a2b9c4196c755f777#code)

</div>
