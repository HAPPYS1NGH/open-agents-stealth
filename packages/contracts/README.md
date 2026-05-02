# @open-agents/contracts

Solidity contracts for Open Agents private payments.

## Contracts

- `OurOffchainResolver` — ENSIP-10 wildcard resolver implementing ERC-3668
  CCIP-Read for `*.gabhru.eth`. Set as `gabhru.eth`'s resolver.
- `SignatureVerifier` — internal library porting ENS's hash format for
  CCIP-Read response verification (`keccak256(0x1900 || target || expires
  || keccak(request) || keccak(result))`).

## Live deployment (Ethereum mainnet)

| | |
|---|---|
| Resolver address | [`0x6c11e3cb958c84cfd339123a2b9c4196c755f777`](https://etherscan.io/address/0x6c11e3cb958c84cfd339123a2b9c4196c755f777) |
| Deploy tx | [`0x969bd6…056c6c`](https://etherscan.io/tx/0x969bd60bc389c38623775aef6eb271bfdf3e9828db9f673bdcc7a08e17056c6c) |
| `gabhru.eth` setResolver tx | [`0xaa5cae…02a33258`](https://etherscan.io/tx/0xaa5cae905d6d436cdef5c502bb665e539fd836c33ba22548bbc089dd02a33258) |
| Gateway URL | https://open-agents-gateway-happys1nghs-projects.vercel.app |
| Gateway signer | `0x9B9B2C0F4a157ae83eaF3f0e901Ff6F8AE510017` |
| Compiler | solc 0.8.24, optimizer on (200 runs) |

## Setup (first clone only)

The `lib/` directory contains Foundry dependencies and is gitignored. After
cloning, install them:

```bash
pnpm --filter @open-agents/contracts setup
```

Or directly with forge:

```bash
forge install --no-git OpenZeppelin/openzeppelin-contracts \
  ensdomains/ens-contracts foundry-rs/forge-std
```

## Build & test

```bash
forge build
forge test -vv
```

## Deployment

See `script/Deploy.s.sol`. **Read the runbook below twice before running
anything that touches mainnet.**

## Mainnet runbook

The full flow is automated by `scripts/local-e2e.sh` against an anvil fork
first. Mainnet is the same shape, with `--rpc-url $MAINNET_RPC_URL` and your
real `DEPLOYER_PRIVATE_KEY`.

### Pre-flight

- `MAINNET_RPC_URL` set in `.env`
- `DEPLOYER_PRIVATE_KEY` holds ≥ 0.001 ETH on mainnet (covers deploy +
  setResolver at typical gas)
- `GATEWAY_URL` is the Vercel production URL (deployed first — its URL is
  baked into the resolver constructor)
- `GATEWAY_SIGNER_ADDRESS` matches the address whose private key is set on
  the deployed gateway as `GATEWAY_SIGNER_PRIVATE_KEY`

### Step 1 — Deploy the resolver

```bash
cd packages/contracts
forge script script/Deploy.s.sol \
  --rpc-url $MAINNET_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast --verify
```

Capture the deployed address from `broadcast/Deploy.s.sol/1/run-latest.json`
and write it back into `.env` as `RESOLVER_ADDRESS`.

### Step 2 — Set `gabhru.eth`'s resolver

If the name is unwrapped (legacy ENS Registry — verify with
`cast call 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
"owner(bytes32)(address)" $GABHRU_NODE`):

```bash
cast send 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e \
  "setResolver(bytes32,address)" \
  0xf84f7430dd93b6e0f17b948c5d022fe48a33be365d0fca0a8ede3a7b893da1b6 \
  $RESOLVER_ADDRESS \
  --rpc-url $MAINNET_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY
```

If wrapped (NameWrapper at `0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401`),
call `setResolver` on the wrapper with the same calldata.

### Step 3 — Verify resolution

```bash
node --input-type=module -e '
import { createPublicClient, http } from "viem"
import { mainnet } from "viem/chains"
const c = createPublicClient({ chain: mainnet, transport: http(process.env.MAINNET_RPC_URL) })
console.log(await c.getEnsAddress({ name: "test.gabhru.eth" }))
'
```

Expected: a non-null address served by the gateway. (Currently
`0x000000000000000000000000000000000000bEEF` for the seed `test` agent.)

## Etherscan verification (post-deploy)

If `--verify` was skipped at deploy time, run separately. Set
`ETHERSCAN_API_KEY` in `.env`:

```bash
forge verify-contract \
  0x6c11e3cb958c84cfd339123a2b9c4196c755f777 \
  src/OurOffchainResolver.sol:OurOffchainResolver \
  --chain mainnet \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(string[],address[])" \
    '["https://open-agents-gateway-happys1nghs-projects.vercel.app/resolve/{sender}/{data}.json"]' \
    '["0x9B9B2C0F4a157ae83eaF3f0e901Ff6F8AE510017"]') \
  --compiler-version 0.8.24 \
  --num-of-optimizations 200
```
