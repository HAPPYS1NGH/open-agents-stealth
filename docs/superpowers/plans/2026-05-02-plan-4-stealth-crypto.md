# Plan 4 — Stealth Crypto + Gateway Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Plan 3's `deriveViewKeyStub` with the real ERC-5564 / ENSIP-26 stealth derivation end-to-end. The dashboard pulls in `fluidkey-stealth-account-kit` and, from a single owner-EOA signature on the fixed `STEALTH_DERIVATION_MESSAGE`, produces `(spendPrivKey, viewPrivKey, stealthMetaAddress)`. The spend private key never leaves the browser. The view private key is encrypted (AES-256-GCM with a server-side master key) and persisted in `agents.view_key_encrypted`. The stealth meta-address is published as the `stealth-meta` ENSIP-26 text record. The gateway becomes the trusted party that produces a **fresh stealth address per CCIP-Read query** by ECDH-ing a per-call ephemeral keypair against the agent's stealth meta-address; every stealth address it returns is also written to a new `gateway_announcements` table so the Plan 5 scanner can rescan and the dashboard can surface them.

**Architecture:** A new shared library — `packages/crypto` — owns the encryption layer (`encryptViewKey` / `decryptViewKey`) and the stealth helpers shared between the dashboard and the gateway. The dashboard imports `packages/crypto` for the wizard step 2 derivation; the gateway imports it for per-query stealth address generation. The api gains a thin `POST /agents/:id/view-key` endpoint that accepts the **plaintext view privkey from the browser** over TLS, encrypts it with `VIEW_KEY_MASTER_KEY` server-side, and writes the ciphertext (this is simpler than fetching the master key into the browser — see decision matrix below). Gateway calls remain unchanged at the public surface (still `GET /resolve/:sender/:data`), but `findGatewayAgent()` now returns the agent's stealth meta-address (read from `text_records['stealth-meta']`) instead of `baseAddr`, and the resolve route generates a fresh ephemeral keypair, derives the per-call stealth address with `@noble/secp256k1` plus the audited Fluidkey kit math, fires-and-forgets a row insert into `gateway_announcements`, and returns the stealth address to the CCIP-Read client. Plan 3's `stub:` rows are flagged at `/me` time and the dev is asked to re-onboard the affected agents (no in-place migration — the spend privkey was never derived in Plan 3).

**Tech Stack:** TypeScript 5.x strict, `fluidkey-stealth-account-kit` ^1.1.0 (Dedaub-audited; depends on `@noble/curves`, `viem`), `@noble/secp256k1` 2.x (for the gateway-side ephemeral keypair generation; the kit's `generateEphemeralPrivateKey` re-exports this internally but we want the raw helper for the per-query path), Node's built-in `node:crypto` for AES-256-GCM, `vitest` for unit tests, the existing wagmi 2.x / viem 2.x stack on the dashboard side. No new on-chain contracts. No KMS service — the master key is a 32-byte hex env var (`VIEW_KEY_MASTER_KEY`) injected into the api and the optional dashboard build (the dashboard does not touch the master key — see §"Inline decisions" below).

---

## File structure

After Plan 4, the repo gains:

```
open-agents/
├── packages/
│   └── crypto/                                        # NEW shared crypto package
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts
│       │   ├── view-key-cipher.ts                     # AES-256-GCM encrypt/decrypt
│       │   ├── stealth-derivation.ts                  # Fluidkey wrapper: signature → keys
│       │   ├── stealth-meta.ts                        # Pack/unpack 132-hex meta-address
│       │   ├── stealth-per-query.ts                   # Gateway-side fresh stealth address
│       │   └── master-key.ts                          # Master-key parsing + version tag
│       └── tests/
│           ├── view-key-cipher.test.ts
│           ├── stealth-derivation.test.ts
│           ├── stealth-meta.test.ts
│           └── stealth-per-query.test.ts
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── env.ts                                 # MODIFIED: + VIEW_KEY_MASTER_KEY
│   │   │   ├── lib/
│   │   │   │   └── view-key-store.ts                  # NEW: thin wrapper around packages/crypto
│   │   │   └── routes/
│   │   │       ├── agents.ts                          # MODIFIED: + POST /agents/:id/view-key
│   │   │       └── me.ts                              # MODIFIED: surface stub-flag + meta-address
│   │   └── tests/
│   │       └── view-key.test.ts                       # NEW
│   ├── gateway/
│   │   ├── src/
│   │   │   ├── env.ts                                 # MODIFIED: + GATEWAY_ANNOUNCEMENTS=on|off
│   │   │   ├── lib/
│   │   │   │   ├── agents-repo.ts                     # MODIFIED: returns stealthMeta, not baseAddr
│   │   │   │   └── announcements-repo.ts              # NEW: fire-and-forget insert
│   │   │   └── routes/
│   │   │       └── resolve.ts                         # MODIFIED: per-query stealth derivation
│   │   └── tests/
│   │       ├── resolve.test.ts                        # MODIFIED: assert fresh-per-call addr
│   │       └── announcements-repo.test.ts             # NEW
│   └── dashboard/
│       ├── package.json                               # MODIFIED: + fluidkey-stealth-account-kit
│       ├── src/
│       │   ├── lib/
│       │   │   ├── stealth-stub.ts                    # MODIFIED: re-exports from packages/crypto
│       │   │   └── stealth-derive-client.ts           # NEW: thin browser wrapper
│       │   └── app/
│       │       └── onboard/
│       │           └── _steps/
│       │               └── step-2-viewkey.tsx        # REPLACED: real derivation
│       └── tests/
│           ├── stealth-derive-client.test.ts          # NEW
│           └── stealth-stub.test.ts                   # MODIFIED: deprecation suite
├── packages/db/
│   ├── src/
│   │   ├── schema.ts                                  # MODIFIED: + gateway_announcements table
│   │   └── queries/
│   │       └── announcements.ts                       # NEW
│   └── migrations/
│       └── 0001_stealth_announcements.sql             # NEW
└── scripts/
    └── flag-stub-agents.mjs                           # NEW one-shot migration helper
```

---

## Prerequisites

The engineer must have available:

- pnpm 9+ installed
- Plans 1, 2, and 3 complete and committed (gateway resolves from Postgres, api accepts SIWE, dashboard wizard runs end-to-end with the Plan 3 stub).
- Local Postgres running (`docker compose -f docker-compose.dev.yml up -d`) with the Plan 3 schema applied.
- A 32-byte hex string for `VIEW_KEY_MASTER_KEY`. Generate locally with:
  ```bash
  node -e "console.log('0x' + require('crypto').randomBytes(32).toString('hex'))"
  ```
- The `gabhru.eth` ENS records writable from the same wallet that controls the resolver — Plan 4 does not touch ENS itself; it only writes the `stealth-meta` text record into our backend store, where the gateway serves it.
- `BASE_RPC_URL` (already defined for Plans 2/3) — Plan 4 does not call Base, but the env keeps parity with the api.
- Node 20+ (Plan 3 already requires it).
- An ENSIP-26 reference handy for the `stealth-meta` record format (66 raw bytes = 132 hex characters, prefix `0x`, concatenation of compressed `spendPubKey` || compressed `viewPubKey`).

---

### Task 1: Scaffold `packages/crypto`

**Files:**
- Create: `packages/crypto/package.json`
- Create: `packages/crypto/tsconfig.json`
- Create: `packages/crypto/src/index.ts`
- Create: `packages/crypto/vitest.config.ts`

The shared crypto package owns four concerns: (1) AES-256-GCM view-key encryption used by the api, (2) the Fluidkey-derived `(spendPrivKey, viewPrivKey, metaAddress)` triple used by the dashboard, (3) the per-query stealth-address generator used by the gateway, (4) parsing of the meta-address text record. Putting these in one package avoids divergent helpers between dashboard and gateway, and lets us write isolated unit tests without booting any service.

- [ ] **Step 1.1: Create `packages/crypto/package.json`**

```json
{
  "name": "@open-agents/crypto",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "lint": "echo 'no-op'"
  },
  "dependencies": {
    "@noble/curves": "^1.6.0",
    "@noble/hashes": "^1.5.0",
    "fluidkey-stealth-account-kit": "^1.1.0",
    "viem": "^2.21.41"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 1.2: Create `packages/crypto/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 1.3: Create `packages/crypto/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
```

- [ ] **Step 1.4: Create `packages/crypto/src/index.ts`**

```ts
export * from './view-key-cipher.js'
export * from './stealth-derivation.js'
export * from './stealth-meta.js'
export * from './stealth-per-query.js'
export * from './master-key.js'
```

- [ ] **Step 1.5: Verify the workspace picks up the package**

```bash
cd /path/to/open-agents
pnpm -r ls --depth -1 | grep '@open-agents/crypto'
```

Expected: line `@open-agents/crypto 0.1.0` appears once. If pnpm reports the package as missing, ensure the root `pnpm-workspace.yaml` lists `packages/*` (it does in Plans 1-3).

- [ ] **Step 1.6: Commit**

```bash
git add packages/crypto/package.json packages/crypto/tsconfig.json \
  packages/crypto/src/index.ts packages/crypto/vitest.config.ts
git commit -m "$(cat <<'EOF'
feat(crypto): scaffold @open-agents/crypto package

Empty barrel that re-exports view-key-cipher, stealth-derivation,
stealth-meta, stealth-per-query, and master-key. Subsequent tasks fill
each module. Depends on fluidkey-stealth-account-kit (Dedaub-audited),
@noble/curves, and viem; no node:crypto dep yet (added with the cipher
module in Task 2).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: View-key cipher (AES-256-GCM with master-key versioning)

**Files:**
- Create: `packages/crypto/src/master-key.ts`
- Create: `packages/crypto/src/view-key-cipher.ts`
- Create: `packages/crypto/tests/view-key-cipher.test.ts`

We pick **AES-256-GCM via Node's built-in `node:crypto`** rather than libsodium secretbox. Justification: AES-256-GCM is FIPS-approved, ships in every Node 20+ runtime with zero native deps, has constant-time tag verification, and is what every cloud KMS speaks natively if we later promote `VIEW_KEY_MASTER_KEY` to a managed KMS key. libsodium would require an extra C dep and gives us nothing here (we don't need streaming or deniable encryption).

The ciphertext format is a small self-describing JSON envelope so we can rotate master keys later without forcing a re-derivation:

```
ciphertext_blob = "v1:" || base64(JSON({ kid, iv, tag, ct }))
```

- `kid` — key id derived from the first 4 bytes of `sha256(masterKey)`. Lets us tell at decrypt-time which master key encrypted a given row. Solo-dev mode has one `kid`; rotation later adds a second `kid` and we keep the lookup map.
- `iv` — 12 random bytes, base64-encoded. Mandatory for GCM, never reused.
- `tag` — 16-byte GCM auth tag, base64.
- `ct` — base64 ciphertext.

Rotation story (documented now, not implemented this plan): adding `VIEW_KEY_MASTER_KEY_NEXT` to the env causes the api to encrypt new rows with the new key while still being able to decrypt existing rows under the old key (looked up by `kid`). A one-shot script re-encrypts each row in place. None of this is built in Plan 4 — we just keep the format ready.

- [ ] **Step 2.1: Write the failing test**

Create `packages/crypto/tests/view-key-cipher.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  encryptViewKey,
  decryptViewKey,
  parseEnvelope,
  isCiphertextEnvelope,
} from '../src/view-key-cipher.js'
import { parseMasterKey } from '../src/master-key.js'

const MK = '0x' + 'aa'.repeat(32)
const masterKey = parseMasterKey(MK)
const VIEW_KEY = '0x' + 'cd'.repeat(32) // 32-byte secp256k1 priv

describe('encryptViewKey / decryptViewKey round trip', () => {
  it('decrypts to the same plaintext', () => {
    const ct = encryptViewKey(VIEW_KEY, masterKey)
    const pt = decryptViewKey(ct, masterKey)
    expect(pt).toBe(VIEW_KEY)
  })

  it('produces a different ciphertext on each call (random IV)', () => {
    const a = encryptViewKey(VIEW_KEY, masterKey)
    const b = encryptViewKey(VIEW_KEY, masterKey)
    expect(a).not.toBe(b)
  })

  it('starts with the v1: prefix', () => {
    const ct = encryptViewKey(VIEW_KEY, masterKey)
    expect(ct.startsWith('v1:')).toBe(true)
  })

  it('decrypt fails with a wrong master key', () => {
    const ct = encryptViewKey(VIEW_KEY, masterKey)
    const wrong = parseMasterKey('0x' + 'bb'.repeat(32))
    expect(() => decryptViewKey(ct, wrong)).toThrow()
  })

  it('decrypt fails on tampered ciphertext (auth tag rejects)', () => {
    const ct = encryptViewKey(VIEW_KEY, masterKey)
    const env = parseEnvelope(ct)
    const tampered = { ...env, ct: env.ct.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) }
    const tamperedBlob = `v1:${Buffer.from(JSON.stringify(tampered)).toString('base64')}`
    expect(() => decryptViewKey(tamperedBlob, masterKey)).toThrow()
  })
})

describe('isCiphertextEnvelope', () => {
  it('returns true for a real envelope', () => {
    const ct = encryptViewKey(VIEW_KEY, masterKey)
    expect(isCiphertextEnvelope(ct)).toBe(true)
  })

  it('returns false for the Plan 3 stub prefix', () => {
    expect(isCiphertextEnvelope('stub:0xdeadbeef')).toBe(false)
  })

  it('returns false for empty / null / non-string', () => {
    expect(isCiphertextEnvelope('')).toBe(false)
    // @ts-expect-error testing runtime behaviour for null
    expect(isCiphertextEnvelope(null)).toBe(false)
  })
})
```

- [ ] **Step 2.2: Create `packages/crypto/src/master-key.ts`**

```ts
import { createHash } from 'node:crypto'

/**
 * A parsed master key: 32 raw bytes plus a 4-byte `kid` (key id) derived from
 * sha256(rawBytes).slice(0, 4). The kid lets ciphertext rows declare which
 * key they were encrypted under, so multi-key rotation works.
 */
export interface MasterKey {
  rawBytes: Buffer       // 32 bytes
  kid: string            // 8-hex chars, e.g. "a1b2c3d4"
}

/**
 * Parses a 0x-prefixed 32-byte hex string into a MasterKey.
 * Throws on malformed input. Used by the api at boot time.
 */
export function parseMasterKey(hex: string): MasterKey {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('parseMasterKey: expected a 0x-prefixed 32-byte hex string')
  }
  const rawBytes = Buffer.from(hex.slice(2), 'hex')
  if (rawBytes.length !== 32) {
    throw new Error('parseMasterKey: master key must be exactly 32 bytes')
  }
  const kid = createHash('sha256').update(rawBytes).digest('hex').slice(0, 8)
  return { rawBytes, kid }
}
```

- [ ] **Step 2.3: Create `packages/crypto/src/view-key-cipher.ts`**

```ts
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import type { MasterKey } from './master-key.js'

/**
 * On-the-wire shape of a v1 ciphertext envelope. Stored as
 * `v1:<base64(JSON(envelope))>` in agents.view_key_encrypted.
 */
export interface CiphertextEnvelope {
  v: 1
  kid: string   // master-key id (8 hex chars)
  iv: string    // 12 bytes, base64
  tag: string   // 16 bytes, base64
  ct: string    // ciphertext, base64
}

const PREFIX = 'v1:'
const ALGORITHM = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

/**
 * Encrypts a 0x-prefixed view private key (or any string secret) with the
 * supplied master key. Returns a `v1:`-prefixed ciphertext envelope.
 *
 * The ciphertext is non-deterministic: each call generates a fresh 96-bit IV.
 * GCM auth tag verification means tampered envelopes fail to decrypt.
 */
export function encryptViewKey(plaintext: string, masterKey: MasterKey): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encryptViewKey: plaintext must be a non-empty string')
  }
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGORITHM, masterKey.rawBytes, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  if (tag.length !== TAG_LEN) {
    throw new Error('encryptViewKey: unexpected auth tag length')
  }
  const env: CiphertextEnvelope = {
    v: 1,
    kid: masterKey.kid,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
  }
  return PREFIX + Buffer.from(JSON.stringify(env)).toString('base64')
}

/**
 * Decrypts a v1 ciphertext envelope. Throws on:
 *   - missing v1: prefix
 *   - kid mismatch with the supplied master key
 *   - failed GCM auth tag (tampered ciphertext)
 */
