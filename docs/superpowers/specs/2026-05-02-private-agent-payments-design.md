# Private Agent Payments — Design Spec

**Date:** 2026-05-02
**Author:** Harpreet Singh (HAPPYS1NGH) + Claude
**Status:** Draft, pending review
**Target event:** ETHGlobal OpenAgents — ENS track

---

## 1. Summary

We are building **Fluidkey-equivalent stealth-payment infrastructure for AI agents**, native to ERC-8004 identity and addressable through ENS. An agent owner registers once via a web wizard and gets a free subname under `gabhru.eth` (e.g. `mybot.gabhru.eth`). Anyone resolving that name from any ENS-aware wallet receives a **fresh ERC-5564 stealth address per query**, derived from the agent's public stealth meta-address. Senders pay normally; the agent's revenue, customer set, and total volume stay invisible to outside observers.

Reputation continues to accrue on the **stable ERC-8004 `agentId`** (owned by the agent owner's main wallet). Feedback is **trust-based by default** (no on-chain payment proof) and **opt-in linkable** by the agent via `appendResponse` when the agent wants to publicly vouch for a specific client interaction.

Three on-chain components are reused as deployed; **one custom resolver contract** is deployed on Ethereum mainnet. Everything else lives in our hosted backend, frontend, and TypeScript SDK.

---

## 2. Goals and non-goals

### Goals

- **Privacy by default for incoming agent payments.** No competitor or casual observer should be able to enumerate an agent's incoming payments, total revenue, or customer set from public on-chain data alone.
- **Zero-friction developer onboarding.** A TypeScript agent dev should go from sign-up to working private-payment-receiving agent in under 90 seconds, without deploying contracts, registering an ENS name, or hosting infrastructure.
- **ERC-8004 native.** Reputation, identity, and discovery work through canonical ERC-8004 contracts and ENSIP-25 / ENSIP-26 records — no new identity protocol.
- **Composable with agent0-ts.** Devs already using `agent0-ts` add private payments by wrapping their `SDK` instance.
- **Real on Base mainnet.** Demo runs on production infrastructure, not testnet.

### Non-goals (v1)

- **Anti-correlation against sophisticated chain analysts.** Threat model is **Threat 1: casual observer / competitive intelligence**, not nation-state-grade chain analysis. A determined chain-walker with the agent's *consolidated treasury* as a starting point may still trace stealth payments backwards in time. We document the privacy boundary at consolidation and recommend a separate treasury Safe.
- **Verifiable zero-knowledge proof of payment in feedback.** Roadmap item; v1 ships trust-based feedback + opt-in agent confirmation.
- **Self-hosted scanner / view-key sovereignty.** v1 uses a custodial hosted scanner. Hybrid (E2E-encrypted, view-tag-filtered) scanner is the post-v1 roadmap.
- **Bring-your-own ENS name.** v1 issues subnames under `gabhru.eth` only. BYO ENS is a roadmap item that requires the dev to set their own resolver.
- **Multiple chains.** Base mainnet only for payments. ENS resolution lives on Ethereum mainnet (where ENS lives). Multi-chain agents are a roadmap item.
- **Python SDK / Eliza / LangChain plugin.** TypeScript SDK only for v1.
- **x402 settlement integration.** We acknowledge x402 as the Base-paved lane; layering stealth underneath x402 (fresh stealth address as the 402 `payTo`) is roadmap.

---

## 3. Threat model and privacy properties

### Threat actor (Threat 1)

A competitor or curious onlooker who:

- Reads any public on-chain registry (ENS, ERC-8004, ERC-5564 announcer)
- Inspects block explorers for the agent's known main wallet
- Resolves the agent's ENS name via standard tools
- **Does not** systematically chain-walk consolidation patterns or run statistical de-anonymization

### What stays private

- Total agent revenue
- Number of customers
- Identity of any specific customer
- Per-payment amounts
- Per-payment timing (in aggregate; individual announcement events are public, but unattributable to a specific agent without the agent's view private key)

### What is public

- The agent's existence (`agentId`, ERC-721 NFT, owner's main wallet)
- The agent's ENS name (`<agent>.gabhru.eth`)
- The agent's reputation score and feedback count
- The fact that *some* ERC-5564 announcements exist on Base mainnet
- Whatever the agent owner publicly confirms via `appendResponse` (opt-in)

### Privacy boundary: consolidation

When an agent sweeps stealth-address balances into a single treasury, the on-chain transfers are visible. If that treasury is the agent's publicly-known main wallet, a chain-walker can reconstruct the stealth-address set. We mitigate by:

- Defaulting consolidation target to a **separate Safe** (deployed during onboarding) that is not the main wallet
- Not advertising the consolidation Safe in any public registry
- Documenting the boundary explicitly in dashboard UI ("transfers from stealth addresses to your treasury are visible on-chain")

This is sufficient for Threat 1. Threat 2 (sophisticated chain-walker) requires v2's hybrid scanner + privacy-preserving consolidation, out of scope.

---

## 4. Architecture

### 4.1 Topology

```
┌────────────────────────────────────────────────────────────────────────┐
│ Ethereum Mainnet                                                       │
│  gabhru.eth (owned by HAPPYS1NGH)                                      │
│   └─ resolver = OurOffchainResolver (custom, deployed by us)           │
│       └─ implements IExtendedResolver (ENSIP-10 wildcard)              │
│       └─ reverts OffchainLookup → our gateway (ERC-3668 / CCIP-Read)   │
└────────────────────────────────────────────────────────────────────────┘
                                  │
            (CCIP-Read offchain query, returned via gateway)
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Hosted Backend (Vercel / Railway, TypeScript)                          │
│  ├─ /resolve gateway (ERC-3668 spec) — derives fresh stealth addr      │
│  ├─ /api dashboard + SDK REST                                          │
│  ├─ /ws WebSocket push for SDK runtime payment notifications           │
│  ├─ scanner worker — tails ERC-5564 Announcer logs on Base, decrypts   │
│  │   matches with each agent's view private key, persists payments    │
│  └─ Postgres                                                           │
│      • agents (id, owner, agentId, ensSubname, stealthMeta, ...)       │
│      • viewKeys (encrypted at rest with our KMS key)                   │
│      • payments (announcement, stealthAddr, amount, sender, status)    │
│      • receipts (signed EIP-712 receipts issued)                       │
└────────────────────────────────────────────────────────────────────────┘
                                  │
                                  │  (read by agent owner)
                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Base Mainnet                                                           │
│  ERC-8004 IdentityRegistry  0x8004A169FB4a3325136EB29fA0ceB6D2e539a432│
│  ERC-8004 ReputationRegistry 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63│
│  ERC-5564 Announcer         0x55649E01B5Df198D18D95b5cc5051630cfD45564│
│  Agent's consolidation Safe (deployed per agent during onboarding)     │
│  USDC (payment asset)                                                  │
└────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Frontend (Next.js, Vercel)                                             │
│  /                  marketing + connect-wallet                         │
│  /onboard           4-step wizard                                      │
│  /dashboard         payments, reputation, withdraw                     │
│  /pay/[ens]         "Pay an agent" demo console (sender side)          │
└────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│ TypeScript SDK (npm: @gabhru/private-pay)                              │
│  Wraps agent0-ts. Exports:                                             │
│   withPrivatePay(sdk, { apiKey })                                      │
│   agent.onPayment(callback)                                            │
│   agent.signReceipt({ client, amount, requestHash })                   │
│   agent.withdraw(toAddress, amount)                                    │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Stealth scheme — EOA signer + Safe smart account per payment

ERC-5564 with secp256k1 (scheme id `1`), using the **Fluidkey two-tier pattern** so every receiving address is a smart account that supports gas sponsorship:

- Each agent has a **stealth meta-address** = compressed `spendPubKey` || compressed `viewPubKey` (66 bytes raw, 132 hex chars).
- `spendPrivKey` is generated **client-side** in the browser during onboarding, encrypted with a dev-supplied passphrase + WebCrypto, and stored only on the dev's machine. Never sent to our backend in any form.
- `viewPrivKey` is generated client-side, then sent to our backend over TLS, **encrypted at rest** with a backend KMS key. It is required for our scanner to identify incoming payments.

**Per resolution / payment:**

1. Gateway generates ephemeral keypair `(r, R)` where `R = r·G`.
2. Computes shared secret `s = r·viewPubKey`.
3. Derives **stealth EOA** address `addrEOA = keccak(s)·G + spendPubKey`. *This EOA never holds funds; it is only a signer.*
4. Computes **stealth Safe** address via CREATE2: deterministic 1/1 Safe owned by `addrEOA`. Use `@scopelift/stealth-address-sdk` or port `fluidkey-stealth-account-kit`'s `predictStealthSafeAddress`. *This Safe address is what the gateway returns to the resolver client.*
5. Sender transfers USDC to `addrSafe` and emits `Announcer.announce(1, addrSafe, R, viewTag||metadata)` on Base.
6. The Safe contract does **not need to be deployed at receive time** — its address is predictable from CREATE2, and USDC happily transfers to a non-deployed address (funds sit at the address).
7. On first withdrawal from a particular stealth address, the SDK deploys the Safe (CREATE2) and immediately executes a `transfer` from the Safe to the agent's treasury Safe. Both the deployment and the transfer are batched into a single user-op sponsored by a paymaster. Subsequent withdrawals (if more arrives at the same Safe — shouldn't happen with one-time addresses, but possible) skip the deployment step.

**Why Safes and not raw EOAs:** EOAs at fresh stealth addresses have no ETH for gas. Forcing the agent to pre-fund them defeats privacy (every funded EOA links back to a treasury). Safes at predictable CREATE2 addresses receive funds passively, and their first execution can be sponsored by a paymaster. Net effect: zero ETH ever needs to land at a stealth address; gas is paid in the agent's domain through account abstraction.

### 4.4 Three-key model — owner / agent / spend

The agent has three logically distinct keys, each with a different role and threat profile. They MUST be kept separate.

| Key | Origin | Lives where | Used for | Rotatable | Compromise impact |
|---|---|---|---|---|---|
| **Owner key** | Dev's existing wallet (Coinbase Smart Wallet, MetaMask, etc.) | Hardware/passkey/extension. Never in `.env`. | One-time wizard signing, dashboard auth, rotating the agent key, transferring agent NFT. | Implicitly via NFT transfer. | Total — agent ownership lost. |
| **Agent wallet key** | Fresh EOA generated client-side during wizard. Authorized on-chain via `IdentityRegistry.setAgentWallet(agentId, hotKey, deadline, hotKeySig)`. | The dev's `.env` as `AGENT_WALLET_PRIVATE_KEY`. | SDK runtime auth (signing challenges), EIP-712 receipt signing, future agent-to-agent SIWA. | Yes — owner key signs `setAgentWallet(newKey, ...)` from dashboard, ~$0.05 sponsored. | Attacker can read payment events for this agent, forge receipts. Cannot move the NFT, cannot reach owner wallet, cannot drain stealth Safes. |
| **Spend key** | Fresh secp256k1 key generated client-side during wizard. Public half registered in our resolver as part of the stealth meta-address. | The dev's `.env` as `SPEND_PRIVATE_KEY` *only if* they sweep from code; otherwise stays browser-encrypted and they sweep from the dashboard. | Deriving each per-payment stealth EOA private key (which controls the Safe holding the funds). | No — would require re-creating the agent, since the public half is in the stealth meta-address. | Attacker can drain all current and future stealth Safes for this agent. Cannot move the NFT or reach owner wallet. |

**Why three keys, not one or two:**

- Combining owner and agent: leaking the runtime key would lose the NFT and dashboard control. Bad.
- Combining agent and spend: rotating the agent key would lose access to all stealth funds (since stealth derivation depends on the spend key). Rotation becomes destructive. Bad.
- Three keys gives clean compromise containment and clean rotation semantics.

**Solo-dev simplification:** for hobby agents, the wizard offers a "use my owner key as agent wallet too" toggle. We skip `setAgentWallet`, the SDK auths against `ownerOf`, and the dev exports their owner EOA private key (only viable with MetaMask + EOA owner; not with Coinbase Smart Wallet). Documented as **not recommended for production**, with a one-click "promote to delegated wallet" upgrade path in the dashboard.

### 4.2.1 Gas and paymaster

- **Owner wallet** during onboarding: recommend Coinbase Smart Wallet (already paymaster-integrated on Base for Coinbase-sponsored apps); MetaMask + EOA also supported with normal gas.
- **Stealth Safe deployment + sweep**: sponsored via Base's Coinbase paymaster (or Pimlico — both work; Coinbase preferred since the app targets Base agents). Daily caps configured on our paymaster credentials to bound abuse.
- **Treasury Safe withdrawal to dev's personal wallet**: sponsored same way.
- **Sender side** (USDC transfer + announce): sender's wallet pays normally; not our concern.

Cost ceiling per agent for normal usage: effectively $0 with paymaster, ~$0.10 of Base gas raw without it.

### 4.3 Why this is "Fluidkey for agents," not Fluidkey

| Dimension              | Fluidkey                          | Ours                                                          |
|------------------------|-----------------------------------|----------------------------------------------------------------|
| Target user            | Consumer / EOA owner              | Agent dev / 8004-registered AI agent                          |
| Identity binding       | None                              | ERC-8004 `agentId` + reputation + ENSIP-25 attestation        |
| Reputation             | None                              | ERC-8004 reputation registry, trust-based + opt-in confirmation |
| Subname namespace      | `*.fkey.id` / `*.fkey.eth`        | `*.gabhru.eth`                                                |
| Resolver source        | Closed                            | Open-source (we publish)                                      |
| Crypto kit             | Their own (`fluidkey-stealth-account-kit`) | `@scopelift/stealth-address-sdk` (vendor-neutral, viem-native) |
| Receiving address      | 1/1 Safe smart account            | 1/1 Safe smart account (same pattern, our deployment)         |
| Onboarding wallet      | Privy / EOA                       | Coinbase Smart Wallet recommended; MetaMask supported         |
| Gas model              | Sponsored (paymaster)             | Sponsored (Base Coinbase paymaster); raw fallback             |
| Scanner custody (v1)   | Custodial                         | Custodial                                                     |
| Scanner custody (v2)   | N/A                               | Hybrid (view-tag pre-filter, agent-side decrypt) — roadmap    |
| Receipts               | N/A                               | EIP-712 signed receipts for opt-in reputation                 |
| SDK                    | None for agents                   | `@gabhru/private-pay`, wraps `agent0-ts`                      |

---

## 5. Components

### 5.1 ENS — `gabhru.eth` and OffchainResolver

**One-time setup:** owner of `gabhru.eth` calls `setResolver(gabhruEthNode, ourResolverAddr)` on the ENS Public Resolver. From that point forward, all `<anything>.gabhru.eth` queries flow to our resolver.

**`OurOffchainResolver.sol`** (forked from `ensdomains/offchain-resolver`, single file):

- Implements `IExtendedResolver` (`0x9061b923`), the ENSIP-10 wildcard interface.
- Implements `resolve(bytes name, bytes data)` to revert with `OffchainLookup(sender, urls, callData, callbackFunction, extraData)` per ERC-3668.
- Implements `resolveWithProof(bytes response, bytes extraData)` that recovers the gateway's signature and checks against an authorized-signer mapping.
- Stores an authorized signers map (initially one EOA we control) so we can rotate gateway keys without redeploying.

**Gateway** (`/resolve`, hosted backend): receives `name` (DNS-encoded) and `data` (ABI-encoded `addr/text/contenthash` calldata) from CCIP-Read clients. Decodes the label, looks up the agent in our DB by subname, derives a fresh stealth address per ERC-5564, and signs the response with our gateway key. Supports:

- `addr(node)` (coinType 60, default Ethereum address) — returns stealth address (also serves as fallback for wallets that don't ENSIP-11)
- `addr(node, 2147492101)` (coinType for Base mainnet) — returns same stealth address
- `text(node, "agent-context")` — returns the agent's ENSIP-26 context JSON
- `text(node, "agent-endpoint[mcp]")` / `[a2a]` / `[web]` — returns the agent's published endpoints
- `text(node, "agent-registration[<eip-7930-addr>][<agentId>]")` — returns `"1"` per ENSIP-25 attestation
- `text(node, "stealth-meta")` — returns the meta-address bytes (public; redundant with derivation but useful for clients that want to derive themselves)

The gateway never stores the stealth addresses it generates per-request — they are recomputable from `(metaAddr, ephemeralKey)` and the ephemeralKey is also published in the ERC-5564 announcement at payment time. (See §5.4 on scanner.)

### 5.2 Smart contracts (Base mainnet — already deployed)

| Contract                | Address                                         | Notes                                                    |
|-------------------------|-------------------------------------------------|----------------------------------------------------------|
| ERC-8004 IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | Upgradeable proxy (`ERC1967Proxy`). Native `setMetadata`/`getMetadata`/`setAgentWallet`/`setAgentURI`. No "Adapter" — the canonical contract has the full surface. |
| ERC-8004 ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `giveFeedback`, `appendResponse`, `revokeFeedback`. Same vanity scheme. |
| ERC-5564 Announcer      | `0x55649E01B5Df198D18D95b5cc5051630cfD45564`   | CREATE2-deployed, same address on Base mainnet, Sepolia, Ethereum mainnet. We tail its `Announcement` event log. |

We deploy zero contracts on Base. We integrate via `agent0-ts` (calls `IdentityRegistry`, `ReputationRegistry`) and viem (calls `Announcer` for sender-side `announce(...)` from the `/pay/[ens]` page).

### 5.3 Hosted backend

**Stack:** Node.js + TypeScript, Hono or Next.js API routes (Vercel-friendly), Postgres (via Supabase or Railway), Redis for queue/pubsub, viem for chain reads.

**Services:**

1. **Resolver gateway** (`POST /resolve`): receives CCIP-Read calls, derives stealth addresses, signs responses.
2. **Onboarding API** (`POST /api/agents`, etc.): creates agents, issues subnames, deploys consolidation Safes, stores encrypted view keys.
3. **Dashboard API** (`GET /api/payments`, `POST /api/withdraw`, `POST /api/receipts/sign`, `POST /api/feedback/confirm`): SIWE-authed endpoints for the agent owner.
4. **SDK API** (`GET /api/agent/me`, `POST /api/sdk/sign-receipt`, WS `/ws`): API-key-authed endpoints for the agent runtime.
5. **Scanner worker** (long-running): tails the `Announcement` event on Base via viem's `watchContractEvent`, for each agent computes whether the announcement matches (using their `viewPrivKey` and the announcement's `ephemeralPubKey` and `viewTag`), persists matches to `payments` table, pushes WebSocket events to subscribed SDK clients.

**Encryption:** view private keys are encrypted with envelope encryption — a per-agent data key is encrypted by a master KMS key (initially Vercel KV-stored, rotatable). Decryption happens only inside the scanner worker process at scan time.

**Auth:**
- Dashboard: SIWE (`siwe` v3 npm package) — challenge/sign/verify against the **owner wallet** (the EOA / smart account that owns the ERC-721 NFT).
- SDK: **wallet-based session auth using a delegated *agent wallet* hot key, not the owner wallet.** Flow: SDK calls `POST /api/sdk/challenge`, signs the returned nonce with the agent-wallet hot key, backend recovers the signer and checks `signer === IdentityRegistry.getAgentWallet(agentId)` (preferred) or `signer === IdentityRegistry.ownerOf(agentId)` (fallback for solo-dev mode where the same key is used for everything), returns a 24h JWT. SDK uses the JWT for REST + WebSocket; refreshes automatically.

See §4.4 for the three-key model that this auth path implements.

### 5.4 Scanner worker — payment matching

For each new `Announcement(uint256 schemeId, address stealthAddress, address caller, bytes ephemeralPubKey, bytes metadata)` event on Base:

1. Read `viewTag = metadata[0]` (1 byte per ERC-5564 convention).
2. For each agent with a matching `viewTag` filter (computed lazily from `viewPrivKey · ephemeralPubKey`), do the full check:
   - Compute `s = viewPrivKey · ephemeralPubKey`
   - Compute `expectedAddr = keccak(s)·G + spendPubKey` (on the secp256k1 curve)
   - If `expectedAddr == stealthAddress`, this announcement is for this agent.
3. On match: read the on-chain transfer to `stealthAddress` (USDC `Transfer` event, same block), persist `{ agentId, stealthAddress, amount, sender, txHash, timestamp }` to `payments`.
4. Push `{ type: "payment", payload: { ... } }` to the agent's WebSocket subscribers.

For v1 we scan all announcements naively (O(announcements × agents) per block, fine for hackathon scale). v2's hybrid model has the agent's SDK do the final ECDH-and-compare step locally; the scanner does pre-filtering only.

### 5.5 Frontend — Next.js

- **`/`** — marketing page; "Connect wallet" → SIWE → routes to onboard or dashboard.
- **`/onboard`** — 4-step wizard:
  1. Pick agent name (subname under `gabhru.eth`). Live availability check.
  2. Generate stealth keys client-side. Show meta-address, save spend-priv-key encrypted to localStorage with user-chosen passphrase, send view-priv-key encrypted-in-transit to backend.
  3. Sign agent registration tx via `agent0-ts` (mints ERC-8004 NFT on Base, sets `agentURI` to IPFS-pinned registration JSON, publishes ENS records).
  4. Deploy consolidation Safe (1/1 owned by the dev's EOA). Display API key + downloadable `.env`.
- **`/dashboard`** — payments table, reputation summary (via `agent0-ts.getReputationSummary`), per-payment "publicly confirm" toggle, withdraw button.
- **`/pay/[ens]`** — sender-side demo console:
  - Input: ENS name (`alice.gabhru.eth`), amount.
  - Behind the scenes: resolves `addr(node, 2147492101)` via viem's `getEnsAddress({ coinType: 2147492101 })`, this hits our CCIP-Read gateway, returns a fresh stealth address.
  - Calls USDC.transfer + `Announcer.announce(1, stealthAddr, ephemeralPubKey, metadata)` on Base.

### 5.6 SDK — `@gabhru/private-pay`

Wraps `agent0-ts.SDK` with a thin extension. Public surface:

```ts
import { SDK } from 'agent0-ts'
import { withPrivatePay, type PrivateAgent } from '@gabhru/private-pay'

const baseSdk = new SDK({
  chainId: 8453,
  rpcUrl: process.env.RPC_URL,
  signer: process.env.PRIVATE_KEY,
})

const sdk = withPrivatePay(baseSdk, {
  serviceUrl: 'https://api.gabhru.eth', // default
  // No API key — SDK uses the same signer as agent0-ts to authenticate
  // against IdentityRegistry.ownerOf(agentId) or getAgentWallet(agentId).
})

// Load an existing agent registered through the web wizard
const agent: PrivateAgent = await sdk.loadPrivateAgent(agentId)

// Subscribe to incoming private payments (WebSocket under the hood)
agent.onPayment(async (payment) => {
  // payment = { stealthAddress, amount, sender, txHash, timestamp, requestHash? }
  await doTheWork(payment.sender, payment.amount)
})

// Issue an EIP-712 signed receipt to a client (so they can submit reputation feedback with stronger proof)
const receipt = await agent.signReceipt({
  client: '0xabc...',
  amount: 10_000_000n, // 10 USDC
  requestHash: keccak256(toUtf8Bytes('translate-doc-12345')),
})
// returns { receipt, signature } — JSON-encodable, ready to embed in the client's feedbackURI

// Sweep stealth balances to the consolidation Safe
const tx = await agent.withdraw({ to: agent.treasurySafe, amount: 'all' })
```

Internally, `agent.signReceipt` either signs locally with the agent owner's key (if SDK was initialized with one) or POSTs to the backend (which then has the dev's EOA via the dashboard signing service — out of scope for v1; v1 requires the SDK to have a signer).

---

## 6. Core flows

### 6.1 Onboarding (one-time, ~90 seconds)

1. Dev visits `gabhru.eth` (or our marketing URL), clicks Connect Wallet. Coinbase Smart Wallet recommended (gasless onboarding via Base paymaster); MetaMask + EOA supported (~$0.01 in raw gas on Base).
2. SIWE auth.
3. Wizard step 1: name. e.g., `mybot`. Available? → reserve in DB.
4. Wizard step 2: client-side keygen.
   - `viewPrivKey` and `spendPrivKey` generated via WebCrypto.
   - Compute `viewPubKey` and `spendPubKey`.
   - User chooses a local passphrase. Encrypt `spendPrivKey` with PBKDF2(passphrase) + AES-GCM, save to localStorage.
   - Send `viewPrivKey` to backend over TLS. Backend encrypts with KMS data key, stores.
5. Wizard step 3: registration. Backend pins a registration JSON to IPFS with:
   ```json
   {
     "type": "agent",
     "name": "mybot",
     "description": "<dev-supplied>",
     "image": "<dev-supplied or default>",
     "services": [
       { "name": "ENS", "endpoint": "mybot.gabhru.eth", "version": "v1" },
       { "name": "stealth", "endpoint": "stealth-meta:0x<66 bytes hex>", "version": "erc5564-1" }
     ],
     "x402Support": false,
     "active": true,
     "registrations": [{ "agentRegistry": "eip155:8453:0x8004A169...", "agentId": "<after-mint>" }]
   }
   ```
   Dev signs `IdentityRegistry.register(agentURI)` via `agent0-ts.registerIPFS()`. Returns `agentId`.
   Backend writes the `agent-registration[...]`, `agent-context`, `agent-endpoint[*]`, and `stealth-meta` records into our resolver's data store (so subsequent CCIP-Read queries return them).
6. Wizard step 4: deploy a 1/1 Safe owned by the dev's EOA via Safe Protocol Kit. Persist Safe address as `treasurySafe`.
7. **Generate the agent wallet hot key** (fresh EOA, client-side). Build the `setAgentWallet(agentId, hotKey, deadline, hotKeySig)` call: hot key signs the EIP-712 authorization, owner wallet signs the tx. One sponsored user-op. After confirmation, the chain says: `getAgentWallet(1865) == 0xHot…`.
8. Display setup-complete screen with downloadable `.env`:
   ```
   AGENT_ID=8453:1865
   RPC_URL=https://mainnet.base.org
   PRIVATEPAY_SERVICE_URL=https://api.gabhru.eth
   AGENT_WALLET_PRIVATE_KEY=0x...   # delegated hot key, rotatable
   SPEND_PRIVATE_KEY=0x...           # optional, only for sweep-from-code
   ```
   We do not retain plaintext copies of the agent wallet or spend keys. The dashboard offers re-download (decrypt-with-passphrase) for the spend key only; the agent wallet key, if lost, is rotated by signing a new `setAgentWallet` from the owner wallet.

### 6.2 Receive payment

1. Sender (any wallet on Base) types `mybot.gabhru.eth` and an amount in USDC.
2. Wallet (or our `/pay/[ens]` page) resolves: viem's `getEnsAddress({ name: 'mybot.gabhru.eth', coinType: 2147492101 })` → CCIP-Read kicks in → mainnet `OurOffchainResolver` → `OffchainLookup` → our gateway → derives `stealthEOA` then `stealthSafe` via CREATE2, returns **`stealthSafe` address** `0xS`.
3. Sender's wallet:
   - Sends USDC to `0xS` on Base. (Safe is not yet deployed; funds sit at the address, fully recoverable.)
   - Calls `Announcer.announce(1, 0xS, ephemeralPubKey, metadata)` where `metadata[0] = viewTag`.
4. Our scanner picks up the `Announcement` event, decrypts via the agent's view key, matches to `mybot`, persists payment with `stealthSafe = 0xS` and `stealthEOA = derived signer`, pushes WebSocket event.
5. Agent's running SDK receives the WebSocket event, fires `onPayment(callback)`.
6. (Later) Agent calls `agent.withdraw({ asset: 'USDC', amount: 'all' })`. SDK iterates each unspent stealth Safe, batches `(deploy + Safe.execTransfer to treasurySafe)` user-ops, signs as the `stealthEOA` (derived locally from `spendPrivKey + ECDH(viewPriv, ephemeralPub)`), submits via paymaster-sponsored bundler. Net out-of-pocket gas: $0.

### 6.3 Reputation

- **Default (private):** sender calls `sdk.giveFeedback(agentId, value, ...)`. The off-chain feedbackURI omits `proofOfPayment` entirely. On-chain feedback record exists (value, tags), but no payment trail leaks.
- **Opt-in linkable (agent's choice):** agent dev clicks "publicly confirm" on a payment in the dashboard. We:
  1. Build an EIP-712 message: `{ agentId, agentRegistry, clientAddress, amount, currency, timestamp, requestHash, nonce }`.
  2. Dev signs via wallet.
  3. We call `ReputationRegistry.appendResponse(agentId, clientAddress, feedbackIndex, responseURI, responseHash)`. The `responseURI` points to a JSON file containing the signed receipt.
- **Verifiability:** any reader can recover the signer of the receipt and verify it equals `IdentityRegistry.ownerOf(agentId)` at the receipt's timestamp.
- **Privacy slider:** the agent decides per payment whether to confirm. Most payments stay private; landmark ones get public confirmations to build verifiable reputation.

---

## 7. Demo plan

### Demo α — "Pay any agent privately" (the wow moment)

- Pre-set: `demobot.gabhru.eth` registered, dashboard at zero payments.
- Live: judge opens `/pay/demobot.gabhru.eth`, sends 5 USDC.
- Dashboard pings within ~5s, shows incoming payment.
- Switch to Basescan: search `demobot.gabhru.eth` → no payment trail; the agent's main wallet shows no incoming USDC; the stealth address is fresh and orphan.
- Punchline: "the agent received the payment, the network knows, but no one can tell *whose* agent received it from public data alone."

### Demo β — "Build a private agent in 90 seconds" (the DX story)

- Live: judge clicks Connect, runs through the wizard. End state: a working `judge.gabhru.eth` agent.
- Switch to terminal, paste 4 lines of code:
  ```ts
  const agent = await sdk.loadPrivateAgent(agentId)
  agent.onPayment(p => console.log(`got paid ${p.amount} USDC by ${p.sender}`))
  ```
- Run α against the new agent: judge sees their own `console.log` fire.

Both demos run end-to-end on Base mainnet with real USDC.

---

## 8. APIs

### 8.1 Resolver gateway (CCIP-Read, public)

- `POST /resolve` — body: ERC-3668 `(sender, data)` per ENS gateway protocol. Returns ERC-3668 signed response.

### 8.2 REST (dashboard, SIWE-authed)

- `POST /api/auth/siwe/nonce`, `POST /api/auth/siwe/verify` — SIWE handshake.
- `POST /api/agents` — body: `{ name, description, image, viewPrivKeyEncrypted, spendPubKey, viewPubKey }`. Reserves subname, persists.
- `POST /api/agents/:id/register-onchain` — accepts the txHash from the dev's signed `register()` call; backend confirms and updates DB.
- `POST /api/agents/:id/treasury` — body: `{ safeAddress }`; persists.
- `GET /api/agents/me/payments` — list of payments.
- `POST /api/agents/me/withdraw` — drafts a tx for the dev to sign.
- `POST /api/agents/me/receipts/:paymentId/confirm` — drafts EIP-712 receipt, returns hash to sign; on signature, calls `appendResponse`.

### 8.3 SDK (wallet-authed via JWT)

- `POST /api/sdk/challenge` — body: `{ agentId }`. Returns `{ nonce, message, expiresAt }`. The message includes `agentId`, nonce, domain, expiry, in a SIWE-like format.
- `POST /api/sdk/session` — body: `{ agentId, message, signature }`. Backend recovers signer, checks `signer === ownerOf(agentId) || signer === getAgentWallet(agentId)` on `IdentityRegistry`. Returns `{ jwt, expiresAt }` (24h TTL).
- `GET /api/sdk/me` — `Authorization: Bearer <jwt>`. Returns agent config.
- `WS /ws/sdk` — connect with `Authorization: Bearer <jwt>` header (or `?token=<jwt>` for browsers). Server pushes `{ type: 'payment', payload }` events.
- `POST /api/sdk/sign-receipt` — fallback for SDK without local signer; out of scope v1.

### 8.4 SDK runtime API (TypeScript)

See §5.6.

---

## 9. Data model (Postgres)

```
agents (
  id uuid pk,
  owner_address text not null,
  agent_id text,                   -- 8004 chainId:agentId, e.g. "8453:42"
  ens_subname text unique not null,-- e.g. "mybot"
  spend_pubkey bytea not null,     -- 33 bytes compressed
  view_pubkey bytea not null,      -- 33 bytes compressed
  view_privkey_encrypted bytea not null,
  view_privkey_kms_keyid text not null,
  treasury_safe_address text,
  created_at timestamptz,
  updated_at timestamptz
)
-- No api_keys table. SDK auth is wallet-based: backend issues short-lived
-- JWTs after verifying a signature against IdentityRegistry.ownerOf(agentId)
-- or getAgentWallet(agentId). JWT signing key rotates independently.

payments (
  id uuid pk,
  agent_id uuid fk,
  announcement_block bigint,
  announcement_log_index int,
  stealth_safe_address text,       -- the CREATE2 Safe address (recipient)
  stealth_eoa_address text,        -- the derived EOA that will sign sweeps
  ephemeral_pubkey bytea,
  view_tag smallint,
  asset text,                      -- 'USDC'
  amount numeric(78, 0),
  sender_address text,
  tx_hash text,
  swept boolean default false,     -- has the agent withdrawn this payment?
  swept_tx_hash text,
  detected_at timestamptz,
  unique(announcement_block, announcement_log_index)
)

receipts (
  id uuid pk,
  payment_id uuid fk,
  agent_id uuid fk,
  client_address text,
  amount numeric(78, 0),
  request_hash text,
  nonce text,
  signature text,
  appended_response_tx text,       -- null until on-chain confirm
  created_at timestamptz
)
```

---

## 10. Risks and open issues

- **Wrapped ENS name on `gabhru.eth`.** If `gabhru.eth` is wrapped in the ENS Name Wrapper, `setResolver` may need to go through the wrapper. Verify before deployment.
- **Wallet support for ENSIP-11 multicoin on Base.** Verified for MetaMask, Coinbase Wallet, Rabby. Older or hardware-wallet flows may default to coinType 60 only. We mitigate by returning the same stealth address on coinType 60 and 2147492101.
- **CCIP-Read latency.** Each name resolution = one offchain HTTP roundtrip. Aim for p95 < 200ms gateway. Caching is unsafe (we want fresh addresses), so just optimize.
- **Scanner cost on Base.** ERC-5564 Announcer event volume on Base may be non-trivial. Index efficiently, use viem's `watchContractEvent` with checkpointing.
- **Receipt forgery within agent owner's authority.** A malicious agent owner can sign receipts they didn't earn. This degrades reputation trust. Mitigation: receipts include `clientAddress`, and the reputation registry binds `clientAddress` to `msg.sender` of `giveFeedback`. So an owner can only forge receipts for clients who actually called `giveFeedback`.
- **Custodial view-key risk.** v1 stores view keys encrypted but custodially. We can see all incoming payments. Document this prominently. Roadmap to hybrid in v2.
- **Reputation `proofOfPayment` extension.** ERC-8004 spec defines `proofOfPayment` as `{fromAddress, toAddress, chainId, txHash}`. We replace it with our `signedReceipt` field in the off-chain feedback file. Spec says off-chain file is extensible; this is compatible. We submit a minor ERC-8004 comment thread proposing `signedReceipt` as a standard extension after the hackathon.

---

## 11. Roadmap (post-v1)

1. **Hybrid scanner / view-key sovereignty.** Backend filters announcements by `viewTag` only; full decrypt happens in the agent's SDK process. View keys never leave the agent.
2. **ZK proof of payment for verifiable private reputation.** Sender publishes a Noir/SP1 proof of `"I paid agentX ≥ V USDC at some announcement in [block range]"` without revealing which announcement.
3. **BYO ENS.** Allow devs with their own ENS names to point a subdomain or the apex at our resolver.
4. **Multi-chain.** Optimism, Arbitrum. Per-chain stealth derivation already supported via ENSIP-11 coinTypes.
5. **x402 layering.** Issue stealth addresses as the `payTo` field of x402 challenges.
6. **Other framework SDKs.** Eliza, LangChain, MCP server template.
7. **TEE attestation integration.** Agents running in TEEs can prove honest scanning + receipt issuance — strengthens reputation.
8. **Subscription / recurring payments.** Streaming payment patterns (Sablier-style) over stealth addresses.

---

## 12. References

- [EIP-8004: Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004)
- [EIP-5564: Stealth Addresses](https://eips.ethereum.org/EIPS/eip-5564)
- [EIP-3668: CCIP-Read](https://eips.ethereum.org/EIPS/eip-3668)
- [ENSIP-10: Wildcard Resolution](https://docs.ens.domains/ensip/10)
- [ENSIP-11: Multichain Address Resolution](https://docs.ens.domains/ensip/11)
- [ENSIP-25: Verifiable Agent Identity](https://docs.ens.domains/ensip/25/)
- [ENSIP-26: ENS Native AI Identity (draft)](https://discuss.ens.domains/t/ensip-26-ens-native-ai-identity/21968)
- [agent0-ts](https://github.com/agent0lab/agent0-ts) and [agent0-py](https://github.com/agent0lab/agent0-py)
- [ERC-8004 contracts repo](https://github.com/erc-8004/erc-8004-contracts)
- [ScopeLift stealth-address-sdk](https://github.com/ScopeLift/stealth-address-sdk)
- [Fluidkey stealth-account-kit (audited reference)](https://github.com/fluidkey/fluidkey-stealth-account-kit)
- [ENS offchain-resolver](https://github.com/ensdomains/offchain-resolver)
- [Fluidkey: Private ENS Transactions](https://ens.domains/blog/post/private-transactions-with-fluidkey)
- [Base agent registration docs](https://docs.base.org/ai-agents/setup/agent-registration)
- [siwe npm package](https://www.npmjs.com/package/siwe)
