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
| Resolver contract | [`0x6c11e3cb958c84cfd339123a2b9c4196c755f777`](https://etherscan.io/address/0x6c11e3cb958c84cfd339123a2b9c4196c755f777) |
| Resolver deploy tx | [`0x969bd6…056c6c`](https://etherscan.io/tx/0x969bd60bc389c38623775aef6eb271bfdf3e9828db9f673bdcc7a08e17056c6c) |
| `gabhru.eth` setResolver tx | [`0xaa5cae…02a33258`](https://etherscan.io/tx/0xaa5cae905d6d436cdef5c502bb665e539fd836c33ba22548bbc089dd02a33258) |
| Gateway (Vercel, edge runtime) | [open-agents-gateway-happys1nghs-projects.vercel.app](https://open-agents-gateway-happys1nghs-projects.vercel.app/health) |
| Gateway signer (CCIP-Read) | `0x9B9B2C0F4a157ae83eaF3f0e901Ff6F8AE510017` |

Currently only `test.gabhru.eth` is registered (stub). Plan 2 swaps the stub
for a Postgres-backed agents table so any owner can register their agent.

## Repo layout

- `apps/gateway` — CCIP-Read offchain resolver gateway (Hono on Vercel edge runtime)
- `packages/contracts` — Solidity contracts (Foundry); `OurOffchainResolver` is the deployed wildcard resolver
- `scripts/local-e2e.sh` — one-shot anvil-fork verification of the full CCIP-Read loop
- `docs/superpowers/specs` — design specs (threat model, key model, ENS strategy)
- `docs/superpowers/plans` — implementation plans

## Plans

| # | Title | Status |
|---|---|---|
| 1 | Foundation + ENS resolver | ✅ deployed to mainnet |
| 2 | Backend foundation (Postgres, SIWE, agent CRUD) | drafted |
| 3 | Onboarding wizard | tbd |
| 4 | Stealth crypto + gateway integration | tbd |
| 5 | Scanner + dashboard | tbd |
| 6 | TypeScript SDK | tbd |
| 7 | Sweep + reputation + demo polish | tbd |

## Quick start

```bash
pnpm install
pnpm -r build
pnpm -r test
```

To verify the full mainnet CCIP-Read loop locally against an anvil fork
(no real ETH spent), populate `.env` with `MAINNET_RPC_URL`,
`GATEWAY_SIGNER_PRIVATE_KEY`, `GATEWAY_SIGNER_ADDRESS`, then:

```bash
./scripts/local-e2e.sh
```

For per-package development, see each package's README.