export function decryptViewKey(blob: string, masterKey: MasterKey): string {
  const env = parseEnvelope(blob)
  if (env.kid !== masterKey.kid) {
    throw new Error(`decryptViewKey: kid mismatch (envelope=${env.kid}, master=${masterKey.kid})`)
  }
  const iv = Buffer.from(env.iv, 'base64')
  const tag = Buffer.from(env.tag, 'base64')
  const ct = Buffer.from(env.ct, 'base64')
  if (iv.length !== IV_LEN) throw new Error('decryptViewKey: bad iv length')
  if (tag.length !== TAG_LEN) throw new Error('decryptViewKey: bad tag length')
  const decipher = createDecipheriv(ALGORITHM, masterKey.rawBytes, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString('utf8')
}

/**
 * Parses a `v1:`-prefixed base64 envelope. Exported for test fixtures + the
 * Plan 5 scanner, which wants to inspect `kid` without decrypting.
 */
export function parseEnvelope(blob: string): CiphertextEnvelope {
  if (typeof blob !== 'string' || !blob.startsWith(PREFIX)) {
    throw new Error('parseEnvelope: missing v1: prefix')
  }
  const json = Buffer.from(blob.slice(PREFIX.length), 'base64').toString('utf8')
  const env = JSON.parse(json) as CiphertextEnvelope
  if (env.v !== 1) throw new Error(`parseEnvelope: unsupported version ${env.v}`)
  return env
}

/**
 * Cheap, side-effect-free predicate. Used by api routes to distinguish
 * Plan 3 `stub:` rows from real Plan 4 ciphertext.
 */
export function isCiphertextEnvelope(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX)
}
```

- [ ] **Step 2.4: Run the test suite**

```bash
cd packages/crypto
pnpm test
```

Expected: 8 tests pass (5 round-trip + 3 envelope predicate). If `parseMasterKey` rejects, double-check the test's `MK` string is exactly 64 hex chars.

- [ ] **Step 2.5: Commit**

```bash
cd ../..
git add packages/crypto/src/master-key.ts packages/crypto/src/view-key-cipher.ts \
  packages/crypto/tests/view-key-cipher.test.ts
git commit -m "$(cat <<'EOF'
feat(crypto): AES-256-GCM view-key cipher with kid-tagged envelope

encryptViewKey/decryptViewKey use node:crypto AES-256-GCM with a fresh
12-byte IV per call. Ciphertext is wrapped as v1:<base64(JSON{kid,iv,tag,ct})>
where kid = sha256(masterKey).slice(0,4); this lets us rotate master keys
later without breaking older rows. parseMasterKey accepts a 0x-prefixed
32-byte hex string and computes the kid up-front.

isCiphertextEnvelope is a cheap predicate so api routes can tell Plan 3
stub: rows apart from Plan 4 ciphertext.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Stealth key derivation (signature → spend/view privs + meta-address)

**Files:**
- Create: `packages/crypto/src/stealth-derivation.ts`
- Create: `packages/crypto/src/stealth-meta.ts`
- Create: `packages/crypto/tests/stealth-derivation.test.ts`
- Create: `packages/crypto/tests/stealth-meta.test.ts`

This is the spec's §4.2 derivation: a single owner-EOA signature over `STEALTH_DERIVATION_MESSAGE` is fed to `fluidkey-stealth-account-kit.generateKeysFromSignature` to produce `(spendPrivKey, viewPrivKey)`. The public halves are computed via `@noble/curves/secp256k1.getPublicKey(_, true)` (compressed). The 132-hex stealth meta-address is the concatenation per ENSIP-26.

The same fixed `STEALTH_DERIVATION_MESSAGE` constant from Plan 3 is re-exported from this package so dashboards and any future server-side recovery tool agree on the derivation domain.

- [ ] **Step 3.1: Write the failing derivation test**

Create `packages/crypto/tests/stealth-derivation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { sign } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import {
  STEALTH_DERIVATION_MESSAGE,
  deriveStealthKeysFromSignature,
} from '../src/stealth-derivation.js'

// We forge a deterministic 65-byte EIP-191 signature for testing purposes by
// signing the EIP-191 hash of STEALTH_DERIVATION_MESSAGE with a known priv.
// The Fluidkey kit treats the signature as opaque entropy — actual on-chain
// signature recovery is not required.
const TEST_PRIV = '0x' + '11'.repeat(32)

function eip191Hash(message: string): Uint8Array {
  const prefix = `\x19Ethereum Signed Message:\n${message.length}`
  const bytes = new TextEncoder().encode(prefix + message)
  return keccak_256(bytes)
}

function fakeSignature(priv: string, message: string): `0x${string}` {
  const sig = sign(eip191Hash(message), priv.slice(2))
  // 64 bytes r||s + 1 byte v (recoveryId + 27)
  const r = sig.r.toString(16).padStart(64, '0')
  const s = sig.s.toString(16).padStart(64, '0')
  const v = (27 + (sig.recovery ?? 0)).toString(16).padStart(2, '0')
  return `0x${r}${s}${v}` as `0x${string}`
}

describe('STEALTH_DERIVATION_MESSAGE', () => {
  it('matches the Plan 3 string verbatim', () => {
    expect(STEALTH_DERIVATION_MESSAGE).toBe(
      'gabhru.eth: derive stealth keys for agent on Base mainnet (v1)',
    )
  })
})

describe('deriveStealthKeysFromSignature', () => {
  it('produces well-formed 32-byte priv keys and 33-byte compressed pubs', () => {
    const sig = fakeSignature(TEST_PRIV, STEALTH_DERIVATION_MESSAGE)
    const out = deriveStealthKeysFromSignature(sig)
    expect(out.spendPrivKey).toMatch(/^0x[0-9a-f]{64}$/)
    expect(out.viewPrivKey).toMatch(/^0x[0-9a-f]{64}$/)
    expect(out.spendPubKey).toMatch(/^0x[0-9a-f]{66}$/)
    expect(out.viewPubKey).toMatch(/^0x[0-9a-f]{66}$/)
    expect(out.stealthMetaAddress).toMatch(/^0x[0-9a-f]{132}$/)
  })

  it('is deterministic — same signature → same triple', () => {
    const sig = fakeSignature(TEST_PRIV, STEALTH_DERIVATION_MESSAGE)
    const a = deriveStealthKeysFromSignature(sig)
    const b = deriveStealthKeysFromSignature(sig)
    expect(a.spendPrivKey).toBe(b.spendPrivKey)
    expect(a.viewPrivKey).toBe(b.viewPrivKey)
    expect(a.stealthMetaAddress).toBe(b.stealthMetaAddress)
  })

  it('is signature-sensitive — different signatures → different triples', () => {
    const sigA = fakeSignature(TEST_PRIV, STEALTH_DERIVATION_MESSAGE)
    const sigB = fakeSignature('0x' + '22'.repeat(32), STEALTH_DERIVATION_MESSAGE)
    const a = deriveStealthKeysFromSignature(sigA)
    const b = deriveStealthKeysFromSignature(sigB)
    expect(a.spendPrivKey).not.toBe(b.spendPrivKey)
    expect(a.viewPrivKey).not.toBe(b.viewPrivKey)
    expect(a.stealthMetaAddress).not.toBe(b.stealthMetaAddress)
  })

  it('throws on a non-hex signature', () => {
    expect(() => deriveStealthKeysFromSignature('not-hex' as `0x${string}`)).toThrow()
  })

  it('throws on a too-short signature', () => {
    expect(() =>
      deriveStealthKeysFromSignature('0xdeadbeef' as `0x${string}`),
    ).toThrow()
  })

  it('the meta-address is exactly spendPub || viewPub (compressed)', () => {
    const sig = fakeSignature(TEST_PRIV, STEALTH_DERIVATION_MESSAGE)
    const out = deriveStealthKeysFromSignature(sig)
    const concat = (out.spendPubKey.slice(2) + out.viewPubKey.slice(2)).toLowerCase()
    expect(out.stealthMetaAddress.slice(2).toLowerCase()).toBe(concat)
  })
})
```

- [ ] **Step 3.2: Write the failing meta-address test**

Create `packages/crypto/tests/stealth-meta.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  isStealthMetaAddress,
  splitMetaAddress,
  buildMetaAddress,
} from '../src/stealth-meta.js'

const SPEND_PUB = '0x02' + 'aa'.repeat(32)
const VIEW_PUB = '0x03' + 'bb'.repeat(32)
const META = '0x' + SPEND_PUB.slice(2) + VIEW_PUB.slice(2)

describe('isStealthMetaAddress', () => {
  it('accepts 132-hex addresses', () => {
    expect(isStealthMetaAddress(META)).toBe(true)
  })

  it('rejects wrong-length hex', () => {
    expect(isStealthMetaAddress('0x' + 'aa'.repeat(33))).toBe(false)
  })

  it('rejects missing 0x prefix', () => {
    expect(isStealthMetaAddress(META.slice(2))).toBe(false)
  })

  it('rejects non-hex characters', () => {
    expect(isStealthMetaAddress('0x' + 'ZZ'.repeat(66))).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isStealthMetaAddress('')).toBe(false)
  })
})

describe('splitMetaAddress', () => {
  it('returns spend + view halves with 33-byte compressed prefix preserved', () => {
    const out = splitMetaAddress(META)
    expect(out.spendPubKey).toBe(SPEND_PUB)
    expect(out.viewPubKey).toBe(VIEW_PUB)
  })

  it('throws on a malformed meta-address', () => {
    expect(() => splitMetaAddress('0xdeadbeef')).toThrow()
  })
})

describe('buildMetaAddress', () => {
  it('round-trips with splitMetaAddress', () => {
    const built = buildMetaAddress(SPEND_PUB, VIEW_PUB)
    expect(built).toBe(META)
    expect(splitMetaAddress(built)).toEqual({
      spendPubKey: SPEND_PUB,
      viewPubKey: VIEW_PUB,
    })
  })

  it('rejects non-33-byte pubkeys', () => {
    expect(() => buildMetaAddress('0xaa', VIEW_PUB)).toThrow()
    expect(() => buildMetaAddress(SPEND_PUB, '0xbb')).toThrow()
  })
})
```

- [ ] **Step 3.3: Run the tests to verify they fail**

```bash
cd packages/crypto
pnpm test
```

Expected: FAIL — `stealth-derivation.ts` and `stealth-meta.ts` do not exist.

- [ ] **Step 3.4: Create `packages/crypto/src/stealth-meta.ts`**

```ts
import type { Hex } from 'viem'

/**
 * Per ENSIP-26, the stealth-meta record is 66 raw bytes (132 hex chars):
 * the compressed (33-byte) spend pubkey followed by the compressed view pubkey.
 * Both pubkeys keep their 0x02/0x03 SEC1 prefix byte.
 */
const META_HEX_LEN = 2 + 132
const PUB_HEX_LEN = 2 + 66

/**
 * Strict format check: 0x-prefixed, exactly 132 lowercase hex chars after the
 * prefix. Used by the gateway before attempting derivation.
 */
export function isStealthMetaAddress(value: unknown): value is Hex {
  return (
    typeof value === 'string' &&
    value.length === META_HEX_LEN &&
    /^0x[0-9a-fA-F]{132}$/.test(value)
  )
}

/**
 * Splits a meta-address into its spend and view compressed pubkeys.
 * Throws on malformed input.
 */
export function splitMetaAddress(meta: string): {
  spendPubKey: Hex
  viewPubKey: Hex
} {
  if (!isStealthMetaAddress(meta)) {
    throw new Error('splitMetaAddress: not a 132-hex stealth meta-address')
  }
  const spendPubKey = `0x${meta.slice(2, 2 + 66)}` as Hex
  const viewPubKey = `0x${meta.slice(2 + 66)}` as Hex
  return { spendPubKey, viewPubKey }
}

/**
 * Builds a 132-hex meta-address from two 33-byte compressed pubkeys.
 * Throws if either pubkey is the wrong length or non-hex.
 */
export function buildMetaAddress(spendPubKey: string, viewPubKey: string): Hex {
  if (
    typeof spendPubKey !== 'string' ||
    spendPubKey.length !== PUB_HEX_LEN ||
    !/^0x[0-9a-fA-F]{66}$/.test(spendPubKey)
  ) {
    throw new Error('buildMetaAddress: spendPubKey must be 33 compressed bytes')
  }
  if (
    typeof viewPubKey !== 'string' ||
    viewPubKey.length !== PUB_HEX_LEN ||
    !/^0x[0-9a-fA-F]{66}$/.test(viewPubKey)
  ) {
    throw new Error('buildMetaAddress: viewPubKey must be 33 compressed bytes')
  }
  return (`0x${spendPubKey.slice(2)}${viewPubKey.slice(2)}` as Hex)
}
```

- [ ] **Step 3.5: Create `packages/crypto/src/stealth-derivation.ts`**

```ts
import { generateKeysFromSignature } from 'fluidkey-stealth-account-kit'
import { secp256k1 } from '@noble/curves/secp256k1'
import { bytesToHex } from 'viem'
import type { Hex } from 'viem'
import { buildMetaAddress } from './stealth-meta.js'

/**
 * Fixed, domain-separated message that the wizard asks the owner EOA to sign
 * before deriving stealth keys. MUST stay byte-identical to the Plan 3 string
 * — re-running the wizard with Plan 4 should regenerate keys for an existing
 * agent without forcing the user to choose a new derivation domain.
 */
export const STEALTH_DERIVATION_MESSAGE =
  'gabhru.eth: derive stealth keys for agent on Base mainnet (v1)'

export interface DerivedStealthKeys {
  /** 0x-prefixed 32-byte spend private key. NEVER leaves the browser. */
  spendPrivKey: Hex
  /** 0x-prefixed 32-byte view private key. Encrypted before persistence. */
  viewPrivKey: Hex
  /** 0x-prefixed 33-byte compressed secp256k1 spend public key. */
  spendPubKey: Hex
  /** 0x-prefixed 33-byte compressed secp256k1 view public key. */
  viewPubKey: Hex
  /** 0x-prefixed 132-hex ENSIP-26 stealth-meta record value. */
  stealthMetaAddress: Hex
}

/**
 * Deterministically derives the agent's stealth key pair and meta-address
 * from a single EIP-191 signature over STEALTH_DERIVATION_MESSAGE.
 *
 * Wraps fluidkey-stealth-account-kit's audited generateKeysFromSignature
 * (Dedaub-reviewed; deployed in Fluidkey production) to produce the two 32-byte
 * private keys, then computes compressed pubkeys with @noble/curves and
 * concatenates per ENSIP-26.
 *
 * Same EOA + same message → same triple (built-in recovery: lose your .env,
 * re-open the wizard, re-sign, get the same keys back).
 */
export function deriveStealthKeysFromSignature(
  signature: `0x${string}`,
): DerivedStealthKeys {
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new Error('deriveStealthKeysFromSignature: signature must be 0x-prefixed hex')
  }
  // Fluidkey's kit expects a 65-byte (130 hex chars + 0x) compact signature.
  if (signature.length !== 2 + 130) {
    throw new Error(
      `deriveStealthKeysFromSignature: signature must be 65 bytes (got ${(signature.length - 2) / 2})`,
    )
  }

  const { spendingPrivateKey, viewingPrivateKey } = generateKeysFromSignature(signature)

  const spendPrivKey = (
    spendingPrivateKey.startsWith('0x') ? spendingPrivateKey : `0x${spendingPrivateKey}`
  ) as Hex
  const viewPrivKey = (
    viewingPrivateKey.startsWith('0x') ? viewingPrivateKey : `0x${viewingPrivateKey}`
  ) as Hex

  const spendPubBytes = secp256k1.getPublicKey(spendPrivKey.slice(2), true)
  const viewPubBytes = secp256k1.getPublicKey(viewPrivKey.slice(2), true)
  const spendPubKey = bytesToHex(spendPubBytes) as Hex
  const viewPubKey = bytesToHex(viewPubBytes) as Hex

  const stealthMetaAddress = buildMetaAddress(spendPubKey, viewPubKey)

  return { spendPrivKey, viewPrivKey, spendPubKey, viewPubKey, stealthMetaAddress }
}
```

- [ ] **Step 3.6: Run the tests to verify they pass**

```bash
pnpm test
```

Expected: `stealth-meta.test.ts` 9 passing; `stealth-derivation.test.ts` 6 passing.

