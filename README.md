# Open Agents — Private Agent Payments

ENS-addressable stealth-payment infrastructure for ERC-8004 AI agents.
Pay agents privately by name (`<agent>.gabhru.eth`); receive at unlinkable
addresses. Built for the ETHGlobal OpenAgents hackathon, ENS track.

See `docs/superpowers/specs/2026-05-02-private-agent-payments-design.md`
for the architecture and threat model.

## Live (Plan 1 — Foundation + ENS Resolver)

The wildcard ENS resolver and CCIP-Read gateway are deployed and serving real
mainnet traffic. Try it from any viem/ethers/Rainbow/Metamask client:

```ts
import { createPublicClient, http } from "viem"
import { mainnet } from "viem/chains"

const client = createPublicClient({ chain: mainnet, transport: http() })
await client.getEnsAddress({ name: "test.gabhru.eth" })
// → 0x000000000000000000000000000000000000bEEF
```

| | |
|---|---|
| ENS parent | [`gabhru.eth`](https://app.ens.domains/gabhru.eth) |
| Resolver contract (verified) | [`0x6c11e3cb958c84cfd339123a2b9c4196c755f777`](https://etherscan.io/address/0x6c11e3cb958c84cfd339123a2b9c4196c755f777#code) |
| Resolver deploy tx | [`0x969bd6…056c6c`](https://etherscan.io/tx/0x969bd60bc389c38623775aef6eb271bfdf3e9828db9f673bdcc7a08e17056c6c) |
| `gabhru.eth` setResolver tx | [`0xaa5cae…02a33258`](https://etherscan.io/tx/0xaa5cae905d6d436cdef5c502bb665e539fd836c33ba22548bbc089dd02a33258) |
| Gateway (Vercel, edge runtime) | [open-agents-gateway-happys1nghs-projects.vercel.app](https://open-agents-gateway-happys1nghs-projects.vercel.app/health) |
| Gateway signer (CCIP-Read) | `0x9B9B2C0F4a157ae83eaF3f0e901Ff6F8AE510017` |

Currently only `test.gabhru.eth` is registered (seeded in Postgres). The
gateway now reads from a Postgres-backed agents table (Plan 2) so any owner
can register their agent via the REST API.

## Repo layout

- `apps/gateway` — CCIP-Read offchain resolver gateway (Hono on Vercel)
- `apps/api` — REST API for dashboard + SDK auth (Hono, SIWE + JWT, deploys to Vercel)
- `apps/dashboard` — Next.js 16 onboarding wizard + agents UI (deploys to Vercel)
- `packages/contracts` — Solidity contracts (Foundry); `OurOffchainResolver` is the deployed wildcard resolver
- `packages/db` — Drizzle ORM schema, migrations, and query helpers (shared by gateway + api)
- `packages/auth` — SIWE verification, JWT mint/verify, Hono middleware (used by api)
- `scripts/local-e2e.sh` — one-shot anvil-fork verification of the full CCIP-Read loop
- `docs/superpowers/specs` — design specs (threat model, key model, ENS strategy)
- `docs/superpowers/plans` — implementation plans

## Plans

| # | Title | Status |
|---|---|---|
| 1 | Foundation + ENS resolver | ✅ deployed to mainnet |
| 2 | Backend foundation (Postgres, SIWE, agent CRUD) | ✅ implemented (local) |
| 3 | Onboarding wizard | ✅ implemented (local) |
| 4 | Stealth crypto + gateway integration | tbd |
| 5 | Scanner + dashboard | tbd |
| 6 | TypeScript SDK | tbd |
| 7 | Sweep + reputation + demo polish | tbd |

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
```

To verify the full mainnet CCIP-Read loop locally against an anvil fork
(no real ETH spent), populate `.env` with `MAINNET_RPC_URL`,
`GATEWAY_SIGNER_PRIVATE_KEY`, `GATEWAY_SIGNER_ADDRESS`, then:

```bash
./scripts/local-e2e.sh
```

For per-package development, see each package's README.

### Migrating Plan 3 stub rows after Plan 4 is live

Plan 3 wrote `view_key_encrypted = 'stub:<keccak256(signature)>'` because the
real Fluidkey derivation hadn't landed yet. Plan 4 changes the wizard so any
new agent gets a real `v1:`-prefixed envelope. Existing stub rows must be
re-onboarded (the spend private key was never derived in Plan 3).

```bash
# 1. See what's still on stubs.
pnpm node scripts/flag-stub-agents.mjs --list

# 2. Mark them so the dashboard renders "re-derive your keys" banners.
pnpm node scripts/flag-stub-agents.mjs --notify

# 3. (Later) Once owners have re-derived, soft-delete any holdouts.
pnpm node scripts/flag-stub-agents.mjs --delete
```

## Deploying to Vercel (after Plan 3)

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
