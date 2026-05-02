#!/usr/bin/env bash
# Local end-to-end test: anvil mainnet fork + gateway + on-chain resolver.
# Verifies the full CCIP-Read loop works before risking mainnet gas.
#
# Usage:
#   ./scripts/local-e2e.sh
#
# Requires (in repo root .env):
#   MAINNET_RPC_URL              — Alchemy/Infura/etc
#   GATEWAY_SIGNER_PRIVATE_KEY   — fresh keypair (any 32-byte hex)
#   GATEWAY_SIGNER_ADDRESS       — derived address of the above
#
# The script:
#   1. boots anvil forked at mainnet
#   2. deploys OurOffchainResolver to the fork
#   3. boots the gateway pointing at localhost
#   4. impersonates gabhru.eth owner and points its resolver at our contract
#   5. resolves test.gabhru.eth via viem (full CCIP-Read flow)
#   6. tears down

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck disable=SC1091
set -a; source "$REPO_ROOT/.env"; set +a

: "${MAINNET_RPC_URL:?MAINNET_RPC_URL not set in .env}"
: "${GATEWAY_SIGNER_PRIVATE_KEY:?GATEWAY_SIGNER_PRIVATE_KEY not set in .env}"
: "${GATEWAY_SIGNER_ADDRESS:?GATEWAY_SIGNER_ADDRESS not set in .env}"

ENS_REGISTRY=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
GABHRU_NODE=0xf84f7430dd93b6e0f17b948c5d022fe48a33be365d0fca0a8ede3a7b893da1b6
ANVIL_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ANVIL_LOG=/tmp/open-agents-anvil.log
GATEWAY_LOG=/tmp/open-agents-gateway.log

cleanup() {
  echo "--- cleanup ---"
  if [[ -n "${ANVIL_PID:-}" ]]; then kill "$ANVIL_PID" 2>/dev/null || true; fi
  if [[ -n "${GATEWAY_PID:-}" ]]; then kill "$GATEWAY_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT

echo "[1/5] starting anvil mainnet fork..."
nohup anvil --fork-url "$MAINNET_RPC_URL" --port 8545 --host 127.0.0.1 > "$ANVIL_LOG" 2>&1 &
ANVIL_PID=$!
sleep 3
grep -q "Listening on 127.0.0.1:8545" "$ANVIL_LOG" || { echo "anvil failed:"; tail -20 "$ANVIL_LOG"; exit 1; }

echo "[2/5] deploying resolver to fork..."
cd packages/contracts
GATEWAY_URL="http://localhost:3000" \
GATEWAY_SIGNER_ADDRESS="$GATEWAY_SIGNER_ADDRESS" \
forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --private-key "$ANVIL_PK" \
  --broadcast > /tmp/open-agents-deploy.log 2>&1

RESOLVER=$(python3 -c '
import json
with open("broadcast/Deploy.s.sol/1/run-latest.json") as f:
    data = json.load(f)
for tx in data["transactions"]:
    if tx["transactionType"] == "CREATE":
        print(tx["contractAddress"])
        break
')
echo "    resolver: $RESOLVER"
cd "$REPO_ROOT"

echo "[3/5] starting gateway against fork..."
cd apps/gateway
GATEWAY_SIGNER_PRIVATE_KEY="$GATEWAY_SIGNER_PRIVATE_KEY" \
RESOLVER_ADDRESS="$RESOLVER" \
PORT=3000 \
nohup pnpm dev > "$GATEWAY_LOG" 2>&1 &
GATEWAY_PID=$!
cd "$REPO_ROOT"
sleep 4
curl -sf http://localhost:3000/health > /dev/null || { echo "gateway failed:"; tail -20 "$GATEWAY_LOG"; exit 1; }

echo "[4/5] swapping gabhru.eth resolver via impersonation..."
GABHRU_OWNER=$(cast call $ENS_REGISTRY "owner(bytes32)(address)" $GABHRU_NODE --rpc-url http://127.0.0.1:8545)
echo "    gabhru.eth owner: $GABHRU_OWNER"
cast rpc anvil_impersonateAccount "$GABHRU_OWNER" --rpc-url http://127.0.0.1:8545 > /dev/null
cast rpc anvil_setBalance "$GABHRU_OWNER" 0xDE0B6B3A7640000 --rpc-url http://127.0.0.1:8545 > /dev/null
cast send $ENS_REGISTRY "setResolver(bytes32,address)" $GABHRU_NODE "$RESOLVER" \
  --from "$GABHRU_OWNER" \
  --rpc-url http://127.0.0.1:8545 \
  --unlocked > /dev/null

echo "[5/5] resolving test.gabhru.eth via CCIP-Read..."
cd apps/gateway
node --input-type=module -e '
import { createPublicClient, http } from "viem"
import { mainnet } from "viem/chains"
const client = createPublicClient({ chain: mainnet, transport: http("http://127.0.0.1:8545") })
const addr = await client.getEnsAddress({ name: "test.gabhru.eth" })
if (addr?.toLowerCase() !== "0x000000000000000000000000000000000000beef") {
  console.error("E2E FAIL: got", addr)
  process.exit(1)
}
console.log("    test.gabhru.eth →", addr)
const unknown = await client.getEnsAddress({ name: "unknown-agent.gabhru.eth" })
if (unknown !== null) {
  console.error("negative path FAIL: expected null, got", unknown)
  process.exit(1)
}
console.log("    unknown-agent.gabhru.eth → null (correct)")
'

echo
echo "✅ E2E PASS — full CCIP-Read loop verified end-to-end on the fork."