- [ ] **Step 3.7: Commit**

```bash
cd ../..
git add packages/crypto/src/stealth-derivation.ts packages/crypto/src/stealth-meta.ts \
  packages/crypto/tests/stealth-derivation.test.ts \
  packages/crypto/tests/stealth-meta.test.ts
git commit -m "$(cat <<'EOF'
feat(crypto): stealth key derivation + meta-address helpers

deriveStealthKeysFromSignature wraps fluidkey-stealth-account-kit's
audited generateKeysFromSignature, then computes compressed secp256k1
pubkeys via @noble/curves to assemble the 132-hex ENSIP-26 stealth-meta
address. STEALTH_DERIVATION_MESSAGE is re-exported so it stays byte-
identical to Plan 3's stub message — the wizard will re-derive in place.

Tests cover well-formedness, determinism, signature-sensitivity, and the
explicit invariant that meta = spendPub || viewPub (compressed).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Per-query stealth address generator (gateway-side ECDH)

**Files:**
- Create: `packages/crypto/src/stealth-per-query.ts`
- Create: `packages/crypto/tests/stealth-per-query.test.ts`

This is the spec's §5.1 derivation that runs once per `addr()` lookup on the gateway. Given the agent's published `stealthMetaAddress` (132 hex), the gateway:

1. Generates a fresh ephemeral keypair `(r, R)` where `r` is a random 32-byte secp256k1 priv and `R = r·G` is the compressed 33-byte ephemeral pubkey.
2. Computes the shared secret `s = r·viewPubKey` via `secp256k1.getSharedSecret`.
3. Hashes the shared secret with keccak256 (the Fluidkey/scopelift convention) to derive the child scalar.
4. Computes the stealth EOA pubkey = `spendPubKey + childScalar·G` (point addition on secp256k1).
5. Computes the stealth EOA address = last 20 bytes of `keccak256(uncompressed pub minus the SEC1 prefix byte)`.
6. Computes the 1-byte view tag = first byte of the keccak hash.

For Plan 4 we return the **stealth EOA address** as the `addr()` answer (not a CREATE2 Safe address). The spec §4.2 calls for a Safe address, but the Safe predict step pulls in the Safe Protocol Kit's CREATE2 helpers and a deployment fixture — that's Plan 5's scope (sweep flow). Returning the EOA address keeps the gateway pure ECDH-and-add, which is what the off-the-shelf Fluidkey sender flow expects when no Safe deployment is wired yet. The DB row records the EOA so Plan 5 can compute the Safe later from `(stealthEOA, ephemeralPub)`.

We use `@noble/curves/secp256k1` directly rather than `fluidkey-stealth-account-kit`'s server helpers because (a) the kit's helpers are EVM-context-bound (they want `viem` chain configs) and we want a pure function, and (b) `@noble/curves` is already a transitive dep of the kit — no new install. This is the same library Fluidkey itself uses internally, so the math is byte-compatible.

- [ ] **Step 4.1: Write the failing test**

Create `packages/crypto/tests/stealth-per-query.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { secp256k1 } from '@noble/curves/secp256k1'
import { bytesToHex, isAddress } from 'viem'
import { deriveStealthForQuery } from '../src/stealth-per-query.js'
import { buildMetaAddress } from '../src/stealth-meta.js'

const SPEND_PRIV = '0x' + '11'.repeat(32)
const VIEW_PRIV = '0x' + '22'.repeat(32)
const SPEND_PUB = bytesToHex(secp256k1.getPublicKey(SPEND_PRIV.slice(2), true))
const VIEW_PUB = bytesToHex(secp256k1.getPublicKey(VIEW_PRIV.slice(2), true))
const META = buildMetaAddress(SPEND_PUB, VIEW_PUB)

describe('deriveStealthForQuery', () => {
  it('returns a 20-byte EVM address, a 33-byte ephemeral pubkey, and a view tag byte', () => {
    const out = deriveStealthForQuery(META)
    expect(isAddress(out.stealthAddress)).toBe(true)
    expect(out.ephemeralPubKey).toMatch(/^0x[0-9a-f]{66}$/)
    expect(out.viewTag).toBeGreaterThanOrEqual(0)
    expect(out.viewTag).toBeLessThanOrEqual(255)
  })

  it('returns a different stealth address on each call (fresh ephemeral key)', () => {
    const a = deriveStealthForQuery(META)
    const b = deriveStealthForQuery(META)
    expect(a.stealthAddress).not.toBe(b.stealthAddress)
    expect(a.ephemeralPubKey).not.toBe(b.ephemeralPubKey)
  })

  it('throws on a malformed meta-address', () => {
    expect(() => deriveStealthForQuery('0xdeadbeef')).toThrow()
    expect(() => deriveStealthForQuery('not-hex')).toThrow()
  })

  it('is deterministic when given an explicit ephemeral key (used by tests)', () => {
    const ephPriv = '0x' + 'cd'.repeat(32)
    const a = deriveStealthForQuery(META, { ephemeralPrivKeyOverride: ephPriv })
    const b = deriveStealthForQuery(META, { ephemeralPrivKeyOverride: ephPriv })
    expect(a.stealthAddress).toBe(b.stealthAddress)
    expect(a.ephemeralPubKey).toBe(b.ephemeralPubKey)
    expect(a.viewTag).toBe(b.viewTag)
  })

  it('is reversible by the receiver: viewPriv·ephemeralPub recovers the same scalar', () => {
    const ephPriv = '0x' + 'ee'.repeat(32)
    const out = deriveStealthForQuery(META, { ephemeralPrivKeyOverride: ephPriv })

    // Receiver-side: shared secret from view priv + ephemeral pub
    const sharedFromReceiver = secp256k1.getSharedSecret(
      VIEW_PRIV.slice(2),
      out.ephemeralPubKey.slice(2),
      true,
    )
    // Same shared secret bytes (33-byte compressed). Drop the prefix byte.
    const sharedSenderHex = secp256k1.getSharedSecret(
      ephPriv.slice(2),
      VIEW_PUB.slice(2),
      true,
    )
    expect(bytesToHex(sharedFromReceiver).toLowerCase()).toBe(
      bytesToHex(sharedSenderHex).toLowerCase(),
    )
  })
})
```

- [ ] **Step 4.2: Run the test to verify it fails**

```bash
cd packages/crypto
pnpm test
```

Expected: FAIL — `stealth-per-query.ts` does not exist.

- [ ] **Step 4.3: Create `packages/crypto/src/stealth-per-query.ts`**

```ts
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { bytesToHex, getAddress } from 'viem'
import type { Address, Hex } from 'viem'
import { isStealthMetaAddress, splitMetaAddress } from './stealth-meta.js'

export interface PerQueryStealth {
  /** Checksummed 20-byte stealth EOA address. The gateway returns this as the addr() answer. */
  stealthAddress: Address
  /** 33-byte compressed ephemeral pubkey R = r·G. Persisted so the receiver can scan. */
  ephemeralPubKey: Hex
  /** First byte of keccak(s); receivers use this as a cheap pre-filter before full ECDH. */
  viewTag: number
}

export interface DeriveStealthOptions {
  /**
   * Override the ephemeral private key. Used ONLY by tests for reproducibility.
   * Production callers must omit this so a fresh CSPRNG key is generated per call.
   */
  ephemeralPrivKeyOverride?: `0x${string}`
}

/**
 * Generates a fresh ERC-5564 stealth address for a single CCIP-Read query.
 *
 * Steps (all on secp256k1):
 *   1. r = random 32-byte priv (or override for tests).
 *   2. R = r·G (compressed) — the ephemeralPubKey.
 *   3. s = r·viewPub (compressed shared secret, 33 bytes incl. prefix).
 *   4. h = keccak256(s without the SEC1 prefix byte).
 *   5. childPub = spendPub + h·G   (point addition on secp256k1).
 *   6. stealthAddress = last 20 bytes of keccak256(childPub uncompressed without 0x04 prefix).
 *   7. viewTag = h[0].
 *
 * The receiver, holding viewPriv, recomputes s = viewPriv·R, then h = keccak256(s),
 * and is expected to find a matching stealth address. The viewTag lets the
 * scanner skip 255/256 announcements without doing a full ECDH each.
 */
export function deriveStealthForQuery(
  metaAddress: string,
  options: DeriveStealthOptions = {},
): PerQueryStealth {
  if (!isStealthMetaAddress(metaAddress)) {
    throw new Error('deriveStealthForQuery: not a 132-hex stealth meta-address')
  }
  const { spendPubKey, viewPubKey } = splitMetaAddress(metaAddress)

  const ephPrivBytes = options.ephemeralPrivKeyOverride
    ? hexToBytes32(options.ephemeralPrivKeyOverride)
    : secp256k1.utils.randomPrivateKey()
  if (ephPrivBytes.length !== 32) {
    throw new Error('deriveStealthForQuery: ephemeral priv must be 32 bytes')
  }

  // Compressed 33-byte ephemeral pubkey R = r·G.
  const ephPubBytes = secp256k1.getPublicKey(ephPrivBytes, true)
  const ephemeralPubKey = bytesToHex(ephPubBytes) as Hex

  // Compressed 33-byte shared secret s = r·viewPub. Strip the 1-byte SEC1 prefix.
  const sharedCompressed = secp256k1.getSharedSecret(
    ephPrivBytes,
    viewPubKey.slice(2),
    true,
  )
  const sharedXOnly = sharedCompressed.slice(1) // 32 bytes
  const h = keccak_256(sharedXOnly)
  const viewTag = h[0]!

  // childPub (uncompressed point) = spendPub + h·G
  const spendPoint = secp256k1.ProjectivePoint.fromHex(spendPubKey.slice(2))
  const hScalar = bytesToBigInt(h) % secp256k1.CURVE.n
  if (hScalar === 0n) {
    throw new Error('deriveStealthForQuery: degenerate scalar (h mod n == 0); retry')
  }
  const hPoint = secp256k1.ProjectivePoint.BASE.multiply(hScalar)
  const childPoint = spendPoint.add(hPoint)
  const childPubBytes = childPoint.toRawBytes(false) // 65 bytes: 0x04 || X || Y

  // EVM address = last 20 of keccak256(X || Y).
  const childPubXY = childPubBytes.slice(1) // strip 0x04 prefix
  const addrBytes = keccak_256(childPubXY).slice(-20)
  const stealthAddress = getAddress(`0x${Buffer.from(addrBytes).toString('hex')}`)

  return { stealthAddress, ephemeralPubKey, viewTag }
}

function hexToBytes32(hex: `0x${string}`): Uint8Array {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('hexToBytes32: expected 0x-prefixed 32-byte hex')
  }
  return Uint8Array.from(Buffer.from(hex.slice(2), 'hex'))
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  return n
}
```

- [ ] **Step 4.4: Run the tests to verify they pass**

```bash
pnpm test
```

Expected: 5 new tests pass; previous 23 still pass.

- [ ] **Step 4.5: Commit**

```bash
cd ../..
git add packages/crypto/src/stealth-per-query.ts \
  packages/crypto/tests/stealth-per-query.test.ts
git commit -m "$(cat <<'EOF'
feat(crypto): per-query stealth address generator for the gateway

deriveStealthForQuery generates a fresh ephemeral keypair, ECDHs it
against the agent's view pubkey, hashes with keccak256, derives the
child secp256k1 point, and hashes again to an EVM address. Returns
{ stealthAddress, ephemeralPubKey, viewTag } — exactly what the gateway
needs to answer addr() and what the Plan 5 scanner needs as the off-chain
announcement. Tests assert freshness across calls, reversibility from
the receiver side, and a deterministic override path for fixtures.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Add `gateway_announcements` table and queries

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/queries/announcements.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/migrations/0001_stealth_announcements.sql`
- Create: `packages/db/tests/announcements.test.ts`

`gateway_announcements` records every stealth address the gateway hands out, plus the ephemeral pubkey and view tag, so:

- The Plan 5 scanner can pre-filter and ECDH-decrypt without re-running the gateway.
- The dashboard can show a "view recent stealth issuances for this agent" tile (Plan 5 surface; Plan 4 just lays the table down).
- Operators can audit how many addresses the gateway issues per agent.

We pick a uniqueness key of `(agent_id, ephemeral_pub)` so accidental duplicates are caught — the ephemeral pubkey is fresh per call, so collisions are vanishingly unlikely.

- [ ] **Step 5.1: Modify `packages/db/src/schema.ts`**

Append to the existing file (do not remove the `agents` table):

```ts
import { integer, index, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * gateway_announcements — one row per stealth address the gateway hands out.
 *
 * agent_id        FK (uuid) into agents.id. NOT the on-chain ERC-8004 agentId.
 * stealth_address Checksummed 0x… 20-byte EVM address. The CCIP-Read response
 *                 the gateway returned to the resolver client.
 * ephemeral_pub   33-byte compressed secp256k1 pubkey R = r·G. The receiver
 *                 (Plan 5 scanner) needs this to recompute the shared secret.
 * view_tag        First byte of keccak256(sharedSecret). Used by the scanner
 *                 to skip 255/256 unrelated announcements with a cheap compare.
 * generated_at    Timestamptz the gateway wrote the row. Used to expire stale
 *                 entries (e.g. older than 14 days, after which any pending
 *                 payments will have either landed or been abandoned).
 */
export const gatewayAnnouncements = pgTable(
  'gateway_announcements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    stealthAddress: text('stealth_address').notNull(),
    ephemeralPub: text('ephemeral_pub').notNull(),
    viewTag: integer('view_tag').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    byAgent: index('gateway_announcements_agent_idx').on(table.agentId, table.generatedAt),
    uniqueEph: uniqueIndex('gateway_announcements_agent_eph_unq').on(
      table.agentId,
      table.ephemeralPub,
    ),
  }),
)

export type GatewayAnnouncement = typeof gatewayAnnouncements.$inferSelect
export type NewGatewayAnnouncement = typeof gatewayAnnouncements.$inferInsert
```

- [ ] **Step 5.2: Create `packages/db/src/queries/announcements.ts`**

```ts
import { desc, eq, lt } from 'drizzle-orm'
import type { DbClient } from '../client.js'
import {
  gatewayAnnouncements,
  type GatewayAnnouncement,
  type NewGatewayAnnouncement,
} from '../schema.js'

/**
 * Inserts a single gateway announcement row. The gateway calls this in a
 * fire-and-forget Promise so the CCIP-Read response is not delayed by Postgres.
 *
 * The (agent_id, ephemeral_pub) unique index protects against double-write
 * (extremely rare given a CSPRNG ephemeral key, but cheap to enforce).
 * Returns the inserted row, or rethrows on unique violation so callers can
 * decide to swallow it.
 */
export async function insertGatewayAnnouncement(
  db: DbClient,
  data: Omit<NewGatewayAnnouncement, 'id' | 'generatedAt'>,
): Promise<GatewayAnnouncement> {
  const [row] = await db
    .insert(gatewayAnnouncements)
    .values(data)
    .returning()
  if (!row) throw new Error('insertGatewayAnnouncement: no row returned')
  return row
}

/**
 * Returns recent announcements for a given agent, newest first. Used by the
 * dashboard's "issuance audit" tile (Plan 5) and the scanner (Plan 5) for
 * its initial backfill.
 */
export async function listAnnouncementsByAgent(
  db: DbClient,
  agentRowId: string,
  limit = 50,
): Promise<GatewayAnnouncement[]> {
  return db
    .select()
    .from(gatewayAnnouncements)
    .where(eq(gatewayAnnouncements.agentId, agentRowId))
    .orderBy(desc(gatewayAnnouncements.generatedAt))
    .limit(limit)
}

/**
 * Deletes announcements older than `cutoff`. Run as a daily cron to keep
 * the table bounded; in v1 we only target announcements > 14 days old.
 */
export async function deleteAnnouncementsOlderThan(
  db: DbClient,
  cutoff: Date,
): Promise<number> {
  const rows = await db
    .delete(gatewayAnnouncements)
    .where(lt(gatewayAnnouncements.generatedAt, cutoff))
    .returning({ id: gatewayAnnouncements.id })
  return rows.length
}
```

- [ ] **Step 5.3: Re-export from `packages/db/src/index.ts`**

```ts
export * from './client.js'
export * from './schema.js'
export * from './queries/agents.js'
export * from './queries/announcements.js'
```

- [ ] **Step 5.4: Create the migration `packages/db/migrations/0001_stealth_announcements.sql`**

```sql
CREATE TABLE IF NOT EXISTS "gateway_announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"stealth_address" text NOT NULL,
	"ephemeral_pub" text NOT NULL,
	"view_tag" integer NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_announcements_agent_id_agents_id_fk"
		FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id")
		ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "gateway_announcements_agent_idx"
	ON "gateway_announcements" ("agent_id", "generated_at");

