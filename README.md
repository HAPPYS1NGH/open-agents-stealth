# Open Agents — Private Agent Payments

Fluidkey-equivalent stealth-payment infrastructure for ERC-8004 AI agents,
addressable through ENS subnames under `gabhru.eth`.

See `docs/superpowers/specs/2026-05-02-private-agent-payments-design.md`
for the architecture and threat model.

## Repo layout

- `apps/gateway` — CCIP-Read offchain resolver gateway (Hono, deploys to Vercel)
- `packages/contracts` — Solidity contracts (Foundry)
- `docs/superpowers/specs` — design specs
- `docs/superpowers/plans` — implementation plans

## Plans (executed in order)

1. **Foundation + ENS resolver** — current
2. Backend foundation
3. Onboarding wizard
4. Stealth crypto + gateway integration
5. Scanner + dashboard
6. TypeScript SDK
7. Sweep + reputation + demo polish

## Quick start

```bash
pnpm install
pnpm -r build
pnpm -r test
```

For per-package development, see each package's README.
