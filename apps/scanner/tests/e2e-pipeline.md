# Plan 5 — End-to-end pipeline runbook

This document walks a single USDC payment from the sender console all the way
through the dashboard. Run after Plans 1–4 are live and Plan 5 is implemented.

## Prerequisites
- Local Postgres up: `docker compose -f docker-compose.dev.yml up -d`.
- Migrations applied through `0004_payments_receipts`:
  ```bash
  docker exec -i $(docker compose -f docker-compose.dev.yml ps -q postgres) \
    psql -U open_agents -d open_agents \
    < packages/db/migrations/0004_payments_receipts.sql
  ```
- An agent registered (`alice.gabhru.eth`-style subname) with `stealth-meta`
  published — the Plan 4 wizard does this end-to-end.
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
curl -s -X POST http://localhost:3002/tick \
  | jq '.perAgent[] | select(.reconcile.inserted > 0)'
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

## Known limitations (from the Plan 5 reviewer audit)

- **First-scan backfill window**: an agent whose announcement landed before
  the `SCAN_LOOKBACK_BLOCKS` cursor (default 3000 blocks ≈ 100 min on Base)
  will miss historical payments on the first scan. Workaround: bump
  `SCAN_LOOKBACK_BLOCKS` for the first cron tick after deploy, or insert a
  manual seed row via the script above.
- **CRON_SECRET in production**: the `/tick` route fails closed when
  `CRON_SECRET` is unset AND `NODE_ENV=production`. Verify the env var is
  set in the Vercel project before promoting to prod.

## Failure modes (and how to tell)

- **Dashboard stays empty after tick**: check `apps/scanner` logs for the
  per-agent `inserted: 0` line. Likely the gateway hasn't issued an
  announcement yet — visit `/pay/<label>.gabhru.eth` once to force `addr()`
  to write a row, then re-tick.

- **`/tick` returns 401 (in dev)**: a stale `CRON_SECRET=...` is set in your
  shell env. `unset CRON_SECRET` and re-curl, or pass the matching
  `Authorization: Bearer <secret>` header.

- **SSE stream doesn't push**: confirm the JWT on the URL hasn't expired.
  Refresh the dashboard tab to re-mint the token; the EventSource will
  reconnect on the next render.

- **`announce()` reverts**: check the Announcer address in
  `apps/dashboard/src/lib/announcer.ts`. Per-spec it's `0x55649E…45564`;
  confirm Base mainnet has the same deployment.

- **Gateway returns 500 on `text("stealth-payload")`**: the agent's
  `stealth-meta` text record is malformed (not a valid 132-hex string of two
  compressed secp256k1 pubkeys). Re-run the Plan 4 wizard step 2 to derive
  fresh stealth keys.