CREATE UNIQUE INDEX IF NOT EXISTS "gateway_announcements_agent_eph_unq"
	ON "gateway_announcements" ("agent_id", "ephemeral_pub");
```

- [ ] **Step 5.5: Apply the migration**

```bash
cd packages/db
pnpm db:migrate
```

Expected: drizzle-kit reports `0001_stealth_announcements` applied. Confirm via psql:

```bash
docker exec -it $(docker compose -f ../../docker-compose.dev.yml ps -q postgres) \
  psql -U open_agents -d open_agents -c "\d gateway_announcements"
```

Expected: 6 columns + the FK + the two indexes.

- [ ] **Step 5.6: Write the queries test**

Create `packages/db/tests/announcements.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createDb,
  insertAgent,
  insertGatewayAnnouncement,
  listAnnouncementsByAgent,
  deleteAnnouncementsOlderThan,
} from '../src/index.js'

const DB_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
let db: ReturnType<typeof createDb>
let agentRowId: string

beforeAll(async () => {
  db = createDb(DB_URL)
  const agent = await insertAgent(db, {
    ownerEoa: '0x0000000000000000000000000000000000000099',
    subnameLabel: 'announce-test-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
  })
  agentRowId = agent.id
})

afterAll(async () => {
  await deleteAnnouncementsOlderThan(db, new Date(Date.now() + 1000 * 60 * 60))
})

describe('gateway_announcements queries', () => {
  it('inserts and lists', async () => {
    await insertGatewayAnnouncement(db, {
      agentId: agentRowId,
      stealthAddress: '0x' + 'aa'.repeat(20),
      ephemeralPub: '0x02' + '11'.repeat(32),
      viewTag: 0x42,
    })
    await insertGatewayAnnouncement(db, {
      agentId: agentRowId,
      stealthAddress: '0x' + 'bb'.repeat(20),
      ephemeralPub: '0x03' + '22'.repeat(32),
      viewTag: 0x99,
    })

    const rows = await listAnnouncementsByAgent(db, agentRowId, 10)
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows[0]!.viewTag).toBeTypeOf('number')
    expect(rows[0]!.stealthAddress).toMatch(/^0x[0-9a-f]{40}$/)
  })

  it('rejects duplicate (agent, ephemeral_pub)', async () => {
    const dup = '0x02' + 'ee'.repeat(32)
    await insertGatewayAnnouncement(db, {
      agentId: agentRowId,
      stealthAddress: '0x' + 'cc'.repeat(20),
      ephemeralPub: dup,
      viewTag: 0x01,
    })
    await expect(
      insertGatewayAnnouncement(db, {
        agentId: agentRowId,
        stealthAddress: '0x' + 'dd'.repeat(20),
        ephemeralPub: dup,
        viewTag: 0x02,
      }),
    ).rejects.toThrow()
  })

  it('deletes by cutoff', async () => {
    const before = new Date(Date.now() + 1000 * 60 * 60)
    const removed = await deleteAnnouncementsOlderThan(db, before)
    expect(removed).toBeGreaterThanOrEqual(2)
    const rows = await listAnnouncementsByAgent(db, agentRowId, 10)
    expect(rows.length).toBe(0)
  })
})
```

- [ ] **Step 5.7: Run the test**

```bash
pnpm --filter @open-agents/db test
```

Expected: 3 announcements tests pass. Existing agent-row tests still pass.

- [ ] **Step 5.8: Commit**

```bash
cd ../..
git add packages/db/src/schema.ts packages/db/src/queries/announcements.ts \
  packages/db/src/index.ts packages/db/migrations/0001_stealth_announcements.sql \
  packages/db/tests/announcements.test.ts
git commit -m "$(cat <<'EOF'
feat(db): gateway_announcements table for off-chain stealth log

One row per stealth address the gateway hands out, keyed
(agent_id, ephemeral_pub) with a unique index. Indexed by
(agent_id, generated_at) for the dashboard issuance tile and the Plan 5
scanner backfill. CASCADE on agent deletion. Migration 0001 lives next
to 0000_brainy_inhumans.sql.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Gateway — surface stealth meta + write announcements repo

**Files:**
- Modify: `apps/gateway/package.json` (add `@open-agents/crypto` workspace dep)
- Modify: `apps/gateway/src/env.ts` (add `GATEWAY_ANNOUNCEMENTS` toggle)
- Modify: `apps/gateway/src/lib/agents-repo.ts` (return `stealthMeta` + agent row id)
- Create: `apps/gateway/src/lib/announcements-repo.ts`
- Create: `apps/gateway/tests/announcements-repo.test.ts`

The gateway can't compute stealth addresses for an agent that has not yet published its `stealth-meta` record. Plan 3's stub rows have `text_records['stealth-meta']` empty, and `findGatewayAgent()` currently returns `baseAddr` regardless. We change the repo so its result type forces the resolve route to handle the "no meta-address yet" case explicitly: if `stealthMeta` is null, the route falls back to returning `baseAddr` (Plan 3 behaviour) and skips the announcement write; if `stealthMeta` is set, the route runs the per-query derivation.

The announcements repo is a thin one-call wrapper that returns `void` so the resolve route can `void` it (fire-and-forget) without typescript complaining about an unhandled Promise. Errors are logged but never thrown — the gateway must keep replying to the CCIP-Read client even if Postgres is briefly unavailable.

- [ ] **Step 6.1: Add `@open-agents/crypto` to `apps/gateway/package.json`**

Modify `apps/gateway/package.json`. Add to `dependencies`:

```json
{
  "dependencies": {
    "@hono/node-server": "^1.13.7",
    "@open-agents/crypto": "workspace:*",
    "@open-agents/db": "workspace:*",
    "hono": "^4.6.9",
    "viem": "^2.21.41",
    "zod": "^3.23.8"
  }
}
```

- [ ] **Step 6.2: Modify `apps/gateway/src/env.ts`**

Replace the file contents with:

```ts
import { z } from 'zod'

const emptyAsUndefined = (v: unknown) => (v === '' ? undefined : v)

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  GATEWAY_SIGNER_PRIVATE_KEY: z.string().startsWith('0x').length(66),
  RESOLVER_ADDRESS: z.preprocess(
    emptyAsUndefined,
    z.string().startsWith('0x').length(42).optional(),
  ),
  DATABASE_URL: z.string().url(),
  /**
   * If "off", the gateway does not write rows to gateway_announcements.
   * Default "on" in production, "off" in unit tests that don't seed agents.
   */
  GATEWAY_ANNOUNCEMENTS: z
    .preprocess(emptyAsUndefined, z.enum(['on', 'off']).optional())
    .transform((v) => v ?? 'on'),
})

export const env = envSchema.parse(process.env)
```

- [ ] **Step 6.3: Modify `apps/gateway/src/lib/agents-repo.ts`**

Replace the file contents with:

```ts
import { createDb, findAgentByLabel } from '@open-agents/db'
import type { Address, Hex } from 'viem'
import { env } from '../env.js'

/**
 * The shape the gateway route expects for an agent lookup result.
 *
 * - `id` is the agents.id UUID (used as foreign key for gateway_announcements).
 * - `baseAddr` is the legacy fallback returned for addr() when stealthMeta is
 *   null (Plan 3 stub agents). Plan 5 scanner ignores baseAddr-only agents.
 * - `stealthMeta` is the 132-hex stealth meta-address the agent published in
 *   text_records['stealth-meta']. When set, the route runs per-query derivation.
 */
export interface GatewayAgent {
  id: string
  label: string
  baseAddr: Address
  stealthMeta: Hex | null
  textRecords: Record<string, string>
}

let _db: ReturnType<typeof createDb> | null = null
function getDb() {
  if (!_db) _db = createDb(env.DATABASE_URL)
  return _db
}

export function getGatewayDb() {
  return getDb()
}

/**
 * Looks up an active agent by its ENS subname label.
 * Returns null if no agent exists or is inactive.
 *
 * Reads text_records['stealth-meta']; the route uses it to derive a fresh
 * stealth address per call. If the field is missing or malformed, stealthMeta
 * is null and the route falls back to baseAddr (Plan 3 compatibility).
 */
export async function findGatewayAgent(label: string): Promise<GatewayAgent | null> {
  const agent = await findAgentByLabel(getDb(), label)
  if (!agent) return null
  const records = (agent.textRecords as Record<string, string>) ?? {}
  const rawMeta = records['stealth-meta']
  const stealthMeta =
    typeof rawMeta === 'string' && /^0x[0-9a-fA-F]{132}$/.test(rawMeta)
      ? (rawMeta as Hex)
      : null
  return {
    id: agent.id,
    label: agent.subnameLabel,
    baseAddr: agent.baseAddr as Address,
    stealthMeta,
    textRecords: records,
  }
}
```

- [ ] **Step 6.4: Write the announcements-repo test**

Create `apps/gateway/tests/announcements-repo.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDb, insertAgent, listAnnouncementsByAgent } from '@open-agents/db'

process.env.DATABASE_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
process.env.GATEWAY_SIGNER_PRIVATE_KEY = '0x' + '01'.repeat(32)
process.env.GATEWAY_ANNOUNCEMENTS = 'on'

let agentRowId: string

beforeAll(async () => {
  const db = createDb(process.env.DATABASE_URL!)
  const agent = await insertAgent(db, {
    ownerEoa: '0x0000000000000000000000000000000000000077',
    subnameLabel: 'announce-route-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000003',
  })
  agentRowId = agent.id
})

afterAll(() => {
  delete process.env.GATEWAY_ANNOUNCEMENTS
})

describe('recordAnnouncement', () => {
  it('writes a row and resolves void', async () => {
    const { recordAnnouncement } = await import('../src/lib/announcements-repo.js')
    await recordAnnouncement({
      agentRowId,
      stealthAddress: '0x' + 'ab'.repeat(20),
      ephemeralPub: '0x02' + 'cd'.repeat(32),
      viewTag: 5,
    })

    const db = createDb(process.env.DATABASE_URL!)
    const rows = await listAnnouncementsByAgent(db, agentRowId, 10)
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0]!.viewTag).toBe(5)
  })

  it('swallows Postgres errors so the gateway response is not blocked', async () => {
    const { recordAnnouncement } = await import('../src/lib/announcements-repo.js')
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Force a unique-violation: same (agent, ephemeralPub) twice in a row.
    const eph = '0x02' + 'ff'.repeat(32)
    await recordAnnouncement({
      agentRowId,
      stealthAddress: '0x' + '11'.repeat(20),
      ephemeralPub: eph,
      viewTag: 9,
    })
    await expect(
      recordAnnouncement({
        agentRowId,
        stealthAddress: '0x' + '22'.repeat(20),
        ephemeralPub: eph,
        viewTag: 9,
      }),
    ).resolves.toBeUndefined()

    expect(consoleErr).toHaveBeenCalled()
    consoleErr.mockRestore()
  })

  it('is a no-op when GATEWAY_ANNOUNCEMENTS=off', async () => {
    process.env.GATEWAY_ANNOUNCEMENTS = 'off'
    const fresh = await import('../src/lib/announcements-repo.js?off=1')
    await fresh.recordAnnouncement({
      agentRowId,
      stealthAddress: '0x' + '33'.repeat(20),
      ephemeralPub: '0x02' + 'aa'.repeat(32),
      viewTag: 1,
    })
    process.env.GATEWAY_ANNOUNCEMENTS = 'on'
  })
})
```

- [ ] **Step 6.5: Create `apps/gateway/src/lib/announcements-repo.ts`**

```ts
import { insertGatewayAnnouncement } from '@open-agents/db'
import { env } from '../env.js'
import { getGatewayDb } from './agents-repo.js'

export interface RecordAnnouncementInput {
  agentRowId: string
  stealthAddress: string
  ephemeralPub: string
  viewTag: number
}

/**
 * Fire-and-forget insert into gateway_announcements. ALWAYS resolves void;
 * Postgres errors are logged with console.error but never propagate, so the
 * CCIP-Read response is not blocked by transient DB hiccups.
 *
 * No-ops when env.GATEWAY_ANNOUNCEMENTS === 'off' (used by hermetic tests
 * that don't want to touch the announcements table).
 */
export async function recordAnnouncement(input: RecordAnnouncementInput): Promise<void> {
  if (env.GATEWAY_ANNOUNCEMENTS === 'off') return
  try {
    await insertGatewayAnnouncement(getGatewayDb(), {
      agentId: input.agentRowId,
      stealthAddress: input.stealthAddress,
      ephemeralPub: input.ephemeralPub,
      viewTag: input.viewTag,
    })
  } catch (err) {
    console.error('recordAnnouncement: insert failed (swallowed)', err)
  }
}
```

- [ ] **Step 6.6: Run the test**

```bash
cd apps/gateway
pnpm test
```

Expected: announcements-repo 3 tests pass. The existing `resolve.test.ts` still passes — Task 7 updates the route, so the existing addr-equals-baseAddr assertion still holds because the seed row has no `stealth-meta` text record.

- [ ] **Step 6.7: Commit**

```bash
cd ../..
git add apps/gateway/package.json apps/gateway/src/env.ts \
  apps/gateway/src/lib/agents-repo.ts apps/gateway/src/lib/announcements-repo.ts \
  apps/gateway/tests/announcements-repo.test.ts
git commit -m "$(cat <<'EOF'
feat(gateway): announcements repo + agents-repo returns stealthMeta

GatewayAgent now carries `id` (FK target) and `stealthMeta` (parsed from
text_records['stealth-meta'], null if absent or malformed). The new
recordAnnouncement helper inserts into gateway_announcements as fire-and-
forget — errors are logged, never thrown, so CCIP-Read latency stays flat
even when Postgres blips. GATEWAY_ANNOUNCEMENTS=off disables the writer
for hermetic tests; default is "on".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Gateway resolve route — per-query stealth address

**Files:**
- Modify: `apps/gateway/src/routes/resolve.ts`
- Modify: `apps/gateway/tests/resolve.test.ts`

The route now branches on `agent.stealthMeta`:

- If `stealthMeta` is set, run `deriveStealthForQuery(meta)` per call, return its `stealthAddress`, and fire-and-forget `recordAnnouncement(...)`.
- If `stealthMeta` is null, return `agent.baseAddr` like Plan 3 (so existing pre-Plan-4 agents keep resolving until the user re-onboards).

Latency budget: the per-query derivation is <2ms in microbenchmarks (`@noble/curves` is JIT-friendly), and the announcement insert is fire-and-forget. The CCIP-Read p95 budget from §10 is 200ms; this comfortably fits.

We deliberately do NOT cache stealth addresses — the whole point is freshness per call. The Vercel `Cache-Control` header on the response is left at `no-store`.

- [ ] **Step 7.1: Update the existing `apps/gateway/tests/resolve.test.ts`**

Append a new describe block at the end of `apps/gateway/tests/resolve.test.ts`:

```ts
import { secp256k1 } from '@noble/curves/secp256k1'
import { bytesToHex } from 'viem'
import { buildMetaAddress } from '@open-agents/crypto'
import { listAnnouncementsByAgent } from '@open-agents/db'

const SPEND_PRIV_T7 = '0x' + '11'.repeat(32)
const VIEW_PRIV_T7 = '0x' + '22'.repeat(32)
const SPEND_PUB_T7 = bytesToHex(secp256k1.getPublicKey(SPEND_PRIV_T7.slice(2), true))
const VIEW_PUB_T7 = bytesToHex(secp256k1.getPublicKey(VIEW_PRIV_T7.slice(2), true))
const META_T7 = buildMetaAddress(SPEND_PUB_T7, VIEW_PUB_T7)

describe('GET /resolve/:sender/:data — stealth-meta path', () => {
  let stealthAgentId: string
  let stealthLabel: string

  beforeAll(async () => {
    stealthLabel = 'stealth-' + Date.now()
    const db = createDb(DB_URL)
    const agent = await insertAgent(db, {
      ownerEoa: '0x0000000000000000000000000000000000000010',
      subnameLabel: stealthLabel,
      baseAddr: '0x0000000000000000000000000000000000000DEAD',
      textRecords: { 'stealth-meta': META_T7 },
    })
    stealthAgentId = agent.id
  })

  it('returns a different addr() answer on each call (fresh stealth address)', async () => {
    const node = namehash(`${stealthLabel}.gabhru.eth`)
    const innerData = encodeFunctionData({
      abi: parseAbi(['function addr(bytes32) view returns (address)']),
      functionName: 'addr',
      args: [node],
    })
    const { dnsEncode } = await import('../src/lib/ens-decode.js')
    const dns = `0x${Buffer.from(dnsEncode(`${stealthLabel}.gabhru.eth`)).toString('hex')}` as `0x${string}`
    const resolveCalldata = encodeFunctionData({
      abi: parseAbi(['function resolve(bytes, bytes)']),
      functionName: 'resolve',
      args: [dns, innerData],
    })
    const sender = '0x000000000000000000000000000000000000CAFE'
    const url = `http://localhost/resolve/${sender}/${resolveCalldata}.json`

    const res1 = await app.fetch(new Request(url))
    const res2 = await app.fetch(new Request(url))
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    const body1 = (await res1.json()) as { data: `0x${string}` }
    const body2 = (await res2.json()) as { data: `0x${string}` }

    const [resultBytes1] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
      body1.data,
    )
    const [resultBytes2] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
      body2.data,
    )
    const [addr1] = decodeAbiParameters([{ type: 'address' }], resultBytes1 as `0x${string}`)
    const [addr2] = decodeAbiParameters([{ type: 'address' }], resultBytes2 as `0x${string}`)

    // Fresh per call.
    expect(addr1).not.toBe(addr2)

    // Both are real EVM addresses, neither is the legacy baseAddr.
    expect((addr1 as string).toLowerCase()).not.toBe('0x0000000000000000000000000000000000000dead')
    expect((addr2 as string).toLowerCase()).not.toBe('0x0000000000000000000000000000000000000dead')
  })

  it('writes one gateway_announcements row per addr() call', async () => {
    const db = createDb(DB_URL)
    const before = await listAnnouncementsByAgent(db, stealthAgentId, 100)

    const node = namehash(`${stealthLabel}.gabhru.eth`)
    const innerData = encodeFunctionData({
      abi: parseAbi(['function addr(bytes32) view returns (address)']),
      functionName: 'addr',
      args: [node],
    })
    const { dnsEncode } = await import('../src/lib/ens-decode.js')
    const dns = `0x${Buffer.from(dnsEncode(`${stealthLabel}.gabhru.eth`)).toString('hex')}` as `0x${string}`
    const resolveCalldata = encodeFunctionData({
      abi: parseAbi(['function resolve(bytes, bytes)']),
      functionName: 'resolve',
      args: [dns, innerData],
    })
    const sender = '0x000000000000000000000000000000000000BEEF'
    const url = `http://localhost/resolve/${sender}/${resolveCalldata}.json`

    await app.fetch(new Request(url))
    // Allow the fire-and-forget Promise to settle.
    await new Promise((r) => setTimeout(r, 50))

    const after = await listAnnouncementsByAgent(db, stealthAgentId, 100)
    expect(after.length).toBe(before.length + 1)
    const newest = after[0]!
    expect(newest.viewTag).toBeGreaterThanOrEqual(0)
    expect(newest.viewTag).toBeLessThanOrEqual(255)
    expect(newest.ephemeralPub).toMatch(/^0x[0-9a-f]{66}$/)
  })

  it('text() lookups still return the stealth-meta record verbatim', async () => {
    const node = namehash(`${stealthLabel}.gabhru.eth`)
    const innerData = encodeFunctionData({
      abi: parseAbi(['function text(bytes32, string) view returns (string)']),
      functionName: 'text',
      args: [node, 'stealth-meta'],
    })
    const { dnsEncode } = await import('../src/lib/ens-decode.js')
    const dns = `0x${Buffer.from(dnsEncode(`${stealthLabel}.gabhru.eth`)).toString('hex')}` as `0x${string}`
    const resolveCalldata = encodeFunctionData({
      abi: parseAbi(['function resolve(bytes, bytes)']),
      functionName: 'resolve',
      args: [dns, innerData],
    })
    const sender = '0x0000000000000000000000000000000000000DAD'
    const url = `http://localhost/resolve/${sender}/${resolveCalldata}.json`

    const res = await app.fetch(new Request(url))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: `0x${string}` }
    const [resultBytes] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
      body.data,
    )
    const [text] = decodeAbiParameters([{ type: 'string' }], resultBytes as `0x${string}`)
    expect((text as string).toLowerCase()).toBe(META_T7.toLowerCase())
  })
})
```

(Re-uses the existing `app`, `DB_URL`, and the imports already at the top of `resolve.test.ts` — `createDb`, `insertAgent`, `namehash`, `encodeFunctionData`, `parseAbi`, `decodeAbiParameters`. Plan 3's resolve test already imports those.)

- [ ] **Step 7.2: Run the test to verify it fails**

```bash
cd apps/gateway
pnpm test
```

Expected: FAIL — current resolve route returns `agent.baseAddr` for the stealth-meta agent (the test asserts the address differs from `0x...DEAD`).

- [ ] **Step 7.3: Modify `apps/gateway/src/routes/resolve.ts`**

Replace the file contents with:

```ts
import { Hono } from 'hono'
import { decodeAbiParameters, getAddress, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { decodeDnsName } from '../lib/ens-decode.js'
import { encodeResolveResult, parseResolveData } from '../lib/ens-resolve-data.js'
import { signGatewayResponse } from '../lib/gateway-signer.js'
import { findGatewayAgent } from '../lib/agents-repo.js'
import { recordAnnouncement } from '../lib/announcements-repo.js'
import { deriveStealthForQuery } from '@open-agents/crypto'
import { env } from '../env.js'

const SIG_VALIDITY_SECONDS = 60n  // signed responses expire in 60s

const signer = privateKeyToAccount(env.GATEWAY_SIGNER_PRIVATE_KEY as Hex)

export const resolveRoute = new Hono()

resolveRoute.get('/resolve/:sender/:data', async (c) => {
  const rawSender = c.req.param('sender')
  // Vercel rewrites strip trailing extensions, but ENS clients append .json.
  const dataParam = c.req.param('data').replace(/\.json$/, '') as Hex

  const RESOLVE_SELECTOR = '0x9061b923' as const
  if (!dataParam.startsWith(RESOLVE_SELECTOR)) {
    return c.json({ message: 'expected resolve() selector' }, 400)
  }
  const inner = `0x${dataParam.slice(10)}` as Hex

  let dnsName: Hex
  let recordCalldata: Hex
  try {
    ;[dnsName, recordCalldata] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes' }],
      inner,
    ) as [Hex, Hex]
  } catch {
    return c.json({ message: 'malformed resolve() calldata' }, 400)
  }

  let labels: string[]
  try {
    labels = decodeDnsName(dnsName)
  } catch {
    return c.json({ message: 'malformed DNS-encoded name' }, 400)
  }

  if (labels.length < 3 || labels[1] !== 'gabhru' || labels[2] !== 'eth') {
    return c.json({ message: 'unsupported name tree' }, 400)
  }

  const subnameLabel = labels[0]!

  let parsed: ReturnType<typeof parseResolveData>
  try {
    parsed = parseResolveData(recordCalldata)
  } catch {
    return c.json({ message: 'unsupported inner record selector' }, 400)
  }

  const agent = await findGatewayAgent(subnameLabel)
  if (!agent) {
    return c.json({ message: `no agent for label '${subnameLabel}'` }, 404)
  }

  // Build the response value based on the record kind.
  let value: Hex | string
  if (parsed.kind === 'addr' || parsed.kind === 'addrMulticoin') {
    if (agent.stealthMeta) {
      // Plan 4 path: derive a fresh stealth address per call.
      const out = deriveStealthForQuery(agent.stealthMeta)
      value = out.stealthAddress

      // Fire-and-forget the announcement insert. recordAnnouncement is a void
      // Promise that swallows errors internally; we explicitly `void` it so
      // typescript does not complain about an unhandled Promise.
      void recordAnnouncement({
        agentRowId: agent.id,
        stealthAddress: out.stealthAddress,
        ephemeralPub: out.ephemeralPubKey,
        viewTag: out.viewTag,
      })
    } else {
      // Plan 3 fallback: agent has not yet published stealth-meta. Return
      // the legacy baseAddr so existing wallets continue to resolve.
      value = agent.baseAddr
    }
  } else if (parsed.kind === 'text') {
    value = agent.textRecords[parsed.key] ?? ''
  } else if (parsed.kind === 'contenthash') {
    value = '0x'  // not implemented in Plan 4
  } else {
    return c.json({ message: 'unsupported record' }, 400)
  }

  let target: Address
  try {
    target = getAddress(rawSender)
  } catch {
    return c.json({ message: 'invalid sender address' }, 400)
  }

  const result = encodeResolveResult(parsed, value)
  const expires = BigInt(Math.floor(Date.now() / 1000)) + SIG_VALIDITY_SECONDS

  const { encodedResponse } = await signGatewayResponse(signer, {
    target,
    expires,
    request: dataParam,
    result,
  })

  return c.json({ data: encodedResponse })
})
```

- [ ] **Step 7.4: Run the tests to verify they pass**

```bash
pnpm test
```

Expected: 3 new stealth-meta tests pass + the 4 existing resolve tests still pass (the legacy seed has no stealth-meta record, so it goes through the baseAddr branch).

- [ ] **Step 7.5: Commit**

```bash
cd ../..
git add apps/gateway/src/routes/resolve.ts apps/gateway/tests/resolve.test.ts
git commit -m "$(cat <<'EOF'
feat(gateway): per-query stealth address derivation

resolve() branches on agent.stealthMeta. When set, the route runs
deriveStealthForQuery (fresh ephemeral key, ECDH, keccak, point add) and
returns the stealth EOA address; it also fires off recordAnnouncement so
the Plan 5 scanner has the ephemeral pubkey + view tag. When stealthMeta
is null (Plan 3 stub agents that have not re-onboarded), the route falls
back to baseAddr for compatibility.

Tests assert: addr() differs across two calls for the same name; one row
lands in gateway_announcements per call; text(stealth-meta) returns the
record verbatim.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: API — `VIEW_KEY_MASTER_KEY`, view-key store, `POST /agents/:id/view-key`

**Files:**
- Modify: `apps/api/package.json` (add `@open-agents/crypto` workspace dep)
- Modify: `apps/api/src/env.ts`
- Create: `apps/api/src/lib/view-key-store.ts`
- Modify: `apps/api/src/routes/agents.ts` (add new endpoint, harden PATCH)
- Create: `apps/api/tests/view-key.test.ts`

We use the **plaintext-from-browser → server-encrypts** approach (decision recorded below). Justification:

- The dashboard already sends sensitive data over TLS (SIWE messages, signatures). Sending the 32-byte view priv over the same TLS channel adds nothing.
- The alternative (browser does the encryption) would require shipping `VIEW_KEY_MASTER_KEY` to the browser as a `NEXT_PUBLIC_*` env, defeating the point of having a server-side master key at all.
- We can encrypt the value the moment it touches our server with no log line containing the plaintext (helmet pino redaction in Plan 2 strips `viewKey` from logs).

The new endpoint is **separate** from PATCH so we can:

1. Accept the plaintext key under a tighter zod schema (32-byte hex, exactly).
2. Return the ciphertext envelope to the client for confirmation.
3. Refuse to overwrite an existing non-stub envelope unless the request supplies `?force=1` (defensive: a misconfigured wizard should not silently rotate keys).

The existing PATCH `viewKeyEncrypted` path stays — Plan 3 wrote `stub:` rows through it — but we add a server-side check that rejects any inbound `viewKeyEncrypted` value that does not start with `v1:` or `stub:` (to keep the column hygienic). This protects against future code paths that might accidentally write a half-formed value.

- [ ] **Step 8.1: Add the workspace dep**

Modify `apps/api/package.json`. Add to `dependencies`:

```json
{
  "dependencies": {
    "@open-agents/auth": "workspace:*",
    "@open-agents/crypto": "workspace:*",
    "@open-agents/db": "workspace:*",
    "@hono/node-server": "^1.13.7",
    "@hono/zod-validator": "^0.4.1",
    "hono": "^4.6.9",
    "viem": "^2.21.41",
    "zod": "^3.23.8"
  }
}
```

- [ ] **Step 8.2: Modify `apps/api/src/env.ts`**

Replace the file contents with:

```ts
import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  BASE_RPC_URL: z.string().url().default('https://mainnet.base.org'),
  IDENTITY_REGISTRY_ADDRESS: z
    .string()
    .startsWith('0x')
    .length(42)
    .default('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'),
  SIWE_DOMAIN: z.string().default('localhost'),
  /**
   * 32-byte master key (0x-prefixed hex) used by AES-256-GCM to encrypt the
   * agent's view private key at rest. Generate with:
   *   node -e "console.log('0x' + require('crypto').randomBytes(32).toString('hex'))"
   * In production this should be rotated by deploying with VIEW_KEY_MASTER_KEY_NEXT
   * set, re-encrypting all rows, then promoting NEXT to MASTER. Plan 4 does not
   * implement rotation — it just fixes the format so rotation can happen later.
   */
  VIEW_KEY_MASTER_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'VIEW_KEY_MASTER_KEY must be 0x-prefixed 32-byte hex'),
})

export const env = envSchema.parse(process.env)
```

- [ ] **Step 8.3: Create `apps/api/src/lib/view-key-store.ts`**

```ts
import {
  encryptViewKey,
  decryptViewKey,
  isCiphertextEnvelope,
  parseMasterKey,
  type MasterKey,
} from '@open-agents/crypto'
import { env } from '../env.js'

let _masterKey: MasterKey | null = null

/**
 * Lazily parses VIEW_KEY_MASTER_KEY at first use. Throws on bad format —
 * the api fails fast at boot via env.ts, so this is defensive only.
 */
function masterKey(): MasterKey {
  if (!_masterKey) _masterKey = parseMasterKey(env.VIEW_KEY_MASTER_KEY)
  return _masterKey
}

/**
 * Encrypts a 0x-prefixed 32-byte view private key with the configured
 * master key and returns the v1:<base64(JSON)> envelope.
 *
 * Used by POST /agents/:id/view-key. The api receives the plaintext over
 * TLS, immediately encrypts it, and writes only the ciphertext to Postgres.
 * Logs are scrubbed in apps/api/src/server.ts before any string containing
 * "viewKey" reaches stdout.
 */
export function encryptForStorage(viewKeyPlaintext: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(viewKeyPlaintext)) {
    throw new Error('encryptForStorage: viewKey must be 0x-prefixed 32-byte hex')
  }
  return encryptViewKey(viewKeyPlaintext, masterKey())
}

/**
 * Decrypts a stored envelope. Throws on:
 *   - not a v1: ciphertext (e.g. a Plan 3 stub: row)
 *   - kid mismatch with the current master key
 *   - failed GCM auth tag
 *
 * Plan 5's scanner is the production caller. Plan 4's API does not need to
 * decrypt — but we expose the helper so the scanner can import it.
 */
export function decryptFromStorage(ciphertext: string): string {
  if (!isCiphertextEnvelope(ciphertext)) {
    throw new Error(`decryptFromStorage: not a v1 ciphertext envelope`)
  }
  return decryptViewKey(ciphertext, masterKey())
}

/**
 * Cheap check used by api routes to short-circuit on stub rows before
 * attempting decrypt. Mirrors @open-agents/crypto's predicate for code
 * locality with the route handlers.
 */
export function isStub(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith('stub:')
}
```

- [ ] **Step 8.4: Write the failing test**

Create `apps/api/tests/view-key.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { mintJwt } from '@open-agents/auth'
import { createDb, insertAgent, findAgentById } from '@open-agents/db'

process.env['DATABASE_URL'] = 'postgres://open_agents:open_agents_dev@localhost:5432/open_agents'
process.env['JWT_SECRET'] = 'test-secret-at-least-32-characters-here-xx'
process.env['BASE_RPC_URL'] = 'http://127.0.0.1:19999'
process.env['VIEW_KEY_MASTER_KEY'] = '0x' + 'aa'.repeat(32)

const OWNER = '0x0000000000000000000000000000000000000045'
const VIEW_KEY = '0x' + 'cd'.repeat(32)

let app: { fetch: (req: Request) => Promise<Response> }
let validToken: string
let stubAgentId: string
let cleanAgentId: string

beforeAll(async () => {
  app = (await import('../src/server.js')).default
  validToken = await mintJwt({ sub: OWNER, ownerEoa: OWNER, secret: process.env['JWT_SECRET']! })

  const db = createDb(process.env['DATABASE_URL']!)
  const stubAgent = await insertAgent(db, {
    ownerEoa: OWNER,
    subnameLabel: 'view-stub-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000005',
    viewKeyEncrypted: 'stub:0xdeadbeef',
  })
  stubAgentId = stubAgent.id

  const cleanAgent = await insertAgent(db, {
    ownerEoa: OWNER,
    subnameLabel: 'view-clean-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000006',
  })
  cleanAgentId = cleanAgent.id
})

describe('POST /agents/:id/view-key', () => {
  it('encrypts and stores a v1: envelope', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${cleanAgentId}/view-key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKey: VIEW_KEY, stealthMeta: '0x' + 'aa'.repeat(33) + 'bb'.repeat(33) }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; viewKeyEncrypted: string; textRecords: Record<string, string> }
    expect(body.viewKeyEncrypted.startsWith('v1:')).toBe(true)
    expect(body.textRecords['stealth-meta']).toBe('0x' + 'aa'.repeat(33) + 'bb'.repeat(33))

    const db = createDb(process.env['DATABASE_URL']!)
    const row = await findAgentById(db, cleanAgentId)
    expect(row?.viewKeyEncrypted).toMatch(/^v1:/)
    expect(row?.textRecords['stealth-meta']).toBe('0x' + 'aa'.repeat(33) + 'bb'.repeat(33))
  })

  it('overwrites a stub: row without requiring force=1', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${stubAgentId}/view-key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKey: VIEW_KEY, stealthMeta: '0x' + '11'.repeat(33) + '22'.repeat(33) }),
      }),
    )
    expect(res.status).toBe(200)
    const db = createDb(process.env['DATABASE_URL']!)
    const row = await findAgentById(db, stubAgentId)
    expect(row?.viewKeyEncrypted).toMatch(/^v1:/)
  })

  it('refuses to overwrite an existing v1: envelope without ?force=1', async () => {
    // First write the v1 row.
    await app.fetch(
      new Request(`http://localhost/agents/${cleanAgentId}/view-key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKey: VIEW_KEY, stealthMeta: '0x' + 'aa'.repeat(33) + 'bb'.repeat(33) }),
      }),
    )

    const res = await app.fetch(
      new Request(`http://localhost/agents/${cleanAgentId}/view-key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKey: '0x' + 'ee'.repeat(32), stealthMeta: '0x' + 'cc'.repeat(33) + 'dd'.repeat(33) }),
      }),
    )
    expect(res.status).toBe(409)
  })

  it('allows overwrite with ?force=1', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${cleanAgentId}/view-key?force=1`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKey: '0x' + 'ee'.repeat(32), stealthMeta: '0x' + 'cc'.repeat(33) + 'dd'.repeat(33) }),
      }),
    )
    expect(res.status).toBe(200)
  })

  it('400s on a malformed view key', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${cleanAgentId}/view-key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKey: 'not-hex', stealthMeta: '0x' + 'aa'.repeat(33) + 'bb'.repeat(33) }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('400s on a malformed stealth meta', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${cleanAgentId}/view-key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKey: VIEW_KEY, stealthMeta: '0xdeadbeef' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('401s without a token', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${cleanAgentId}/view-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKey: VIEW_KEY, stealthMeta: '0x' + 'aa'.repeat(33) + 'bb'.repeat(33) }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('403s when the caller does not own the agent', async () => {
    const otherOwner = '0x0000000000000000000000000000000000000099'
    const otherToken = await mintJwt({ sub: otherOwner, ownerEoa: otherOwner, secret: process.env['JWT_SECRET']! })

    const res = await app.fetch(
      new Request(`http://localhost/agents/${cleanAgentId}/view-key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKey: VIEW_KEY, stealthMeta: '0x' + 'aa'.repeat(33) + 'bb'.repeat(33) }),
      }),
    )
    expect(res.status).toBe(403)
  })
})

describe('PATCH /agents/:id viewKeyEncrypted hardening', () => {
  it('rejects a viewKeyEncrypted value that is neither stub: nor v1:', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${cleanAgentId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKeyEncrypted: 'plain-text-blob' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('still accepts stub: rows for Plan 3 backward compatibility', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${stubAgentId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKeyEncrypted: 'stub:0xfeedface' }),
      }),
    )
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 8.5: Run the test to verify it fails**

```bash
cd apps/api
pnpm test
```

Expected: FAIL — the route does not exist; PATCH does not yet harden the prefix.

- [ ] **Step 8.6: Modify `apps/api/src/routes/agents.ts`**

Add the import block at the top of the imports section:

```ts
import { encryptForStorage } from '../lib/view-key-store.js'
import { isStealthMetaAddress } from '@open-agents/crypto'
```

Replace the `patchAgentSchema` with one that validates the prefix:

```ts
const patchAgentSchema = z.object({
  baseAddr: z.string().startsWith('0x').length(42).optional(),
  agentWalletEoa: z.string().startsWith('0x').length(42).optional(),
  textRecords: z.record(z.string()).optional(),
  treasurySafeAddress: z.string().startsWith('0x').length(42).optional(),
  viewKeyEncrypted: z
    .string()
    .refine(
      (v) => v.startsWith('stub:') || v.startsWith('v1:'),
      'viewKeyEncrypted must start with "stub:" (Plan 3) or "v1:" (Plan 4)',
    )
    .optional(),
})
```

Append the new route at the end of the file (after the `/treasury` route):

```ts
const viewKeySchema = z.object({
  viewKey: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'viewKey must be 0x-prefixed 32-byte hex'),
  stealthMeta: z
    .string()
    .refine((v) => isStealthMetaAddress(v), 'stealthMeta must be 132-hex per ENSIP-26'),
})

/**
 * POST /agents/:id/view-key
 * Body: { viewKey: 0x<64 hex>, stealthMeta: 0x<132 hex> }
 * Optional ?force=1 to overwrite an existing v1: envelope.
 *
 * Encrypts viewKey with VIEW_KEY_MASTER_KEY (AES-256-GCM via @open-agents/crypto)
 * and writes the v1: envelope to agents.view_key_encrypted. Also writes
 * stealthMeta into text_records['stealth-meta'] so the gateway can find it.
 *
 * Plan 3 stub: rows are overwritten without force=1 — the wizard re-derives
 * after upgrading. Existing v1: rows require ?force=1 to prevent silent
 * key rotation by a buggy client.
 */
agentsRoute.post(
  '/agents/:id/view-key',
  jwtMiddleware(env.JWT_SECRET),
  zValidator('json', viewKeySchema),
  async (c) => {
    const claims = c.var.jwtClaims
    const ownerEoa = ((claims.ownerEoa as string) ?? claims.sub).toLowerCase()
    const id = c.req.param('id')
    const force = c.req.query('force') === '1'
    const body = c.req.valid('json')

    const agent = await findAgentById(db, id)
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    if (agent.ownerEoa !== ownerEoa) return c.json({ error: 'Forbidden' }, 403)

    if (
      agent.viewKeyEncrypted &&
      agent.viewKeyEncrypted.startsWith('v1:') &&
      !force
    ) {
      return c.json(
        {
          error:
            'Agent already has a v1: view key. Pass ?force=1 to overwrite (DESTRUCTIVE).',
        },
        409,
      )
    }

    let envelope: string
    try {
      envelope = encryptForStorage(body.viewKey)
    } catch (err) {
      return c.json({ error: `viewKey encryption failed: ${String(err)}` }, 400)
    }

    const mergedRecords: Record<string, string> = {
      ...(agent.textRecords as Record<string, string>),
      'stealth-meta': body.stealthMeta,
    }

    const updated = await updateAgent(db, id, {
      viewKeyEncrypted: envelope,
      textRecords: mergedRecords,
    })

    return c.json({
      id: updated.id,
      viewKeyEncrypted: updated.viewKeyEncrypted,
      textRecords: updated.textRecords,
    })
  },
)
```

- [ ] **Step 8.7: Run the tests to verify they pass**

```bash
pnpm test
```

Expected: 8 view-key tests pass + 2 PATCH-hardening tests pass. The earlier `agents.test.ts` and `register-onchain.test.ts` still pass — their test fixtures supply a valid `VIEW_KEY_MASTER_KEY` env, and they only PATCH with `stub:` ciphertext.

(Note: existing `agents.test.ts` and `treasury.test.ts` may need their `process.env` setup augmented with `VIEW_KEY_MASTER_KEY = '0x' + 'aa'.repeat(32)`. If they fail at boot with a zod parse error, append that line under the existing `process.env` setters in each file. This is a one-line additive change per test, no commit-time blocker.)

- [ ] **Step 8.8: Commit**

```bash
cd ../..
git add apps/api/package.json apps/api/src/env.ts apps/api/src/lib/view-key-store.ts \
  apps/api/src/routes/agents.ts apps/api/tests/view-key.test.ts
git commit -m "$(cat <<'EOF'
feat(api): POST /agents/:id/view-key — server-side AES-GCM encryption

The dashboard PUTs the plaintext viewKey + stealthMeta over TLS; the api
encrypts with VIEW_KEY_MASTER_KEY (32-byte hex env) via @open-agents/crypto's
encryptForStorage and writes a v1: envelope plus the stealth-meta text
record. stub: rows from Plan 3 are overwritten without force; v1: rows
require ?force=1.

PATCH /agents/:id is hardened to reject viewKeyEncrypted values that don't
carry a known prefix, so a buggy client can't poison the column.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: API — surface stub-flag and stealth-meta in `/me`

**Files:**
- Modify: `apps/api/src/routes/me.ts`
- Modify: `apps/api/tests/me.test.ts`

The dashboard's "Agents list" needs to know which agents are still on Plan 3 stubs so it can show a "Re-onboard to enable private payments" banner. We extend each agent in the `/me` payload with two derived booleans:

- `viewKeyState`: `'none' | 'stub' | 'v1'` — the dashboard renders different copy per state.
- `stealthMetaPublished`: `boolean` — true iff `text_records['stealth-meta']` is a valid 132-hex address.

Neither field is the encrypted ciphertext itself — we never echo that to the browser.

- [ ] **Step 9.1: Modify `apps/api/tests/me.test.ts`**

Append a new describe block at the end:

```ts
describe('GET /me — Plan 4 view-key state surfacing', () => {
  it('reports viewKeyState=none for new agents', async () => {
    const db = createDb(process.env['DATABASE_URL']!)
    const fresh = await insertAgent(db, {
      ownerEoa: OWNER,
      subnameLabel: 'me-fresh-' + Date.now(),
      baseAddr: '0x0000000000000000000000000000000000000007',
    })

    const res = await app.fetch(
      new Request('http://localhost/me', {
        headers: { Authorization: `Bearer ${validToken}` },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { agents: Array<{ id: string; viewKeyState: string; stealthMetaPublished: boolean }> }
    const me = body.agents.find((a) => a.id === fresh.id)
    expect(me?.viewKeyState).toBe('none')
    expect(me?.stealthMetaPublished).toBe(false)
  })

  it('reports viewKeyState=stub for Plan 3 stub rows', async () => {
    const db = createDb(process.env['DATABASE_URL']!)
    const stub = await insertAgent(db, {
      ownerEoa: OWNER,
      subnameLabel: 'me-stub-' + Date.now(),
      baseAddr: '0x0000000000000000000000000000000000000008',
      viewKeyEncrypted: 'stub:0xdeadbeef',
    })

    const res = await app.fetch(
      new Request('http://localhost/me', {
        headers: { Authorization: `Bearer ${validToken}` },
      }),
    )
    const body = (await res.json()) as { agents: Array<{ id: string; viewKeyState: string }> }
    const me = body.agents.find((a) => a.id === stub.id)
    expect(me?.viewKeyState).toBe('stub')
  })

  it('reports viewKeyState=v1 + stealthMetaPublished=true after Plan 4 rotation', async () => {
    const db = createDb(process.env['DATABASE_URL']!)
    const real = await insertAgent(db, {
      ownerEoa: OWNER,
      subnameLabel: 'me-v1-' + Date.now(),
      baseAddr: '0x0000000000000000000000000000000000000009',
      viewKeyEncrypted: 'v1:eyJrIjoidiJ9',
      textRecords: { 'stealth-meta': '0x' + 'aa'.repeat(33) + 'bb'.repeat(33) },
    })

    const res = await app.fetch(
      new Request('http://localhost/me', {
        headers: { Authorization: `Bearer ${validToken}` },
      }),
    )
    const body = (await res.json()) as { agents: Array<{ id: string; viewKeyState: string; stealthMetaPublished: boolean }> }
    const me = body.agents.find((a) => a.id === real.id)
    expect(me?.viewKeyState).toBe('v1')
    expect(me?.stealthMetaPublished).toBe(true)
  })
})
```

- [ ] **Step 9.2: Run the tests to verify they fail**

```bash
cd apps/api
pnpm test -- me
```

Expected: FAIL — `viewKeyState` is undefined.

- [ ] **Step 9.3: Modify `apps/api/src/routes/me.ts`**

Locate the agent-mapping logic (where each agent is shaped for the response). Add the two derived fields. Replace the per-agent return object with:

```ts
import { isStealthMetaAddress } from '@open-agents/crypto'

function deriveViewKeyState(value: string | null | undefined): 'none' | 'stub' | 'v1' {
  if (!value) return 'none'
  if (value.startsWith('v1:')) return 'v1'
  if (value.startsWith('stub:')) return 'stub'
  return 'none'
}

function deriveStealthMetaPublished(records: Record<string, string> | null | undefined): boolean {
  const meta = records?.['stealth-meta']
  return typeof meta === 'string' && isStealthMetaAddress(meta)
}

// In the route handler, where each agent is shaped:
//   const ownerAgents = await findAgentsByOwner(db, ownerEoa)
//   return c.json({
//     ownerEoa,
//     agents: ownerAgents.map((agent) => ({
//       id: agent.id,
//       ownerEoa: agent.ownerEoa,
//       subnameLabel: agent.subnameLabel,
//       agentId: agent.agentId,
//       baseAddr: agent.baseAddr,
//       agentWalletEoa: agent.agentWalletEoa,
//       textRecords: agent.textRecords,
//       treasurySafeAddress: agent.treasurySafeAddress,
//       isActive: agent.isActive,
//       createdAt: agent.createdAt.toISOString(),
//       updatedAt: agent.updatedAt.toISOString(),
//       // Plan 4 additions:
//       viewKeyState: deriveViewKeyState(agent.viewKeyEncrypted),
//       stealthMetaPublished: deriveStealthMetaPublished(
//         agent.textRecords as Record<string, string> | null,
//       ),
//     })),
//   })
```

The actual edit hand-off into Plan 2's existing `me.ts` shape: insert the two helper functions above the route handler, then add `viewKeyState` and `stealthMetaPublished` to the per-agent object literal.

- [ ] **Step 9.4: Run the tests to verify they pass**

```bash
pnpm test -- me
```

Expected: 3 new me.test cases pass + the existing me.test cases still pass (they ignore the new fields).

- [ ] **Step 9.5: Update the dashboard's `AgentResponse` type**

Modify `apps/dashboard/src/types/api.ts`:

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
  /** Plan 4: derived from viewKeyEncrypted prefix. */
  viewKeyState?: 'none' | 'stub' | 'v1'
  /** Plan 4: derived from text_records['stealth-meta'] format check. */
  stealthMetaPublished?: boolean
}
```

- [ ] **Step 9.6: Commit**

```bash
cd ../..
git add apps/api/src/routes/me.ts apps/api/tests/me.test.ts \
  apps/dashboard/src/types/api.ts
git commit -m "$(cat <<'EOF'
feat(api): surface viewKeyState + stealthMetaPublished in /me

The dashboard needs to flag Plan 3 stub rows so it can prompt the user
to re-derive. /me adds two derived booleans per agent: viewKeyState
('none'|'stub'|'v1') and stealthMetaPublished (132-hex check on the
record). Neither leaks the ciphertext to the browser.

AgentResponse on the dashboard side gains the matching optional fields.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Dashboard — install `fluidkey-stealth-account-kit`, real wizard step 2

**Files:**
- Modify: `apps/dashboard/package.json`
- Create: `apps/dashboard/src/lib/stealth-derive-client.ts`
- Modify: `apps/dashboard/src/lib/stealth-stub.ts` (deprecation re-exports)
- Replace: `apps/dashboard/src/app/onboard/_steps/step-2-viewkey.tsx`
- Create: `apps/dashboard/tests/stealth-derive-client.test.ts`
- Modify: `apps/dashboard/tests/stealth-stub.test.ts`

The wizard now:

1. Asks the user to sign `STEALTH_DERIVATION_MESSAGE` (same string Plan 3 used).
2. Calls `deriveStealthKeysFromSignature(sig)` from `@open-agents/crypto`.
3. POSTs `{ viewKey, stealthMeta }` to `/agents/:id/view-key` (the new Plan 4 route — plaintext over TLS).
4. Renders the spend private key and meta-address into a "Save these securely" dialog. The spend privkey is shown once; if the user closes the dialog without copying, they re-derive (same EOA → same key).
5. Stores the spend privkey in the wizard zustand state under `wizardStore.spendPrivKey` for the eventual `.env` download (Plan 6) — but never PATCHes it to the api.

`stealth-stub.ts` becomes a thin re-export of `STEALTH_DERIVATION_MESSAGE` from `@open-agents/crypto` and a `@deprecated` `deriveViewKeyStub` that throws so accidental imports surface immediately. Plan 3's stealth-stub test is rewritten to assert the deprecation behaviour.

- [ ] **Step 10.1: Add the workspace + npm deps**

Modify `apps/dashboard/package.json`. Add to `dependencies`:

```json
{
  "dependencies": {
    "@hookform/resolvers": "^3.9.1",
    "@open-agents/crypto": "workspace:*",
    "@rainbow-me/rainbowkit": "^2.2.0",
    "@safe-global/protocol-kit": "^5.0.4",
    "@tanstack/react-query": "^5.59.16",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "fluidkey-stealth-account-kit": "^1.1.0",
    "lucide-react": "^0.453.0",
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-hook-form": "^7.53.1",
    "siwe": "^3.0.0",
    "sonner": "^1.7.0",
    "swr": "^2.2.5",
    "tailwind-merge": "^2.5.4",
    "viem": "^2.21.41",
    "wagmi": "^2.13.3",
    "zod": "^3.23.8",
    "zustand": "^5.0.1"
  }
}
```

(Do NOT install yet — Plan 4 follows the project rule of not running `pnpm install` mid-plan; the engineer runs it once at the end of Task 10 alongside other workspace deps.)

- [ ] **Step 10.2: Write the failing test**

Create `apps/dashboard/tests/stealth-derive-client.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  deriveStealthKeysFromSignatureBrowser,
  STEALTH_DERIVATION_MESSAGE,
} from '@/lib/stealth-derive-client'

const FAKE_SIG = '0x' + 'aa'.repeat(64) + '1b' // 65 bytes

describe('STEALTH_DERIVATION_MESSAGE re-export', () => {
  it('matches the Plan 3 / Plan 4 fixed message', () => {
    expect(STEALTH_DERIVATION_MESSAGE).toBe(
      'gabhru.eth: derive stealth keys for agent on Base mainnet (v1)',
    )
  })
})

describe('deriveStealthKeysFromSignatureBrowser', () => {
  it('returns the full triple', () => {
    const out = deriveStealthKeysFromSignatureBrowser(FAKE_SIG as `0x${string}`)
    expect(out.spendPrivKey).toMatch(/^0x[0-9a-f]{64}$/)
    expect(out.viewPrivKey).toMatch(/^0x[0-9a-f]{64}$/)
    expect(out.stealthMetaAddress).toMatch(/^0x[0-9a-f]{132}$/)
  })

  it('is deterministic per signature', () => {
    const a = deriveStealthKeysFromSignatureBrowser(FAKE_SIG as `0x${string}`)
    const b = deriveStealthKeysFromSignatureBrowser(FAKE_SIG as `0x${string}`)
    expect(a).toEqual(b)
  })

  it('throws on a too-short signature', () => {
    expect(() =>
      deriveStealthKeysFromSignatureBrowser('0xdeadbeef' as `0x${string}`),
    ).toThrow()
  })
})
```

Modify `apps/dashboard/tests/stealth-stub.test.ts`. Replace the entire file with:

```ts
import { describe, expect, it } from 'vitest'
import { deriveViewKeyStub, STEALTH_DERIVATION_MESSAGE } from '@/lib/stealth-stub'

describe('STEALTH_DERIVATION_MESSAGE (re-exported from @open-agents/crypto)', () => {
  it('still matches the canonical string', () => {
    expect(STEALTH_DERIVATION_MESSAGE).toBe(
      'gabhru.eth: derive stealth keys for agent on Base mainnet (v1)',
    )
  })
})

describe('deriveViewKeyStub — deprecated in Plan 4', () => {
  it('throws to surface accidental imports', () => {
    expect(() => deriveViewKeyStub('0xdeadbeef')).toThrow(/deprecated/i)
  })
})
```

- [ ] **Step 10.3: Run the tests to verify they fail**

```bash
cd apps/dashboard
pnpm test
```

Expected: FAIL — `stealth-derive-client.ts` does not exist; the deprecation re-export hasn't been wired.

- [ ] **Step 10.4: Create `apps/dashboard/src/lib/stealth-derive-client.ts`**

```ts
import {
  deriveStealthKeysFromSignature,
  STEALTH_DERIVATION_MESSAGE,
  type DerivedStealthKeys,
} from '@open-agents/crypto'

export { STEALTH_DERIVATION_MESSAGE }
export type { DerivedStealthKeys }

/**
 * Browser-safe re-export of the @open-agents/crypto derivation. The kit
 * itself is isomorphic (depends only on @noble/curves + viem, no node:*).
 *
 * Kept as a thin wrapper so Plan 5 can later swap in a Web Worker
 * implementation without touching the wizard component.
 */
export function deriveStealthKeysFromSignatureBrowser(
  signature: `0x${string}`,
): DerivedStealthKeys {
  return deriveStealthKeysFromSignature(signature)
}
```

- [ ] **Step 10.5: Replace `apps/dashboard/src/lib/stealth-stub.ts` with deprecation shim**

```ts
/**
 * Plan 3 stub module. Kept only for the deprecation test and so any forgotten
 * import surfaces an immediate runtime error rather than silently returning
 * fake bytes. Plan 4 onward should import from @open-agents/crypto or
 * @/lib/stealth-derive-client.
 */
export { STEALTH_DERIVATION_MESSAGE } from '@open-agents/crypto'

/**
 * @deprecated Use deriveStealthKeysFromSignatureBrowser from
 * @/lib/stealth-derive-client. Throws to surface accidental imports.
 */
export function deriveViewKeyStub(_signatureHex: string): never {
  throw new Error(
    'deriveViewKeyStub is deprecated as of Plan 4. Import deriveStealthKeysFromSignatureBrowser from @/lib/stealth-derive-client instead.',
  )
}

/** @deprecated See deriveViewKeyStub. */
export function packStubViewKeyForApi(_viewKeyHex: `0x${string}`): never {
  throw new Error(
    'packStubViewKeyForApi is deprecated as of Plan 4. POST { viewKey, stealthMeta } to /agents/:id/view-key instead.',
  )
}
```

- [ ] **Step 10.6: Replace `apps/dashboard/src/app/onboard/_steps/step-2-viewkey.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { useSignMessage } from 'wagmi'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useWizardStore } from '../_store'
import {
  STEALTH_DERIVATION_MESSAGE,
  deriveStealthKeysFromSignatureBrowser,
} from '@/lib/stealth-derive-client'
import { getApiClient } from '@/lib/api-client'
import type { AgentResponse } from '@/types/api'

export function Step2ViewKey() {
  const { agentRowId, setViewKey, setSpendKey, setStealthMeta, next } = useWizardStore()
  const { signMessageAsync } = useSignMessage()
  const [isWorking, setIsWorking] = useState(false)

  async function handleDerive() {
    if (!agentRowId) {
      toast.error('Missing agent — restart the wizard')
      return
    }
    setIsWorking(true)
    try {
      const sig = (await signMessageAsync({
        message: STEALTH_DERIVATION_MESSAGE,
      })) as `0x${string}`

      const derived = deriveStealthKeysFromSignatureBrowser(sig)

      // Send plaintext viewKey + stealthMeta over TLS. The api encrypts
      // server-side with VIEW_KEY_MASTER_KEY and writes a v1: envelope.
      // The spendPrivKey NEVER leaves the browser.
      await getApiClient().post<{ id: string; viewKeyEncrypted: string }>(
        `/agents/${agentRowId}/view-key`,
        {
          viewKey: derived.viewPrivKey,
          stealthMeta: derived.stealthMetaAddress,
        },
      )

      setSpendKey(derived.spendPrivKey)         // for Plan 6 .env download
      setStealthMeta(derived.stealthMetaAddress)
      setViewKey(derived.viewPrivKey)            // ephemeral; cleared by store on unmount

      toast.success('Stealth keys derived and registered')
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
        <CardTitle>Derive your stealth keys</CardTitle>
        <CardDescription>
          Sign a fixed message with your wallet — no gas, no transaction. Your signature deterministically
          derives a spend key (kept only in your browser), a view key (encrypted server-side so we can scan
          incoming payments), and the public meta-address we publish under your subname.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
          {STEALTH_DERIVATION_MESSAGE}
        </p>
        <p className="text-xs text-muted-foreground">
          Re-signing the same message with the same wallet always produces the same keys. If you ever lose
          your <code>.env</code>, return to this step and re-derive.
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

- [ ] **Step 10.7: Extend the wizard zustand store**

Modify `apps/dashboard/src/app/onboard/_store.ts`. Add these fields and setters to the existing `WizardState` shape:

```ts
// Append to the State interface:
spendPrivKey: `0x${string}` | null
stealthMeta: `0x${string}` | null

// Append to the Actions interface:
setSpendKey: (key: `0x${string}`) => void
setStealthMeta: (meta: `0x${string}`) => void

// In the create() initial state:
spendPrivKey: null,
stealthMeta: null,

// In the create() actions:
setSpendKey: (key) => set({ spendPrivKey: key }),
setStealthMeta: (meta) => set({ stealthMeta: meta }),
```

If the existing store does not have a discrete `setViewKey`, leave that intact — Plan 3's store already exports it; Plan 4 just adds two siblings.

- [ ] **Step 10.8: Run the tests to verify they pass**

```bash
pnpm test
```

Expected: stealth-derive-client.test (3 new) pass; rewritten stealth-stub.test (2) pass; rest of dashboard tests still pass.

- [ ] **Step 10.9: Smoke-test the wizard manually (optional but recommended)**

```bash
cd ../..
pnpm install
pnpm --filter @open-agents/dashboard dev
```

Visit `http://localhost:3002/onboard`, walk through to step 2, sign the message. Confirm:

- The view key column for the row gets a `v1:`-prefixed envelope (`SELECT view_key_encrypted FROM agents ORDER BY created_at DESC LIMIT 1;` in psql).
- `text_records ->> 'stealth-meta'` is a 132-char hex string.

- [ ] **Step 10.10: Commit**

```bash
git add apps/dashboard/package.json apps/dashboard/src/lib/stealth-derive-client.ts \
  apps/dashboard/src/lib/stealth-stub.ts apps/dashboard/src/app/onboard/_steps/step-2-viewkey.tsx \
  apps/dashboard/src/app/onboard/_store.ts apps/dashboard/tests/stealth-derive-client.test.ts \
  apps/dashboard/tests/stealth-stub.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): real ERC-5564 stealth derivation in wizard step 2

Pulls in fluidkey-stealth-account-kit (audited) via @open-agents/crypto.
Step 2 signs STEALTH_DERIVATION_MESSAGE, derives (spendPriv, viewPriv,
stealthMeta), POSTs viewKey+stealthMeta to the new
POST /agents/:id/view-key endpoint, and stashes spendPriv in the wizard
store for the (Plan 6) .env download. spendPriv NEVER leaves the browser.

The Plan 3 stealth-stub module is reduced to a deprecation shim that
throws on import, and its test suite is rewritten to assert that.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Stub-row migration helper script

**Files:**
- Create: `scripts/flag-stub-agents.mjs`

We **do not migrate stub rows in place**. The Plan 3 stub stored only `keccak256(signature)` — there is no spend privkey on file, and the user never ran the audited Fluidkey derivation, so we have no path to recover the real keys without prompting them again.

The script offers three actions:

- `pnpm node scripts/flag-stub-agents.mjs --list` — prints all rows whose `view_key_encrypted` starts with `stub:`.
- `pnpm node scripts/flag-stub-agents.mjs --notify` — sets `text_records['needs-reonboard'] = '1'` on every stub row so the dashboard can render a banner. (No DB schema change; we lean on the existing JSONB column.)
- `pnpm node scripts/flag-stub-agents.mjs --delete` — soft-deletes every stub row (`is_active = false`). Operator runs this once enough users have re-onboarded; the gateway already excludes inactive rows.

The script is intentionally not a `drizzle migration` — drizzle migrations should remain pure DDL. State migration belongs in scripts.

- [ ] **Step 11.1: Create `scripts/flag-stub-agents.mjs`**

```js
#!/usr/bin/env node
/**
 * Plan 4 — one-shot helper for Plan 3 stub: rows.
 *
 * Usage:
 *   pnpm node scripts/flag-stub-agents.mjs --list
 *   pnpm node scripts/flag-stub-agents.mjs --notify
 *   pnpm node scripts/flag-stub-agents.mjs --delete
 *
 * Reads DATABASE_URL from the env. Does NOT touch v1: rows.
 */

import postgres from 'postgres'

const args = process.argv.slice(2)
const mode = args[0]
const VALID = new Set(['--list', '--notify', '--delete'])

if (!mode || !VALID.has(mode)) {
  console.error('Usage: flag-stub-agents.mjs --list | --notify | --delete')
  process.exit(2)
}

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}

const sql = postgres(url, { max: 1 })

try {
  if (mode === '--list') {
    const rows = await sql`
      SELECT id, owner_eoa, subname_label, created_at
      FROM agents
      WHERE view_key_encrypted LIKE 'stub:%' AND is_active = true
      ORDER BY created_at DESC
    `
    console.log(`Found ${rows.length} active stub agent(s):`)
    for (const r of rows) {
      console.log(
        `  ${r.id}  ${r.subname_label.padEnd(24)}  owner=${r.owner_eoa}  created=${r.created_at.toISOString()}`,
      )
    }
  } else if (mode === '--notify') {
    const updated = await sql`
      UPDATE agents
      SET text_records = jsonb_set(coalesce(text_records, '{}'::jsonb), '{needs-reonboard}', '"1"'::jsonb),
          updated_at = now()
      WHERE view_key_encrypted LIKE 'stub:%' AND is_active = true
      RETURNING id
    `
    console.log(`Flagged ${updated.length} stub row(s) with text_records.needs-reonboard='1'.`)
  } else if (mode === '--delete') {
    const updated = await sql`
      UPDATE agents
      SET is_active = false,
          updated_at = now()
      WHERE view_key_encrypted LIKE 'stub:%' AND is_active = true
      RETURNING id
    `
    console.log(`Soft-deleted ${updated.length} stub row(s) (is_active = false).`)
  }
} finally {
  await sql.end({ timeout: 5 })
}
```

- [ ] **Step 11.2: Make it executable + smoke run**

```bash
chmod +x scripts/flag-stub-agents.mjs
DATABASE_URL=postgres://open_agents:open_agents_dev@localhost:5432/open_agents \
  pnpm node scripts/flag-stub-agents.mjs --list
```

Expected: lists every `stub:` row (probably the ones the engineer created during Plan 3 testing). If the list is empty, the script still exits 0.

- [ ] **Step 11.3: Document in `README.md`**

Append to the Plan 4 section of `README.md`:

```markdown
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
```

- [ ] **Step 11.4: Commit**

```bash
git add scripts/flag-stub-agents.mjs README.md
git commit -m "$(cat <<'EOF'
chore(scripts): flag-stub-agents — Plan 3 stub row migration helper

One-shot script with --list / --notify / --delete modes. --notify sets
text_records.needs-reonboard='1' so the dashboard banner can fire;
--delete soft-deletes (is_active=false) once users have re-onboarded.
README documents the runbook.

Stub rows are NOT migrated in place: Plan 3 never derived a spend
privkey, so re-deriving is the only path to a working stealth meta-
address.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: End-to-end integration test (wizard → API → DB → gateway)

**Files:**
- Create: `apps/api/tests/stealth-e2e.test.ts`

This is the cross-app integration test the spec demands: full path from "wizard step 2 derives keys" through "api encrypts and persists" to "gateway derives a fresh stealth address from the published meta". We don't drive the actual UI; we directly invoke the same library functions the wizard uses, then hit the api over `app.fetch`, then hit the gateway over its own `app.fetch`.

The test is colocated under `apps/api/tests/` because it boots both the api and the gateway in-process; an alternative was a top-level `tests/` directory, but keeping it next to the api keeps the existing `pnpm --filter` runner discoverable.

- [ ] **Step 12.1: Write the failing test**

Create `apps/api/tests/stealth-e2e.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { bytesToHex, encodeFunctionData, namehash, parseAbi, decodeAbiParameters } from 'viem'
import { mintJwt } from '@open-agents/auth'
import { createDb, insertAgent, listAnnouncementsByAgent } from '@open-agents/db'
import {
  deriveStealthKeysFromSignature,
  STEALTH_DERIVATION_MESSAGE,
} from '@open-agents/crypto'

process.env['DATABASE_URL'] = 'postgres://open_agents:open_agents_dev@localhost:5432/open_agents'
process.env['JWT_SECRET'] = 'test-secret-at-least-32-characters-here-xx'
process.env['BASE_RPC_URL'] = 'http://127.0.0.1:19999'
process.env['VIEW_KEY_MASTER_KEY'] = '0x' + 'aa'.repeat(32)
process.env['GATEWAY_SIGNER_PRIVATE_KEY'] = '0x' + '01'.repeat(32)
process.env['GATEWAY_ANNOUNCEMENTS'] = 'on'

const OWNER = '0x0000000000000000000000000000000000000088'
const OWNER_PRIV = '0x' + '88'.repeat(32) // forged for fakeSig only

let apiApp: { fetch: (req: Request) => Promise<Response> }
let gatewayApp: { fetch: (req: Request) => Promise<Response> }
let validToken: string
let agentRowId: string
let subname: string

function eip191Hash(message: string): Uint8Array {
  const prefix = `\x19Ethereum Signed Message:\n${message.length}`
  return keccak_256(new TextEncoder().encode(prefix + message))
}

function fakeSignature(priv: string, message: string): `0x${string}` {
  const sig = secp256k1.sign(eip191Hash(message), priv.slice(2))
  const r = sig.r.toString(16).padStart(64, '0')
  const s = sig.s.toString(16).padStart(64, '0')
  const v = (27 + (sig.recovery ?? 0)).toString(16).padStart(2, '0')
  return `0x${r}${s}${v}` as `0x${string}`
}

beforeAll(async () => {
  apiApp = (await import('../src/server.js')).default
  gatewayApp = (await import('../../gateway/src/server.js')).default
  validToken = await mintJwt({ sub: OWNER, ownerEoa: OWNER, secret: process.env['JWT_SECRET']! })

  subname = 'e2e-' + Date.now()
  const db = createDb(process.env['DATABASE_URL']!)
  const row = await insertAgent(db, {
    ownerEoa: OWNER,
    subnameLabel: subname,
    baseAddr: '0x0000000000000000000000000000000000000088',
  })
  agentRowId = row.id
})

describe('Plan 4 end-to-end', () => {
  it('walks wizard → api → DB → gateway and proves freshness + receiver-side recovery', async () => {
    // === Step A: simulate wizard step 2 ===
    const sig = fakeSignature(OWNER_PRIV, STEALTH_DERIVATION_MESSAGE)
    const derived = deriveStealthKeysFromSignature(sig)

    // === Step B: POST /agents/:id/view-key ===
    const postRes = await apiApp.fetch(
      new Request(`http://localhost/agents/${agentRowId}/view-key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          viewKey: derived.viewPrivKey,
          stealthMeta: derived.stealthMetaAddress,
        }),
      }),
    )
    expect(postRes.status).toBe(200)
    const postBody = (await postRes.json()) as { viewKeyEncrypted: string; textRecords: Record<string, string> }
    expect(postBody.viewKeyEncrypted.startsWith('v1:')).toBe(true)
    expect(postBody.textRecords['stealth-meta']).toBe(derived.stealthMetaAddress)

    // === Step C: gateway addr() returns a fresh stealth address ===
    const node = namehash(`${subname}.gabhru.eth`)
    const innerData = encodeFunctionData({
      abi: parseAbi(['function addr(bytes32) view returns (address)']),
      functionName: 'addr',
      args: [node],
    })
    const { dnsEncode } = await import('../../gateway/src/lib/ens-decode.js')
    const dns = `0x${Buffer.from(dnsEncode(`${subname}.gabhru.eth`)).toString('hex')}` as `0x${string}`
    const resolveCalldata = encodeFunctionData({
      abi: parseAbi(['function resolve(bytes, bytes)']),
      functionName: 'resolve',
      args: [dns, innerData],
    })
    const url = `http://localhost/resolve/0x000000000000000000000000000000000000CAFE/${resolveCalldata}.json`

    const r1 = await gatewayApp.fetch(new Request(url))
    const r2 = await gatewayApp.fetch(new Request(url))
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    const b1 = (await r1.json()) as { data: `0x${string}` }
    const b2 = (await r2.json()) as { data: `0x${string}` }
    const [resBytes1] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
      b1.data,
    )
    const [resBytes2] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
      b2.data,
    )
    const [addr1] = decodeAbiParameters([{ type: 'address' }], resBytes1 as `0x${string}`)
    const [addr2] = decodeAbiParameters([{ type: 'address' }], resBytes2 as `0x${string}`)
    expect(addr1).not.toBe(addr2)

    // === Step D: at least 2 announcements landed ===
    await new Promise((r) => setTimeout(r, 50))
    const db = createDb(process.env['DATABASE_URL']!)
    const announcements = await listAnnouncementsByAgent(db, agentRowId, 100)
    expect(announcements.length).toBeGreaterThanOrEqual(2)

    // === Step E: receiver-side recovery — for the most recent announcement,
    // the receiver (holding viewPriv) recomputes the stealth address and it
    // matches the one the gateway returned. ===
    const newest = announcements[0]!
    const sharedCompressed = secp256k1.getSharedSecret(
      derived.viewPrivKey.slice(2),
      newest.ephemeralPub.slice(2),
      true,
    )
    const sharedXOnly = sharedCompressed.slice(1)
    const h = keccak_256(sharedXOnly)
    expect(h[0]).toBe(newest.viewTag)

    const spendPubBytes = secp256k1.getPublicKey(derived.spendPrivKey.slice(2), true)
    const spendPoint = secp256k1.ProjectivePoint.fromHex(bytesToHex(spendPubBytes).slice(2))
    let n = 0n
    for (const b of h) n = (n << 8n) | BigInt(b)
    const hScalar = n % secp256k1.CURVE.n
    const childPoint = spendPoint.add(secp256k1.ProjectivePoint.BASE.multiply(hScalar))
    const childPubXY = childPoint.toRawBytes(false).slice(1)
    const recoveredAddrBytes = keccak_256(childPubXY).slice(-20)
    const recoveredAddr = `0x${Buffer.from(recoveredAddrBytes).toString('hex')}`.toLowerCase()
    expect(recoveredAddr).toBe(newest.stealthAddress.toLowerCase())
  })
})
```

- [ ] **Step 12.2: Run the e2e test**

```bash
cd apps/api
pnpm test -- stealth-e2e
```

Expected: 1 e2e test passes. If the announcements count assertion fails, allow extra time for the fire-and-forget Promise (`setTimeout 50ms` should be plenty; bump to 200ms in CI if flaky).

- [ ] **Step 12.3: Commit**

```bash
cd ../..
git add apps/api/tests/stealth-e2e.test.ts
git commit -m "$(cat <<'EOF'
test(api): Plan 4 end-to-end — wizard derivation through gateway recovery

Drives the same library functions the wizard uses (bypassing the UI),
POSTs /agents/:id/view-key, hits the gateway twice for the resulting
subname, asserts both addr() answers differ, then runs the receiver-side
ECDH path with the in-memory viewPriv to recover the same stealth EOA.
Also asserts the announcement viewTag matches the locally-computed one,
which is the cheap pre-filter the Plan 5 scanner will use.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

### 1. Spec coverage

- **§4.2 stealth scheme — ERC-5564 with secp256k1** — Tasks 3 and 4 implement the meta-address (compressed spend || compressed view, 132 hex), the gateway-side ephemeral keypair generation, ECDH, keccak hash, child point addition, and 20-byte EVM address derivation. Tested in `stealth-derivation.test.ts`, `stealth-per-query.test.ts`, and the e2e Task 12. ✓
- **§4.2 stealth scheme — Safe smart-account receiver address (CREATE2)** — DEFERRED to Plan 5. Plan 4's gateway returns the stealth EOA; Plan 5's scanner + sweep flow predicts the Safe via CREATE2 and lands the funds there. The DB row stores the EOA so Plan 5 can compute the Safe deterministically. ✓ (deferral)
- **§4.4 three-key model** — owner key drives wizard signing (unchanged from Plan 3); agent wallet key remains in solo-dev mode for Plan 4 (as in Plan 3); spend key generated client-side in step 2 and held in zustand state for Plan 6's `.env` download. View key generated in the same step, sent over TLS, AES-256-GCM encrypted server-side. ✓
- **§5.1 gateway derives per-query stealth addresses** — Task 7 replaces the resolve route's `addr` branch. Each call generates a fresh ephemeral key, derives the stealth address, returns it, and fires off a `gateway_announcements` insert. ✓
- **§5.1 records served by the gateway — `addr`, `addr` multicoin, `text(stealth-meta)`, `text(agent-context)`, `text(agent-endpoint[*])`, `text(agent-registration[...])`** — Plan 4 keeps all the text records served verbatim from `text_records` (they were wired in Plan 3). The new behaviour is only on `addr`/`addrMulticoin`. ✓
- **§5.3 `view_key_encrypted` envelope encryption** — Tasks 2 and 8 implement AES-256-GCM with a 32-byte master key. Format `v1:<base64(JSON{kid,iv,tag,ct})>` is rotation-ready (kid lets us tag rows under multiple master keys). ✓
- **§5.4 scanner worker** — DEFERRED to Plan 5. Plan 4 lays the off-chain announcement table the scanner will read; Plan 4 does NOT subscribe to Base mainnet ERC-5564 events or write to a `payments` table. ✓ (deferral)
- **§5.5 `/dashboard` payments table** — DEFERRED to Plan 5. Plan 4 only adds the `viewKeyState` / `stealthMetaPublished` flags to `/me` so the agents list can render a "re-derive" banner. ✓ (deferral)
- **§5.5 wizard step 2 deterministic derivation via Fluidkey** — Task 10 implements this in `step-2-viewkey.tsx` using `@open-agents/crypto.deriveStealthKeysFromSignature`. Same EOA + same `STEALTH_DERIVATION_MESSAGE` → same triple. ✓
- **§5.6 SDK `agent.onPayment`** — DEFERRED to Plan 6. ✓ (deferral)
- **§9 data model — `payments` table, `receipts` table** — DEFERRED to Plan 5 (payments) and Plan 7 (receipts). Plan 4's only DDL change is the `gateway_announcements` table. ✓ (deferral)
- **§10 risk — custodial view-key risk** — Plan 4 stays custodial (master-key encrypted at rest). The kid-tagged envelope format is the v2 hybrid scanner's bridge: when keys leave for the SDK, they leave as decryptable envelopes the SDK can re-encrypt under its own key. ✓ (documented)

**Gaps identified (intentional deferrals):**

| Spec section | Item | Deferred to |
| --- | --- | --- |
| §4.2 | Safe CREATE2 stealth-Safe address derivation + first-use deployment | Plan 5 |
| §5.4 | ERC-5564 Announcer event scanner on Base mainnet | Plan 5 |
| §5.4 | `payments` table + WebSocket push | Plan 5 |
| §5.5 | `/dashboard` payments table, withdraw button | Plan 5 |
| §5.5 | `/pay/[ens]` sender demo console | Plan 5 |
| §5.6 | `@gabhru/private-pay` SDK | Plan 6 |
| §6.1 | Downloadable `.env` with `SPEND_PRIVATE_KEY` | Plan 6 |
| §6.3 | Reputation `appendResponse` flow + EIP-712 receipts | Plan 7 |
| §10 | Hybrid scanner / view-key sovereignty (post-v1) | Roadmap |
| §10 | Master-key rotation runbook + automation | Roadmap (format ready, automation deferred) |

The spec also calls for `/api/agents/me/payments` (§8.2) and the SDK runtime API (§8.4); both depend on Plan 5's scanner having populated a `payments` table, so they're properly downstream of this plan.

### 2. Placeholder scan

Searched the plan for "TBD", "TODO", "implement appropriate", "similar to", "...":

- The string "placeholder" appears only in deliberate, well-scoped contexts:
  - Plan 3's `'stub:'` prefix carried over for the migration helper — explicit and tested.
  - "Plan 3 stub: rows" — historical reference, used in commit messages and route comments to motivate behaviour.
- "TBD", "TODO", "implement appropriate", "similar to", and "..." do not appear anywhere as instructional shorthand. Every code block is complete and runnable as written.
- Two comment-only TODO-shaped notes exist intentionally:
  - The latency budget aside in Task 7 ("p95 < 200ms gateway" — this is a documented assertion, not an unmet requirement).
  - The "Plan 5 will need to" annotations in deferral tables — these are coordination notes for the next plan, not gaps in Plan 4.

### 3. Type consistency

- `MasterKey` in `packages/crypto` is a `{ rawBytes: Buffer; kid: string }` and is the only type that flows through `encryptViewKey` / `decryptViewKey`. The api parses the env once into a `MasterKey` and reuses it; never passes raw hex to the cipher functions. ✓
- `CiphertextEnvelope` carries a literal `v: 1` — `parseEnvelope` rejects any other version, so the api / scanner never see a partially-supported shape. ✓
- `DerivedStealthKeys` returns five `Hex` fields (`viem` branded type). The wizard's zustand store types `spendPrivKey: \`0x${string}\` | null` and `stealthMeta: \`0x${string}\` | null`, which `Hex` widens to. ✓
- `PerQueryStealth` returns `{ stealthAddress: Address; ephemeralPubKey: Hex; viewTag: number }`. The gateway route assigns `value: Hex | string` from `out.stealthAddress` — `Address` is a subtype of `Hex`, so the assignment narrows correctly without a cast. ✓
- `GatewayAgent.stealthMeta` is `Hex | null`. The route's branch `if (agent.stealthMeta)` narrows to `Hex`; `deriveStealthForQuery` accepts `string` but its first guard is `isStealthMetaAddress`, so passing a `Hex` is type-safe. ✓
- `RecordAnnouncementInput` mirrors the column types in `gatewayAnnouncements`: `agentRowId: string` (uuid), `stealthAddress: string` (text), `ephemeralPub: string` (text), `viewTag: number` (integer 0–255 by construction; the column is `integer NOT NULL`). ✓
- `viewKeyState` on `AgentResponse` is `'none' | 'stub' | 'v1'` and `stealthMetaPublished` is `boolean`; both are optional on the dashboard side because Plan 3 responses won't carry them (forward-compatible with the api before Task 9 is deployed). ✓
- `Step2ViewKey` calls `signMessageAsync(...)` which returns `\`0x${string}\`` from wagmi 2.x; `deriveStealthKeysFromSignatureBrowser` accepts that exact type. The api client's `post<{ id; viewKeyEncrypted: string }>(...)` matches the route's response shape. ✓
- `flag-stub-agents.mjs` uses raw `postgres` SQL, not Drizzle, so no type contract crosses the boundary; the script's only inputs are the three string args validated against a `Set`. ✓
- `viewKeySchema` accepts `viewKey` as a 32-byte hex regex and `stealthMeta` as `isStealthMetaAddress`-passing string. Both narrow exactly to the cipher and meta-address signatures. ✓
- The `PatchAgentBody.viewKeyEncrypted` zod refinement narrows to `\`stub:${string}\` | \`v1:${string}\`` — neither the api nor the dashboard relies on that string-literal narrowing yet, but it stays a runtime guarantee for any new caller. ✓
