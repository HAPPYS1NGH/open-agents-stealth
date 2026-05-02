# Plan 1 — Foundation + ENS Wildcard Resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo, deploy a wildcard CCIP-Read offchain resolver contract to Ethereum mainnet, set it as `gabhru.eth`'s resolver, and verify that any ENS-aware client resolving `<anything>.gabhru.eth` reaches a working stub gateway and gets back a deterministic address.

**Architecture:** pnpm workspaces monorepo. `packages/contracts` is a Foundry project containing an ENSIP-10 wildcard resolver that reverts with `OffchainLookup` (ERC-3668) pointing at our gateway URL, and verifies a gateway signature on the response. `apps/gateway` is a Hono server that responds to gateway calls with hardcoded stub data (real agent lookups added in Plan 4). The resolver is forked from `ensdomains/offchain-resolver` (translated to Foundry tests).

**Tech Stack:** pnpm workspaces, TypeScript 5.x, Hono, viem 2.x, Foundry (forge + cast), Vercel (gateway hosting), Solidity 0.8.24, OpenZeppelin Contracts 5.x.

---

## File structure

After Plan 1, the repo looks like:

```
open-agents/
├── package.json                  # workspace root, pnpm scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json            # shared TS config
├── .gitignore                    # already exists
├── .env.example                  # template for env vars
├── README.md                     # top-level project README
├── docs/superpowers/
│   ├── specs/2026-05-02-private-agent-payments-design.md   # already exists
│   └── plans/2026-05-02-plan-1-foundation-and-resolver.md  # this file
├── apps/
│   └── gateway/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vercel.json
│       ├── src/
│       │   ├── server.ts                # Hono app entry
│       │   ├── routes/
│       │   │   └── resolve.ts           # CCIP-Read endpoint handler
│       │   ├── lib/
│       │   │   ├── ens-decode.ts        # DNS-encoded name decoder
│       │   │   ├── ens-resolve-data.ts  # decode addr/text calldata, encode results
│       │   │   ├── gateway-signer.ts    # signs responses for ERC-3668
│       │   │   └── stub-agents.ts       # hardcoded test agent data
│       │   └── env.ts                   # parsed env vars (zod)
│       └── tests/
│           ├── resolve.test.ts          # vitest unit tests
│           └── ens-decode.test.ts
└── packages/
    └── contracts/
        ├── foundry.toml
        ├── remappings.txt
        ├── README.md                    # deployment runbook
        ├── src/
        │   ├── OurOffchainResolver.sol  # the contract
        │   └── SignatureVerifier.sol    # helper lib
        ├── script/
        │   ├── Deploy.s.sol             # deploy resolver to mainnet
        │   └── SetGabhruResolver.s.sol  # one-time gabhru.eth resolver swap
        └── test/
            └── OurOffchainResolver.t.sol
```

Each file has one responsibility. Resolver tests live next to resolver code; gateway tests next to gateway code. Shared types are not yet needed; we'll introduce `packages/shared` in Plan 2.

---

## Prerequisites

The engineer must have available:

- `pnpm` 9+ (`npm install -g pnpm`)
- `node` 20+
- `foundryup` installed (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)
- An Ethereum mainnet RPC URL (Alchemy or Infura free tier)
- A funded EOA on Ethereum mainnet with ~0.01 ETH for the resolver deployment + the `setResolver` tx
- The owner of `gabhru.eth` (HAPPYS1NGH) signed in to the same EOA used above, OR has authorized this address as an operator on `gabhru.eth`
- A Vercel account for hosting the gateway

These should be verified before starting Task 7. If any are missing, work through tasks 1–6 first while gathering them.

---

### Task 1: Initialize pnpm workspace and root tooling

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.env.example`
- Create: `README.md`
- Modify: `.gitignore` (already exists from spec stage; verify it covers the new artifacts)

- [ ] **Step 1.1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 1.2: Create root `package.json`**

```json
{
  "name": "open-agents",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 1.3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "allowSyntheticDefaultImports": true,
    "verbatimModuleSyntax": true,
    "useDefineForClassFields": true
  }
}
```

- [ ] **Step 1.4: Create `.env.example`**

```env
# Ethereum mainnet RPC (Alchemy / Infura / etc.)
MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY

# Deployer wallet for the OurOffchainResolver contract on mainnet.
# Must hold ~0.01 ETH to cover deploy + setResolver tx.
# DO NOT commit this. .gitignore excludes .env.
DEPLOYER_PRIVATE_KEY=0x

# Address that will sign CCIP-Read gateway responses.
# Generate fresh via `cast wallet new`. Must be added to the resolver's
# authorized signers map after deployment.
GATEWAY_SIGNER_PRIVATE_KEY=0x

# Where the gateway will be hosted.
GATEWAY_URL=https://api.gabhru.eth.limo

# Etherscan API key for contract verification
ETHERSCAN_API_KEY=
```

- [ ] **Step 1.5: Create top-level `README.md`**

```markdown
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
```

- [ ] **Step 1.6: Verify `.gitignore` covers new artifacts**

The `.gitignore` from the spec stage already covers `node_modules/`, `.env`, build outputs, Foundry artifacts. Run `cat .gitignore` and confirm these entries exist. If `.pnpm-store/`, `out/`, or `cache/` are missing, add them. (They should already be there.)

- [ ] **Step 1.7: Install root dev dependencies**

Run: `pnpm install`
Expected: creates `pnpm-lock.yaml`, populates `node_modules/`, prints "Done".

- [ ] **Step 1.8: Verify scripts exist**

Run: `pnpm test` (no packages yet, should be no-op).
Expected: "No projects matched the filters" or empty pass; non-zero is OK at this stage.

- [ ] **Step 1.9: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .env.example README.md pnpm-lock.yaml .gitignore
git commit -m "$(cat <<'EOF'
chore: initialize pnpm workspace + root tooling

Sets up the monorepo skeleton: pnpm workspaces, shared TS config,
.env template covering the mainnet deployer + gateway signer keys
needed for Plan 1's resolver deployment. Top-level README links to
the spec and outlines the seven-plan sequence.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Initialize Foundry project under `packages/contracts`

**Files:**
- Create: `packages/contracts/foundry.toml`
- Create: `packages/contracts/remappings.txt`
- Create: `packages/contracts/.gitignore`
- Create: `packages/contracts/package.json` (so pnpm sees it; Foundry doesn't need it but pnpm does)
- Create: `packages/contracts/README.md` (deployment runbook stub)

- [ ] **Step 2.1: Create the directory and init Foundry**

Run:
```bash
mkdir -p packages/contracts
cd packages/contracts
forge init --no-commit --no-git --force
cd ../..
```

Expected: creates `src/`, `script/`, `test/`, `lib/forge-std/`, `foundry.toml`, etc. inside `packages/contracts/`.

- [ ] **Step 2.2: Replace generated `foundry.toml` with our config**

Overwrite `packages/contracts/foundry.toml`:

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.24"
optimizer = true
optimizer_runs = 200
via_ir = false
remappings = []
fs_permissions = [{ access = "read", path = "./" }]

[etherscan]
mainnet = { key = "${ETHERSCAN_API_KEY}" }

[rpc_endpoints]
mainnet = "${MAINNET_RPC_URL}"
```

- [ ] **Step 2.3: Add OpenZeppelin Contracts**

Run from repo root:
```bash
cd packages/contracts
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge install ensdomains/ens-contracts --no-commit
cd ../..
```

Expected: clones into `lib/openzeppelin-contracts/` and `lib/ens-contracts/`.

- [ ] **Step 2.4: Create `remappings.txt`**

```
@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
@ensdomains/ens-contracts/=lib/ens-contracts/contracts/
forge-std/=lib/forge-std/src/
```

- [ ] **Step 2.5: Append Foundry-specific paths to `packages/contracts/.gitignore`**

```
out/
cache/
broadcast/
*.tsbuildinfo
```

- [ ] **Step 2.6: Create `packages/contracts/package.json`**

```json
{
  "name": "@open-agents/contracts",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "forge build",
    "test": "forge test -vv",
    "typecheck": "echo 'no-op for solidity'",
    "lint": "echo 'no-op'"
  }
}
```

- [ ] **Step 2.7: Create `packages/contracts/README.md` (runbook stub)**

```markdown
# @open-agents/contracts

Solidity contracts for Open Agents private payments.

## Contracts

- `OurOffchainResolver` — ENSIP-10 wildcard resolver implementing ERC-3668
  CCIP-Read for `*.gabhru.eth`. Set as `gabhru.eth`'s resolver.

## Build & test

```bash
forge build
forge test -vv
```

## Deployment

See `script/Deploy.s.sol` and `script/SetGabhruResolver.s.sol`. Full runbook
at the bottom of this file. **Read it twice before running anything that
touches mainnet.**

## Mainnet runbook

(populated in Task 14)
```

- [ ] **Step 2.8: Remove auto-generated example files**

Run:
```bash
rm packages/contracts/src/Counter.sol
rm packages/contracts/test/Counter.t.sol
rm packages/contracts/script/Counter.s.sol
```

Expected: no errors.

- [ ] **Step 2.9: Verify Foundry builds the empty project**

Run from `packages/contracts/`: `forge build`
Expected: "Nothing to compile" or successful empty build.

Then verify pnpm sees the package: from repo root, run `pnpm --filter @open-agents/contracts build`. Expected: same as above.

- [ ] **Step 2.10: Commit**

```bash
git add packages/contracts
git commit -m "$(cat <<'EOF'
chore(contracts): scaffold Foundry project

Adds OZ contracts and ens-contracts as Foundry libs, configures solc
0.8.24, registers in pnpm workspace as @open-agents/contracts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Write the SignatureVerifier library

**Files:**
- Create: `packages/contracts/src/SignatureVerifier.sol`
- Create: `packages/contracts/test/SignatureVerifier.t.sol`

This is a minimal port of ENS's signature verifier used in their offchain-resolver reference. It hashes the result-and-expiry tuple per ERC-3668's signed-response convention and recovers the gateway's signer.

- [ ] **Step 3.1: Write the failing test for `makeSignatureHash`**

Create `packages/contracts/test/SignatureVerifier.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { SignatureVerifier } from "../src/SignatureVerifier.sol";

contract SignatureVerifierTest is Test {
    address constant TARGET = address(0xCAFE);

    function test_makeSignatureHash_isDeterministic() public pure {
        bytes memory request = hex"deadbeef";
        bytes memory result = hex"cafebabe";
        uint64 expires = 1746302400;

        bytes32 h1 = SignatureVerifier.makeSignatureHash(TARGET, expires, request, result);
        bytes32 h2 = SignatureVerifier.makeSignatureHash(TARGET, expires, request, result);
        assertEq(h1, h2);
    }

    function test_makeSignatureHash_changesOnAnyInputChange() public pure {
        bytes memory request = hex"deadbeef";
        bytes memory result = hex"cafebabe";
        uint64 expires = 1746302400;
        bytes32 base = SignatureVerifier.makeSignatureHash(TARGET, expires, request, result);

        assertTrue(base != SignatureVerifier.makeSignatureHash(address(0xBEEF), expires, request, result));
        assertTrue(base != SignatureVerifier.makeSignatureHash(TARGET, expires + 1, request, result));
        assertTrue(base != SignatureVerifier.makeSignatureHash(TARGET, expires, hex"deadbeee", result));
        assertTrue(base != SignatureVerifier.makeSignatureHash(TARGET, expires, request, hex"cafebabf"));
    }
}
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `forge test --match-path test/SignatureVerifier.t.sol -vv`
Expected: compile error — `SignatureVerifier.sol` doesn't exist yet.

- [ ] **Step 3.3: Write minimal `SignatureVerifier.sol`**

Create `packages/contracts/src/SignatureVerifier.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Helpers for verifying signed CCIP-Read responses per ERC-3668.
/// Ported from ENS's OffchainResolver reference implementation.
library SignatureVerifier {
    /// @dev The hash format covers: target contract, expiry, original request
    /// calldata, and result bytes. A signature over this hash binds a result
    /// to a specific resolver+request and prevents cross-binding replays.
    function makeSignatureHash(
        address target,
        uint64 expires,
        bytes memory request,
        bytes memory result
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            hex"1900",
            target,
            expires,
            keccak256(request),
            keccak256(result)
        ));
    }

    /// @dev Recovers the signer of (request, result, expires) and returns
    /// the recovered address along with the result bytes.
    function verify(
        bytes calldata request,
        bytes calldata response
    ) internal view returns (address signer, bytes memory result) {
        require(response.length >= 96, "Response too short");
        uint64 expires;
        bytes memory sig;
        (result, expires, sig) = abi.decode(response, (bytes, uint64, bytes));
        require(expires >= block.timestamp, "Signature expired");
        bytes32 hash = makeSignatureHash(address(this), expires, request, result);
        signer = ECDSA.recover(hash, sig);
    }
}
```

- [ ] **Step 3.4: Run test to verify it passes**

Run: `forge test --match-path test/SignatureVerifier.t.sol -vv`
Expected: 2 tests passing.

- [ ] **Step 3.5: Add a test for `verify` happy path**

Append to `packages/contracts/test/SignatureVerifier.t.sol`:

```solidity
contract SignatureVerifierVerifyTest is Test {
    address constant SELF = address(this);

    function test_verify_recoversSigner() public {
        uint256 signerKey = 0xA11CE;
        address signerAddr = vm.addr(signerKey);

        bytes memory request = hex"deadbeef";
        bytes memory result = hex"cafebabe";
        uint64 expires = uint64(block.timestamp + 60);

        bytes32 hash = SignatureVerifier.makeSignatureHash(address(this), expires, request, result);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        bytes memory sig = abi.encodePacked(r, s, v);

        bytes memory response = abi.encode(result, expires, sig);
        (address recovered, bytes memory got) = this.callVerify(request, response);

        assertEq(recovered, signerAddr);
        assertEq(keccak256(got), keccak256(result));
    }

    function test_verify_revertsIfExpired() public {
        uint256 signerKey = 0xA11CE;
        bytes memory request = hex"deadbeef";
        bytes memory result = hex"cafebabe";
        uint64 expires = uint64(block.timestamp - 1);

        bytes32 hash = SignatureVerifier.makeSignatureHash(address(this), expires, request, result);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        bytes memory sig = abi.encodePacked(r, s, v);
        bytes memory response = abi.encode(result, expires, sig);

        vm.expectRevert(bytes("Signature expired"));
        this.callVerify(request, response);
    }

    /// @dev Wrapper so `verify` is called with calldata (it's a `calldata` lib fn).
    function callVerify(bytes calldata request, bytes calldata response)
        external view returns (address, bytes memory)
    {
        return SignatureVerifier.verify(request, response);
    }
}
```

- [ ] **Step 3.6: Run all SignatureVerifier tests**

Run: `forge test --match-path test/SignatureVerifier.t.sol -vv`
Expected: 4 tests passing.

- [ ] **Step 3.7: Commit**

```bash
git add packages/contracts/src/SignatureVerifier.sol packages/contracts/test/SignatureVerifier.t.sol
git commit -m "$(cat <<'EOF'
feat(contracts): SignatureVerifier library for CCIP-Read responses

Hashes (target, expires, request, result) per ERC-3668's signed-response
convention and recovers the gateway signer. Ported from ENS's reference
offchain-resolver. Tests cover hash determinism, input-sensitivity, happy
path recovery, and expiry rejection.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Write the OurOffchainResolver contract — failing tests

**Files:**
- Create: `packages/contracts/test/OurOffchainResolver.t.sol`

We write the test scaffold first. The tests will compile-fail until Task 5 implements the contract.

- [ ] **Step 4.1: Create the failing test file**

Create `packages/contracts/test/OurOffchainResolver.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { OurOffchainResolver } from "../src/OurOffchainResolver.sol";
import { SignatureVerifier } from "../src/SignatureVerifier.sol";

contract OurOffchainResolverTest is Test {
    OurOffchainResolver internal resolver;
    address internal owner = address(0xABCD);
    address internal signer;
    uint256 internal signerKey;
    string[] internal urls;

    function setUp() public {
        signerKey = 0xA11CE;
        signer = vm.addr(signerKey);
        urls = new string[](1);
        urls[0] = "https://api.gabhru.eth.limo/resolve/{sender}/{data}";

        vm.prank(owner);
        resolver = new OurOffchainResolver(urls, _toArray(signer));
    }

    function _toArray(address a) internal pure returns (address[] memory arr) {
        arr = new address[](1);
        arr[0] = a;
    }

    function test_supportsExtendedResolverInterface() public view {
        // ENSIP-10 IExtendedResolver
        assertTrue(resolver.supportsInterface(0x9061b923));
        // ERC-165
        assertTrue(resolver.supportsInterface(0x01ffc9a7));
    }

    function test_resolve_revertsWithOffchainLookup() public {
        bytes memory dnsName = _dnsEncode("test.gabhru.eth");
        // calldata for addr(bytes32 node)
        bytes memory data = abi.encodeWithSelector(0x3b3b57de, bytes32(uint256(0x1234)));

        // Capture the OffchainLookup revert
        vm.expectRevert();
        resolver.resolve(dnsName, data);
    }

    function test_resolveWithProof_acceptsValidSignature() public {
        bytes memory request = hex"deadbeef";
        bytes memory result = abi.encode(address(0xCAFE));
        uint64 expires = uint64(block.timestamp + 60);

        bytes32 hash = SignatureVerifier.makeSignatureHash(address(resolver), expires, request, result);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        bytes memory sig = abi.encodePacked(r, s, v);
        bytes memory response = abi.encode(result, expires, sig);

        bytes memory out = resolver.resolveWithProof(response, request);
        assertEq(keccak256(out), keccak256(result));
    }

    function test_resolveWithProof_rejectsUnknownSigner() public {
        uint256 unknownKey = 0xDEAD;
        bytes memory request = hex"deadbeef";
        bytes memory result = abi.encode(address(0xCAFE));
        uint64 expires = uint64(block.timestamp + 60);

        bytes32 hash = SignatureVerifier.makeSignatureHash(address(resolver), expires, request, result);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(unknownKey, hash);
        bytes memory sig = abi.encodePacked(r, s, v);
        bytes memory response = abi.encode(result, expires, sig);

        vm.expectRevert(bytes("OurOffchainResolver: unauthorised signer"));
        resolver.resolveWithProof(response, request);
    }

    function test_owner_canRotateSigners() public {
        address newSigner = address(0xBEEF);
        vm.prank(owner);
        resolver.setSigner(newSigner, true);
        assertTrue(resolver.signers(newSigner));

        vm.prank(owner);
        resolver.setSigner(signer, false);
        assertFalse(resolver.signers(signer));
    }

    function test_nonOwner_cannotRotateSigners() public {
        vm.prank(address(0xBADBAD));
        vm.expectRevert();
        resolver.setSigner(address(0xBEEF), true);
    }

    function _dnsEncode(string memory name) internal pure returns (bytes memory) {
        bytes memory raw = bytes(name);
        bytes memory result = new bytes(raw.length + 2);
        uint256 labelStart = 0;
        uint256 outIdx = 0;
        for (uint256 i = 0; i <= raw.length; i++) {
            if (i == raw.length || raw[i] == ".") {
                uint256 labelLen = i - labelStart;
                result[outIdx++] = bytes1(uint8(labelLen));
                for (uint256 j = labelStart; j < i; j++) {
                    result[outIdx++] = raw[j];
                }
                labelStart = i + 1;
            }
        }
        result[outIdx] = 0x00;
        bytes memory trimmed = new bytes(outIdx + 1);
        for (uint256 k = 0; k <= outIdx; k++) trimmed[k] = result[k];
        return trimmed;
    }
}
```

- [ ] **Step 4.2: Run tests to verify they fail (compile error)**

Run: `forge test --match-path test/OurOffchainResolver.t.sol -vv`
Expected: compile error — `OurOffchainResolver.sol` not found.

- [ ] **Step 4.3: Commit (failing tests, intentionally)**

```bash
git add packages/contracts/test/OurOffchainResolver.t.sol
git commit -m "$(cat <<'EOF'
test(contracts): scaffold OurOffchainResolver tests (red)

Covers: ENSIP-10/ERC-165 interface support, OffchainLookup revert from
resolve(), happy path & invalid-signer paths through resolveWithProof,
and owner-only signer rotation. Implementation follows in next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Implement OurOffchainResolver — make tests pass

**Files:**
- Create: `packages/contracts/src/OurOffchainResolver.sol`

- [ ] **Step 5.1: Write the contract**

Create `packages/contracts/src/OurOffchainResolver.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ERC165 } from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { SignatureVerifier } from "./SignatureVerifier.sol";

/// @notice ENSIP-10 wildcard resolver implementing ERC-3668 CCIP-Read.
/// Set as the resolver for a parent name (e.g., gabhru.eth) so that all
/// subname queries are forwarded to the configured offchain gateway.
///
/// Forked from ENS's offchain-resolver reference and trimmed to the
/// authorized-signers pattern.
contract OurOffchainResolver is Ownable, ERC165 {
    /// @notice Thrown to instruct CCIP-Read clients to call the gateway.
    error OffchainLookup(
        address sender,
        string[] urls,
        bytes callData,
        bytes4 callbackFunction,
        bytes extraData
    );

    string[] public urls;
    mapping(address => bool) public signers;

    event NewSigners(address indexed signer, bool authorized);
    event UrlsUpdated(string[] urls);

    constructor(string[] memory _urls, address[] memory _signers) Ownable(msg.sender) {
        urls = _urls;
        for (uint256 i = 0; i < _signers.length; i++) {
            signers[_signers[i]] = true;
            emit NewSigners(_signers[i], true);
        }
    }

    /// @notice Owner-only signer rotation.
    function setSigner(address signer, bool authorized) external onlyOwner {
        signers[signer] = authorized;
        emit NewSigners(signer, authorized);
    }

    /// @notice Owner-only gateway URL update.
    function setUrls(string[] memory _urls) external onlyOwner {
        urls = _urls;
        emit UrlsUpdated(_urls);
    }

    /// @notice ENSIP-10 entry point. Always reverts with OffchainLookup
    /// to redirect resolution to the gateway.
    /// @param name DNS-encoded name (per ENS resolver convention)
    /// @param data Original resolver call data (e.g., addr/text/contenthash)
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        returns (bytes memory)
    {
        bytes memory callData = abi.encodeWithSelector(this.resolve.selector, name, data);
        revert OffchainLookup(
            address(this),
            urls,
            callData,
            this.resolveWithProof.selector,
            callData
        );
    }

    /// @notice Callback target for CCIP-Read. Verifies that the gateway
    /// signature is from an authorized signer and returns the encoded result.
    /// @param response ABI-encoded (bytes result, uint64 expires, bytes sig)
    /// @param extraData The original calldata that triggered the offchain lookup
    function resolveWithProof(bytes calldata response, bytes calldata extraData)
        external
        view
        returns (bytes memory)
    {
        (address signer, bytes memory result) = SignatureVerifier.verify(extraData, response);
        require(signers[signer], "OurOffchainResolver: unauthorised signer");
        return result;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC165, IERC165)
        returns (bool)
    {
        // 0x9061b923 = IExtendedResolver
        return interfaceId == 0x9061b923 || super.supportsInterface(interfaceId);
    }
}
```

- [ ] **Step 5.2: Run all tests**

Run: `forge test -vv`
Expected: all tests in `OurOffchainResolver.t.sol` and `SignatureVerifier.t.sol` pass. Approximately 10 tests total.

- [ ] **Step 5.3: Verify gas snapshot is reasonable**

Run: `forge snapshot`
Expected: `.gas-snapshot` file generated. Note any test using more than 200k gas — should be no surprises here.

- [ ] **Step 5.4: Commit**

```bash
git add packages/contracts/src/OurOffchainResolver.sol packages/contracts/.gas-snapshot
git commit -m "$(cat <<'EOF'
feat(contracts): OurOffchainResolver — ENSIP-10 wildcard CCIP-Read

ENSIP-10 wildcard resolver that always reverts with OffchainLookup (per
ERC-3668) pointing at the configured gateway URLs. resolveWithProof
verifies the gateway signature is from an authorized signer (owner-
managed signers map). Owner can rotate signers and update URLs.

All tests passing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Write the deploy script

**Files:**
- Create: `packages/contracts/script/Deploy.s.sol`

- [ ] **Step 6.1: Write the deploy script**

Create `packages/contracts/script/Deploy.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { OurOffchainResolver } from "../src/OurOffchainResolver.sol";

/// @notice Deploys OurOffchainResolver to Ethereum mainnet.
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url $MAINNET_RPC_URL \
///     --private-key $DEPLOYER_PRIVATE_KEY --broadcast --verify
contract DeployScript is Script {
    function run() external {
        string memory gatewayUrl = vm.envString("GATEWAY_URL");
        address gatewaySigner = vm.envAddress("GATEWAY_SIGNER_ADDRESS");

        // ENS gateway URLs use {sender} and {data} placeholders per ERC-3668.
        string[] memory urls = new string[](1);
        urls[0] = string.concat(gatewayUrl, "/resolve/{sender}/{data}.json");

        address[] memory signers = new address[](1);
        signers[0] = gatewaySigner;

        vm.startBroadcast();
        OurOffchainResolver resolver = new OurOffchainResolver(urls, signers);
        vm.stopBroadcast();

        console.log("OurOffchainResolver deployed at:", address(resolver));
        console.log("Gateway URL:", urls[0]);
        console.log("Authorized signer:", signers[0]);
        console.log("");
        console.log("Next: run script/SetGabhruResolver.s.sol after gateway is live and reachable.");
    }
}
```

- [ ] **Step 6.2: Update `.env.example` to include the gateway signer address**

Append to `.env.example`:

```env
# Gateway signer's public address (derived from GATEWAY_SIGNER_PRIVATE_KEY).
# Used by Deploy.s.sol to seed the resolver's authorized signers map.
GATEWAY_SIGNER_ADDRESS=0x
```

- [ ] **Step 6.3: Test the deploy script in dry-run mode against a local fork**

This task requires `MAINNET_RPC_URL` and a non-zero `GATEWAY_SIGNER_ADDRESS` in `.env`. For dry-run, the deployer key can be any valid key:

```bash
cd packages/contracts
GATEWAY_URL=https://example.com \
GATEWAY_SIGNER_ADDRESS=0x000000000000000000000000000000000000dEaD \
forge script script/Deploy.s.sol --rpc-url $MAINNET_RPC_URL --private-key 0x0000000000000000000000000000000000000000000000000000000000000001
cd ../..
```

Expected: prints "OurOffchainResolver deployed at: 0x..." and "Next:" line. No broadcast (no `--broadcast` flag).

- [ ] **Step 6.4: Commit**

```bash
git add packages/contracts/script/Deploy.s.sol .env.example
git commit -m "$(cat <<'EOF'
feat(contracts): deploy script for OurOffchainResolver

Reads GATEWAY_URL + GATEWAY_SIGNER_ADDRESS from env, instantiates the
resolver with one URL pattern (ERC-3668 placeholders {sender}/{data})
and one authorized signer. Dry-run verified against mainnet fork.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Initialize the gateway app under `apps/gateway`

**Files:**
- Create: `apps/gateway/package.json`
- Create: `apps/gateway/tsconfig.json`
- Create: `apps/gateway/vercel.json`
- Create: `apps/gateway/src/server.ts`
- Create: `apps/gateway/src/env.ts`

- [ ] **Step 7.1: Create `apps/gateway/package.json`**

```json
{
  "name": "@open-agents/gateway",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/server.ts",
    "start": "node dist/server.js",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "echo 'no-op'"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.7",
    "hono": "^4.6.9",
    "viem": "^2.21.41",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.0",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 7.2: Create `apps/gateway/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "ESNext",
    "moduleResolution": "Bundler"
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "tests"]
}
```

- [ ] **Step 7.3: Create `apps/gateway/vercel.json`**

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/api/index" }
  ],
  "functions": {
    "api/index.ts": {
      "memory": 256,
      "maxDuration": 10
    }
  }
}
```

- [ ] **Step 7.4: Create `apps/gateway/src/env.ts`**

```ts
import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  GATEWAY_SIGNER_PRIVATE_KEY: z.string().startsWith('0x').length(66),
  RESOLVER_ADDRESS: z.string().startsWith('0x').length(42).optional(),
})

export const env = envSchema.parse(process.env)
```

- [ ] **Step 7.5: Create `apps/gateway/src/server.ts` (minimal)**

```ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { env } from './env.js'

const app = new Hono()

app.get('/health', (c) => c.json({ ok: true }))

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`gateway listening on :${info.port}`)
  })
}

export default app
```

- [ ] **Step 7.6: Install dependencies**

Run from repo root: `pnpm install`
Expected: gateway's deps installed under `apps/gateway/node_modules` or hoisted.

- [ ] **Step 7.7: Verify dev server starts**

```bash
cd apps/gateway
GATEWAY_SIGNER_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000001 pnpm dev
```

Expected: prints "gateway listening on :3000". In another terminal: `curl http://localhost:3000/health` → `{"ok":true}`. Stop with Ctrl-C.

- [ ] **Step 7.8: Commit**

```bash
cd ../..
git add apps/gateway/package.json apps/gateway/tsconfig.json apps/gateway/vercel.json apps/gateway/src/env.ts apps/gateway/src/server.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore(gateway): scaffold Hono server + Vercel config

Sets up apps/gateway as a Hono app with a /health route, env validation
via zod, and a Vercel functions config that routes everything through
api/index. The resolve route is added in the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Implement the DNS-encoded name decoder

**Files:**
- Create: `apps/gateway/src/lib/ens-decode.ts`
- Create: `apps/gateway/tests/ens-decode.test.ts`

CCIP-Read clients send the name in DNS wire format (e.g., `\x04test\x07gabhru\x03eth\x00`). We need to decode it to extract labels.

- [ ] **Step 8.1: Write the failing test**

Create `apps/gateway/tests/ens-decode.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decodeDnsName, dnsEncode } from '../src/lib/ens-decode.js'

describe('decodeDnsName', () => {
  it('round-trips a 3-label name', () => {
    const encoded = dnsEncode('test.gabhru.eth')
    expect(decodeDnsName(encoded)).toEqual(['test', 'gabhru', 'eth'])
  })

  it('handles 2-label names', () => {
    const encoded = dnsEncode('gabhru.eth')
    expect(decodeDnsName(encoded)).toEqual(['gabhru', 'eth'])
  })

  it('handles deeper nesting', () => {
    const encoded = dnsEncode('a.b.c.d.eth')
    expect(decodeDnsName(encoded)).toEqual(['a', 'b', 'c', 'd', 'eth'])
  })

  it('throws on malformed input (no terminator)', () => {
    const bad = new Uint8Array([4, 116, 101, 115, 116])  // "test" without 0x00
    expect(() => decodeDnsName(bad)).toThrow()
  })
})
```

- [ ] **Step 8.2: Run test to verify it fails**

```bash
cd apps/gateway
pnpm test
```

Expected: FAIL — `decodeDnsName` not exported (or file doesn't exist).

- [ ] **Step 8.3: Write the implementation**

Create `apps/gateway/src/lib/ens-decode.ts`:

```ts
/**
 * Decodes a DNS-encoded name (length-prefixed labels terminated by 0x00)
 * into an array of UTF-8 label strings.
 *
 * Example: 0x04test07gabhru03eth00 → ['test', 'gabhru', 'eth']
 */
export function decodeDnsName(input: Uint8Array | `0x${string}`): string[] {
  const bytes = typeof input === 'string'
    ? Uint8Array.from(input.slice(2).match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
    : input

  const labels: string[] = []
  let i = 0
  const decoder = new TextDecoder()
  while (i < bytes.length) {
    const len = bytes[i]!
    if (len === 0) return labels
    if (i + 1 + len > bytes.length) {
      throw new Error('decodeDnsName: truncated input')
    }
    labels.push(decoder.decode(bytes.subarray(i + 1, i + 1 + len)))
    i += 1 + len
  }
  throw new Error('decodeDnsName: missing null terminator')
}

/**
 * Encodes a dotted name into DNS wire format. For tests and parity.
 */
export function dnsEncode(name: string): Uint8Array {
  const labels = name.split('.')
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  let totalLen = 0
  for (const label of labels) {
    const labelBytes = encoder.encode(label)
    if (labelBytes.length > 63) throw new Error('dnsEncode: label too long')
    parts.push(new Uint8Array([labelBytes.length]))
    parts.push(labelBytes)
    totalLen += 1 + labelBytes.length
  }
  parts.push(new Uint8Array([0]))
  totalLen += 1
  const out = new Uint8Array(totalLen)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}
```

- [ ] **Step 8.4: Run tests to verify they pass**

```bash
pnpm test
```

Expected: 4 tests passing.

- [ ] **Step 8.5: Commit**

```bash
cd ../..
git add apps/gateway/src/lib/ens-decode.ts apps/gateway/tests/ens-decode.test.ts
git commit -m "$(cat <<'EOF'
feat(gateway): DNS-encoded name decoder + encoder

Decodes length-prefixed DNS wire-format names (e.g., the 'name' parameter
of ENSIP-10 resolve()) into label arrays. Round-trip tests cover 2-, 3-,
and 5-label names plus malformed-input rejection.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Implement the resolver-call-data parser and result encoder

**Files:**
- Create: `apps/gateway/src/lib/ens-resolve-data.ts`
- Create: `apps/gateway/tests/ens-resolve-data.test.ts`

The gateway receives the original `resolve(name, data)` calldata; `data` is itself an ABI-encoded call to one of `addr(bytes32)`, `addr(bytes32,uint256)`, `text(bytes32,string)`, or `contenthash(bytes32)`. We need to identify which and produce the matching ABI-encoded result.

- [ ] **Step 9.1: Write the failing test**

Create `apps/gateway/tests/ens-resolve-data.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { encodeFunctionData, encodeAbiParameters, parseAbi, namehash } from 'viem'
import { parseResolveData, encodeResolveResult } from '../src/lib/ens-resolve-data.js'

const node = namehash('test.gabhru.eth')

describe('parseResolveData', () => {
  it('detects addr(node)', () => {
    const data = encodeFunctionData({
      abi: parseAbi(['function addr(bytes32) view returns (address)']),
      functionName: 'addr',
      args: [node],
    })
    const parsed = parseResolveData(data)
    expect(parsed.kind).toBe('addr')
    expect(parsed.node).toBe(node)
    if (parsed.kind === 'addr') expect(parsed.coinType).toBe(60n)
  })

  it('detects addr(node, coinType)', () => {
    const data = encodeFunctionData({
      abi: parseAbi(['function addr(bytes32, uint256) view returns (bytes)']),
      functionName: 'addr',
      args: [node, 2147492101n],  // Base mainnet coinType
    })
    const parsed = parseResolveData(data)
    expect(parsed.kind).toBe('addrMulticoin')
    if (parsed.kind === 'addrMulticoin') {
      expect(parsed.coinType).toBe(2147492101n)
    }
  })

  it('detects text(node, key)', () => {
    const data = encodeFunctionData({
      abi: parseAbi(['function text(bytes32, string) view returns (string)']),
      functionName: 'text',
      args: [node, 'agent-context'],
    })
    const parsed = parseResolveData(data)
    expect(parsed.kind).toBe('text')
    if (parsed.kind === 'text') expect(parsed.key).toBe('agent-context')
  })

  it('throws on unknown selector', () => {
    expect(() => parseResolveData('0xdeadbeef00000000')).toThrow()
  })
})

describe('encodeResolveResult', () => {
  it('encodes addr() result as a single address', () => {
    const out = encodeResolveResult({ kind: 'addr', node, coinType: 60n }, '0x000000000000000000000000000000000000bEEF')
    const decoded = encodeAbiParameters([{ type: 'address' }], ['0x000000000000000000000000000000000000bEEF'])
    expect(out).toBe(decoded)
  })

  it('encodes addrMulticoin() result as bytes', () => {
    const out = encodeResolveResult(
      { kind: 'addrMulticoin', node, coinType: 2147492101n },
      '0x000000000000000000000000000000000000bEEF'
    )
    // Multicoin returns bytes — for EVM addrs it's the 20-byte address right-padded
    const decoded = encodeAbiParameters([{ type: 'bytes' }], ['0x000000000000000000000000000000000000bEEF'])
    expect(out).toBe(decoded)
  })

  it('encodes text() result as a string', () => {
    const out = encodeResolveResult({ kind: 'text', node, key: 'agent-context' }, '{"name":"acmebot"}')
    const decoded = encodeAbiParameters([{ type: 'string' }], ['{"name":"acmebot"}'])
    expect(out).toBe(decoded)
  })
})
```

- [ ] **Step 9.2: Run tests to verify they fail**

```bash
cd apps/gateway
pnpm test
```

Expected: FAIL — `parseResolveData` / `encodeResolveResult` not exported.

- [ ] **Step 9.3: Write the implementation**

Create `apps/gateway/src/lib/ens-resolve-data.ts`:

```ts
import { decodeAbiParameters, encodeAbiParameters, type Hex } from 'viem'

export type ParsedResolveData =
  | { kind: 'addr'; node: Hex; coinType: 60n }
  | { kind: 'addrMulticoin'; node: Hex; coinType: bigint }
  | { kind: 'text'; node: Hex; key: string }
  | { kind: 'contenthash'; node: Hex }

const SEL_ADDR_NODE       = '0x3b3b57de'  // addr(bytes32)
const SEL_ADDR_MULTICOIN  = '0xf1cb7e06'  // addr(bytes32,uint256)
const SEL_TEXT            = '0x59d1d43c'  // text(bytes32,string)
const SEL_CONTENTHASH     = '0xbc1c58d1'  // contenthash(bytes32)

/**
 * Parses the `data` payload of an ENSIP-10 resolve(name,data) call into
 * a tagged union. Throws on unknown selectors.
 */
export function parseResolveData(data: Hex | string): ParsedResolveData {
  const hex = (data.startsWith('0x') ? data : `0x${data}`) as Hex
  const sel = hex.slice(0, 10).toLowerCase() as Hex
  const params = `0x${hex.slice(10)}` as Hex

  if (sel === SEL_ADDR_NODE) {
    const [node] = decodeAbiParameters([{ type: 'bytes32' }], params)
    return { kind: 'addr', node, coinType: 60n }
  }
  if (sel === SEL_ADDR_MULTICOIN) {
    const [node, coinType] = decodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint256' }],
      params
    )
    return { kind: 'addrMulticoin', node, coinType }
  }
  if (sel === SEL_TEXT) {
    const [node, key] = decodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'string' }],
      params
    )
    return { kind: 'text', node, key }
  }
  if (sel === SEL_CONTENTHASH) {
    const [node] = decodeAbiParameters([{ type: 'bytes32' }], params)
    return { kind: 'contenthash', node }
  }
  throw new Error(`parseResolveData: unsupported selector ${sel}`)
}

/**
 * Encodes the result for a parsed resolve call. The encoding must match
 * the original function's return type for the resolver client to decode.
 */
export function encodeResolveResult(parsed: ParsedResolveData, value: Hex | string): Hex {
  switch (parsed.kind) {
    case 'addr':
      return encodeAbiParameters([{ type: 'address' }], [value as Hex])
    case 'addrMulticoin':
      return encodeAbiParameters([{ type: 'bytes' }], [value as Hex])
    case 'text':
      return encodeAbiParameters([{ type: 'string' }], [value as string])
    case 'contenthash':
      return encodeAbiParameters([{ type: 'bytes' }], [value as Hex])
  }
}
```

- [ ] **Step 9.4: Run tests to verify they pass**

```bash
pnpm test
```

Expected: all 7 tests passing.

- [ ] **Step 9.5: Commit**

```bash
cd ../..
git add apps/gateway/src/lib/ens-resolve-data.ts apps/gateway/tests/ens-resolve-data.test.ts
git commit -m "$(cat <<'EOF'
feat(gateway): resolver calldata parser + result encoder

Parses the inner 'data' payload of ENSIP-10 resolve(name, data) into a
tagged union for addr/addrMulticoin/text/contenthash. Returns matching
ABI-encoded results. Tests cover all four record types plus unknown-
selector rejection.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Implement the gateway response signer

**Files:**
- Create: `apps/gateway/src/lib/gateway-signer.ts`
- Create: `apps/gateway/tests/gateway-signer.test.ts`

The gateway must produce signatures the on-chain resolver will accept. Same hash format as `SignatureVerifier.makeSignatureHash`.

- [ ] **Step 10.1: Write the failing test**

Create `apps/gateway/tests/gateway-signer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { keccak256, encodePacked, recoverAddress, hashMessage } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { signGatewayResponse, makeGatewaySignatureHash } from '../src/lib/gateway-signer.js'

const PK = '0x0000000000000000000000000000000000000000000000000000000000000001'
const account = privateKeyToAccount(PK)

describe('makeGatewaySignatureHash', () => {
  it('matches the on-chain hash format from SignatureVerifier.sol', () => {
    const target = '0x000000000000000000000000000000000000bEEF'
    const expires = 1746302400n
    const request = '0xdeadbeef'
    const result = '0xcafebabe'

    const hash = makeGatewaySignatureHash({ target, expires, request, result })

    // Mirrors: keccak256(0x1900 || target || expires || keccak(request) || keccak(result))
    const expected = keccak256(
      encodePacked(
        ['bytes2', 'address', 'uint64', 'bytes32', 'bytes32'],
        ['0x1900', target, expires, keccak256(request), keccak256(result)]
      )
    )
    expect(hash).toBe(expected)
  })
})

describe('signGatewayResponse', () => {
  it('produces a recoverable signature', async () => {
    const target = '0x000000000000000000000000000000000000bEEF'
    const expires = BigInt(Math.floor(Date.now() / 1000) + 60)
    const request = '0xdeadbeef'
    const result = '0xcafebabe'

    const { signature } = await signGatewayResponse(account, { target, expires, request, result })
    const hash = makeGatewaySignatureHash({ target, expires, request, result })
    const recovered = await recoverAddress({ hash, signature })
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase())
  })
})
```

- [ ] **Step 10.2: Run tests to verify they fail**

```bash
cd apps/gateway
pnpm test
```

Expected: FAIL — module not found.

- [ ] **Step 10.3: Write the implementation**

Create `apps/gateway/src/lib/gateway-signer.ts`:

```ts
import {
  encodeAbiParameters,
  encodePacked,
  keccak256,
  type Address,
  type Hex,
  type LocalAccount,
} from 'viem'

export interface GatewayResponseInput {
  target: Address
  expires: bigint
  request: Hex
  result: Hex
}

/**
 * Mirrors SignatureVerifier.makeSignatureHash on-chain. Producing the same
 * hash here means signatures are accepted by the deployed resolver.
 */
export function makeGatewaySignatureHash(input: GatewayResponseInput): Hex {
  return keccak256(
    encodePacked(
      ['bytes2', 'address', 'uint64', 'bytes32', 'bytes32'],
      [
        '0x1900',
        input.target,
        input.expires,
        keccak256(input.request),
        keccak256(input.result),
      ],
    ),
  )
}

/**
 * Signs the response and returns both the signature and the response
 * blob (ABI-encoded for the resolver's resolveWithProof callback).
 */
export async function signGatewayResponse(
  signer: LocalAccount,
  input: GatewayResponseInput,
): Promise<{ signature: Hex; encodedResponse: Hex }> {
  const hash = makeGatewaySignatureHash(input)
  const signature = await signer.sign({ hash })
  const encodedResponse = encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
    [input.result, input.expires, signature],
  )
  return { signature, encodedResponse }
}
```

- [ ] **Step 10.4: Run tests to verify they pass**

```bash
pnpm test
```

Expected: all tests passing (now 9 total in gateway).

- [ ] **Step 10.5: Commit**

```bash
cd ../..
git add apps/gateway/src/lib/gateway-signer.ts apps/gateway/tests/gateway-signer.test.ts
git commit -m "$(cat <<'EOF'
feat(gateway): response signer matching on-chain hash format

makeGatewaySignatureHash mirrors SignatureVerifier.makeSignatureHash
exactly (0x1900 || target || expires || keccak(request) || keccak(result)).
signGatewayResponse signs the hash and ABI-encodes the response payload
for resolveWithProof's expected (bytes,uint64,bytes) shape. Tests verify
hash equality vs. the on-chain format and signature recoverability.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Implement the stub agent data source

**Files:**
- Create: `apps/gateway/src/lib/stub-agents.ts`

Plan 4 will replace this with a Postgres-backed lookup. For Plan 1, hardcode one test agent so the resolver works end-to-end.

- [ ] **Step 11.1: Write the stub**

Create `apps/gateway/src/lib/stub-agents.ts`:

```ts
import type { Address } from 'viem'

export interface StubAgent {
  label: string                  // e.g., 'test'
  baseAddr: Address              // address returned for addr() queries
  textRecords: Record<string, string>
}

/**
 * Hardcoded test agents for Plan 1 verification. Replaced in Plan 4 by
 * a Postgres-backed lookup that derives a fresh stealth address per query
 * and reads the published context/endpoint records from the agents row.
 */
export const STUB_AGENTS: Readonly<Record<string, StubAgent>> = {
  test: {
    label: 'test',
    baseAddr: '0x000000000000000000000000000000000000bEEF',
    textRecords: {
      'agent-context': '{"name":"Plan 1 stub","description":"Hardcoded; replaced in Plan 4."}',
    },
  },
}

export function findStubAgent(label: string): StubAgent | undefined {
  return STUB_AGENTS[label.toLowerCase()]
}
```

- [ ] **Step 11.2: Commit**

```bash
git add apps/gateway/src/lib/stub-agents.ts
git commit -m "$(cat <<'EOF'
feat(gateway): hardcoded stub agent data source

Provides one 'test' agent at 0x...bEEF for Plan 1 end-to-end verification.
Plan 4 replaces this with a Postgres-backed agents lookup that derives
a fresh stealth address per query.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Wire the `/resolve` endpoint

**Files:**
- Create: `apps/gateway/src/routes/resolve.ts`
- Modify: `apps/gateway/src/server.ts`
- Create: `apps/gateway/tests/resolve.test.ts`

- [ ] **Step 12.1: Write the failing integration test**

Create `apps/gateway/tests/resolve.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { encodeFunctionData, namehash, parseAbi, decodeAbiParameters, toHex, fromHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const SIGNER_PK = '0x0000000000000000000000000000000000000000000000000000000000000001'
const SIGNER = privateKeyToAccount(SIGNER_PK)

let app: { fetch: (req: Request) => Promise<Response> }

beforeAll(async () => {
  process.env.GATEWAY_SIGNER_PRIVATE_KEY = SIGNER_PK
  app = (await import('../src/server.js')).default
})

afterAll(() => { delete process.env.GATEWAY_SIGNER_PRIVATE_KEY })

function buildResolveCalldata(name: string, innerData: `0x${string}`): `0x${string}` {
  // resolve(bytes,bytes) selector = 0x9061b923
  // Mirrors what the resolver contract puts into OffchainLookup.callData.
  // Encoded as call to `resolve(bytes name, bytes data)`.
  return encodeFunctionData({
    abi: parseAbi(['function resolve(bytes, bytes)']),
    functionName: 'resolve',
    args: [
      // Easier path for the test: pre-encode DNS name from helper
      // (we reuse the gateway's dnsEncode helper).
      toHex(new TextEncoder().encode(name)),  // placeholder; replaced below
      innerData,
    ],
  })
}

describe('GET /resolve/:sender/:data', () => {
  it('returns a signed addr() response for test.gabhru.eth', async () => {
    const node = namehash('test.gabhru.eth')
    const innerData = encodeFunctionData({
      abi: parseAbi(['function addr(bytes32) view returns (address)']),
      functionName: 'addr',
      args: [node],
    })

    // We need DNS-encoded name. Pull from our helper.
    const { dnsEncode } = await import('../src/lib/ens-decode.js')
    const dns = `0x${Buffer.from(dnsEncode('test.gabhru.eth')).toString('hex')}` as `0x${string}`

    const resolveCalldata = encodeFunctionData({
      abi: parseAbi(['function resolve(bytes, bytes)']),
      functionName: 'resolve',
      args: [dns, innerData],
    })

    const sender = '0x000000000000000000000000000000000000CAFE'
    const url = `http://localhost/resolve/${sender}/${resolveCalldata}.json`
    const res = await app.fetch(new Request(url))

    expect(res.status).toBe(200)
    const body = await res.json() as { data: `0x${string}` }
    expect(body.data).toMatch(/^0x[0-9a-f]+$/i)

    const [resultBytes, expires, sig] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
      body.data,
    )
    expect(typeof expires).toBe('bigint')
    expect((sig as `0x${string}`).length).toBe(2 + 65 * 2) // 65 bytes hex
    const [addr] = decodeAbiParameters([{ type: 'address' }], resultBytes as `0x${string}`)
    expect((addr as string).toLowerCase()).toBe('0x000000000000000000000000000000000000beef')
  })

  it('returns 404 for an unknown subname', async () => {
    const node = namehash('doesnotexist.gabhru.eth')
    const innerData = encodeFunctionData({
      abi: parseAbi(['function addr(bytes32) view returns (address)']),
      functionName: 'addr',
      args: [node],
    })
    const { dnsEncode } = await import('../src/lib/ens-decode.js')
    const dns = `0x${Buffer.from(dnsEncode('doesnotexist.gabhru.eth')).toString('hex')}` as `0x${string}`
    const resolveCalldata = encodeFunctionData({
      abi: parseAbi(['function resolve(bytes, bytes)']),
      functionName: 'resolve',
      args: [dns, innerData],
    })

    const url = `http://localhost/resolve/0x0/${resolveCalldata}.json`
    const res = await app.fetch(new Request(url))
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 12.2: Run test to verify it fails**

```bash
cd apps/gateway
pnpm test
```

Expected: FAIL — `/resolve/...` returns 404 for everything (no route).

- [ ] **Step 12.3: Implement the route**

Create `apps/gateway/src/routes/resolve.ts`:

```ts
import { Hono } from 'hono'
import { decodeAbiParameters, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { decodeDnsName } from '../lib/ens-decode.js'
import { encodeResolveResult, parseResolveData } from '../lib/ens-resolve-data.js'
import { signGatewayResponse } from '../lib/gateway-signer.js'
import { findStubAgent } from '../lib/stub-agents.js'
import { env } from '../env.js'

const SIG_VALIDITY_SECONDS = 60n  // signed responses expire in 60s

const signer = privateKeyToAccount(env.GATEWAY_SIGNER_PRIVATE_KEY as Hex)

export const resolveRoute = new Hono()

resolveRoute.get('/resolve/:sender/:data', async (c) => {
  const senderParam = c.req.param('sender') as Address
  // Vercel rewrites strip trailing extensions, but ENS clients append .json.
  const dataParam = c.req.param('data').replace(/\.json$/, '') as Hex

  // The 'data' parameter is itself a calldata for resolve(bytes, bytes).
  // Decode it to get the DNS-encoded name and the inner record-type calldata.
  const RESOLVE_SELECTOR = '0x9061b923' as const
  if (!dataParam.startsWith(RESOLVE_SELECTOR)) {
    return c.json({ message: 'expected resolve() selector' }, 400)
  }
  const inner = `0x${dataParam.slice(10)}` as Hex
  const [dnsName, recordCalldata] = decodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes' }],
    inner,
  ) as [Hex, Hex]

  const labels = decodeDnsName(dnsName)
  if (labels.length < 2) {
    return c.json({ message: 'name too short' }, 400)
  }
  // Expecting <label>.gabhru.eth
  const subnameLabel = labels[0]!
  const parsed = parseResolveData(recordCalldata)
  const agent = findStubAgent(subnameLabel)
  if (!agent) {
    return c.json({ message: `no agent for label '${subnameLabel}'` }, 404)
  }

  // Build the response value based on the record kind.
  let value: Hex | string
  if (parsed.kind === 'addr' || parsed.kind === 'addrMulticoin') {
    value = agent.baseAddr
  } else if (parsed.kind === 'text') {
    value = agent.textRecords[parsed.key] ?? ''
  } else if (parsed.kind === 'contenthash') {
    value = '0x'  // not implemented for stub
  } else {
    return c.json({ message: 'unsupported record' }, 400)
  }

  const result = encodeResolveResult(parsed, value)
  const expires = BigInt(Math.floor(Date.now() / 1000)) + SIG_VALIDITY_SECONDS
  const target = senderParam  // The resolver contract is the 'sender' per ERC-3668.

  const { encodedResponse } = await signGatewayResponse(signer, {
    target,
    expires,
    request: dataParam,
    result,
  })

  return c.json({ data: encodedResponse })
})
```

- [ ] **Step 12.4: Wire the route into the server**

Modify `apps/gateway/src/server.ts`:

```ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { env } from './env.js'
import { resolveRoute } from './routes/resolve.js'

const app = new Hono()

app.get('/health', (c) => c.json({ ok: true }))
app.route('/', resolveRoute)

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`gateway listening on :${info.port}`)
  })
}

export default app
```

- [ ] **Step 12.5: Run tests to verify they pass**

```bash
pnpm test
```

Expected: 11 tests passing total (4 ens-decode + 7 ens-resolve-data + 2 gateway-signer + 2 resolve).

If the resolve tests fail, common causes:
- The `data` URL param has a `.json` suffix not stripped — confirm `replace(/\.json$/, '')` runs.
- `decodeAbiParameters` is decoding `0x...` not `Uint8Array` — confirm the inner decode uses `inner` as Hex.

- [ ] **Step 12.6: Commit**

```bash
cd ../..
git add apps/gateway/src/routes/resolve.ts apps/gateway/src/server.ts apps/gateway/tests/resolve.test.ts
git commit -m "$(cat <<'EOF'
feat(gateway): /resolve endpoint with stub agent backing

Implements the ERC-3668 gateway endpoint: decodes the wrapped resolve()
calldata, resolves the subname against the stub agent table, encodes the
record result, signs (target=sender, expires=now+60s) per the on-chain
hash format, and returns ABI-encoded (result, expires, sig). Tests cover
addr() happy path and 404 for unknown labels.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Local end-to-end test against an Anvil fork

**Files:**
- Create: `packages/contracts/script/LocalE2E.s.sol`

This task verifies the full loop locally before risking mainnet gas. Anvil forks mainnet so `gabhru.eth`'s ENS records are visible; we deploy our resolver to the fork, set it as `gabhru.eth`'s resolver, and try resolving via viem.

- [ ] **Step 13.1: Start an anvil fork in a background terminal**

```bash
anvil --fork-url $MAINNET_RPC_URL --fork-block-number latest
```

Expected: anvil running on `http://127.0.0.1:8545`, prints test accounts.

- [ ] **Step 13.2: Start the gateway against the fork**

In a second terminal:

```bash
cd apps/gateway
GATEWAY_SIGNER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
PORT=3000 \
pnpm dev
```

(That's anvil's first default account private key.)

- [ ] **Step 13.3: Deploy the resolver to the fork**

In a third terminal:

```bash
cd packages/contracts
GATEWAY_URL=http://localhost:3000 \
GATEWAY_SIGNER_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast
```

Expected: prints "OurOffchainResolver deployed at: 0x..."

Capture that address — call it `RESOLVER_ADDR`.

- [ ] **Step 13.4: Set `gabhru.eth`'s resolver on the fork**

This requires the *real* owner of `gabhru.eth` to authorize, but on a fork we can impersonate. Use cast:

```bash
# 1. Read the real owner of gabhru.eth from ENS Registry (0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e).
# Namehash of gabhru.eth:
GABHRU_NODE=$(cast call 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e \
  "owner(bytes32)(address)" \
  $(cast keccak "gabhru.eth")  # NOTE: real namehash differs; see step 13.5
  --rpc-url http://127.0.0.1:8545)
```

- [ ] **Step 13.5: Use the correct namehash**

`gabhru.eth`'s namehash is computed as `keccak256(keccak256(0x...0x00 || keccak256("eth")) || keccak256("gabhru"))`. Use viem's `namehash` helper:

```bash
cd ../../apps/gateway
node -e 'import("viem").then(v=>console.log(v.namehash("gabhru.eth")))'
```

Capture the namehash — call it `GABHRU_NODE`.

- [ ] **Step 13.6: Find the owner and impersonate**

```bash
ENS_REGISTRY=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
GABHRU_OWNER=$(cast call $ENS_REGISTRY "owner(bytes32)(address)" $GABHRU_NODE --rpc-url http://127.0.0.1:8545)
echo "gabhru.eth owner: $GABHRU_OWNER"

# Impersonate
cast rpc anvil_impersonateAccount $GABHRU_OWNER --rpc-url http://127.0.0.1:8545
cast rpc anvil_setBalance $GABHRU_OWNER 0xDE0B6B3A7640000 --rpc-url http://127.0.0.1:8545

# Check if the name is wrapped — if owner is the Name Wrapper address, route differently.
# Name Wrapper address: 0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401
NAME_WRAPPER=0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401
if [ "$GABHRU_OWNER" = "$NAME_WRAPPER" ]; then
  echo "Wrapped — use NameWrapper.setResolver"
  # Find the actual owner via NameWrapper.ownerOf(uint256(GABHRU_NODE))
  REAL_OWNER=$(cast call $NAME_WRAPPER "ownerOf(uint256)(address)" $GABHRU_NODE --rpc-url http://127.0.0.1:8545)
  cast rpc anvil_impersonateAccount $REAL_OWNER --rpc-url http://127.0.0.1:8545
  cast send $NAME_WRAPPER "setResolver(bytes32,address)" $GABHRU_NODE $RESOLVER_ADDR --from $REAL_OWNER --rpc-url http://127.0.0.1:8545 --unlocked
else
  cast send $ENS_REGISTRY "setResolver(bytes32,address)" $GABHRU_NODE $RESOLVER_ADDR --from $GABHRU_OWNER --rpc-url http://127.0.0.1:8545 --unlocked
fi
```

Expected: tx succeeds. Now `gabhru.eth`'s resolver on the fork is our deployed contract.

- [ ] **Step 13.7: Resolve a subname via viem**

In a fresh shell:

```bash
node --input-type=module -e '
import { createPublicClient, http } from "viem"
import { mainnet } from "viem/chains"

const client = createPublicClient({
  chain: mainnet,
  transport: http("http://127.0.0.1:8545"),
})

const addr = await client.getEnsAddress({ name: "test.gabhru.eth" })
console.log("Resolved:", addr)
'
```

Expected: prints `Resolved: 0x000000000000000000000000000000000000bEEF`. If it errors with "OffchainLookup," ensure the gateway is running and reachable at the URL set in `RESOLVER_ADDR`'s URLs.

- [ ] **Step 13.8: Document the runbook**

Append the verified-working sequence to `packages/contracts/README.md` under the "Mainnet runbook" header (placeholder from Task 2.7). Replace `0x000…` with actual addresses observed.

```markdown
## Mainnet runbook

(Verified locally against an anvil fork; mainnet steps are identical
modulo the RPC URL.)

### Pre-flight

- `MAINNET_RPC_URL` set in env
- `DEPLOYER_PRIVATE_KEY` holds ≥0.01 ETH on mainnet
- Gateway is deployed and reachable at `GATEWAY_URL`
- `GATEWAY_SIGNER_ADDRESS` is the address of the key the gateway uses to sign

### Step 1: Deploy the resolver

```bash
cd packages/contracts
forge script script/Deploy.s.sol \
  --rpc-url $MAINNET_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast --verify
```

Capture the deployed address: `RESOLVER_ADDR`.

### Step 2: Set gabhru.eth's resolver

If gabhru.eth is wrapped (Name Wrapper), call `setResolver` on the wrapper
at `0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401`. Otherwise call it on the
ENS Registry at `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`.

```bash
cast send <REGISTRY_OR_WRAPPER> \
  "setResolver(bytes32,address)" \
  <gabhru.eth namehash> \
  $RESOLVER_ADDR \
  --rpc-url $MAINNET_RPC_URL \
  --private-key $GABHRU_OWNER_PRIVATE_KEY
```

### Step 3: Verify

```bash
node --input-type=module -e '
import { createPublicClient, http } from "viem"
import { mainnet } from "viem/chains"
const c = createPublicClient({ chain: mainnet, transport: http(process.env.MAINNET_RPC_URL) })
console.log(await c.getEnsAddress({ name: "test.gabhru.eth" }))
'
```

Expected: a non-null address from the gateway.
```

- [ ] **Step 13.9: Commit**

```bash
git add packages/contracts/README.md
git commit -m "$(cat <<'EOF'
docs(contracts): mainnet runbook + verified local E2E

Documents the deploy-then-setResolver flow against ENS Registry / Name
Wrapper based on whether gabhru.eth is wrapped. Verified locally on an
anvil fork: deployed resolver, swapped gabhru.eth's resolver via
impersonation, resolved test.gabhru.eth back to the stub address.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 13.10: Stop the fork and gateway processes**

Ctrl-C in the anvil and gateway terminals. Save your shell history.

---

### Task 14: Deploy the gateway to Vercel

**Files:**
- Create: `apps/gateway/api/index.ts` (Vercel function entry point)
- Modify: `apps/gateway/package.json` (add Vercel-friendly build)

- [ ] **Step 14.1: Create the Vercel function entry**

Create `apps/gateway/api/index.ts`:

```ts
import { handle } from 'hono/vercel'
import app from '../src/server.js'

export default handle(app)
export const config = { runtime: 'nodejs' }
```

- [ ] **Step 14.2: Verify `vercel.json` rewrites are correct**

Open `apps/gateway/vercel.json`, confirm:

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/api/index" }
  ]
}
```

- [ ] **Step 14.3: Deploy via Vercel CLI**

From `apps/gateway/`:

```bash
npx vercel link  # link this directory to a Vercel project; pick "create new"
npx vercel env add GATEWAY_SIGNER_PRIVATE_KEY production
# (Paste the gateway signer key; confirm it's the same key whose address is GATEWAY_SIGNER_ADDRESS in .env)
npx vercel --prod
```

Expected: Vercel returns a URL like `https://open-agents-gateway.vercel.app`.

Set this as `GATEWAY_URL` in your local `.env`.

- [ ] **Step 14.4: Smoke-test the deployed gateway**

```bash
curl https://<your-vercel-url>/health
```

Expected: `{"ok":true}`.

- [ ] **Step 14.5: Wire a custom domain (optional but recommended)**

In Vercel dashboard, attach `api.gabhru.eth.limo` as a domain (or whatever subdomain you want — `eth.limo` automatically serves any ENS name's contenthash, but for the gateway you'll need a CNAME on a domain you control). For Plan 1, the auto-generated `*.vercel.app` URL is fine.

- [ ] **Step 14.6: Commit**

```bash
cd ../..
git add apps/gateway/api/index.ts
git commit -m "$(cat <<'EOF'
chore(gateway): Vercel function entry point

Wraps the Hono app in hono/vercel's handle() so Vercel routes everything
through api/index. Verified: GET /health returns {"ok":true} on the
deployed URL. Custom domain optional for Plan 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Mainnet deploy

**Files:**
- (none — runbook execution)

This task is the actual mainnet ceremony. Read every step before running anything.

- [ ] **Step 15.1: Verify pre-flight**

```bash
echo "Mainnet RPC: $MAINNET_RPC_URL"
echo "Deployer balance:" $(cast balance $(cast wallet address $DEPLOYER_PRIVATE_KEY) --rpc-url $MAINNET_RPC_URL)
echo "Gateway URL: $GATEWAY_URL"
echo "Gateway signer addr: $GATEWAY_SIGNER_ADDRESS"
```

Confirm: deployer balance ≥ 0.01 ETH, gateway URL responds to `/health`, signer address matches the deployed Vercel function's env.

- [ ] **Step 15.2: Run a final dry-run on mainnet (no `--broadcast`)**

```bash
cd packages/contracts
forge script script/Deploy.s.sol \
  --rpc-url $MAINNET_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY
```

Expected: prints "OurOffchainResolver deployed at: 0x..." (predicted address). No tx submitted.

- [ ] **Step 15.3: Deploy for real**

```bash
forge script script/Deploy.s.sol \
  --rpc-url $MAINNET_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

Expected: prints deployed address; verifies on Etherscan within ~60s.

Capture: `RESOLVER_ADDR=<address>`.

- [ ] **Step 15.4: Wait for verification on Etherscan**

Open `https://etherscan.io/address/$RESOLVER_ADDR` — confirm "Contract Source Code Verified" badge appears.

- [ ] **Step 15.5: Commit deployment artifacts**

```bash
cd ../..
# Foundry creates broadcast/Deploy.s.sol/1/run-latest.json
git add packages/contracts/broadcast
git commit -m "$(cat <<'EOF'
chore(contracts): mainnet deployment artifact for OurOffchainResolver

Resolver deployed and verified on Etherscan at <RESOLVER_ADDR>.
Authorized signer: <GATEWAY_SIGNER_ADDRESS>.
Gateway URL: <GATEWAY_URL>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(Replace placeholders with the actual addresses before committing.)

---

### Task 16: Set `gabhru.eth`'s resolver on mainnet

**Files:**
- (none — manual ceremony)

- [ ] **Step 16.1: Determine wrapped vs. unwrapped**

```bash
ENS_REGISTRY=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
NAME_WRAPPER=0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401
GABHRU_NODE=$(node --input-type=module -e 'import("viem").then(v => process.stdout.write(v.namehash("gabhru.eth")))')

OWNER=$(cast call $ENS_REGISTRY "owner(bytes32)(address)" $GABHRU_NODE --rpc-url $MAINNET_RPC_URL)
echo "ENS Registry says owner: $OWNER"

if [ "$OWNER" = "$NAME_WRAPPER" ]; then
  echo "Name is WRAPPED. Use NameWrapper.setResolver."
  WRAPPED=1
else
  echo "Name is UNWRAPPED. Use ENS Registry.setResolver."
  WRAPPED=0
fi
```

- [ ] **Step 16.2: Set the resolver (unwrapped path)**

If `WRAPPED=0`:

```bash
cast send $ENS_REGISTRY \
  "setResolver(bytes32,address)" \
  $GABHRU_NODE $RESOLVER_ADDR \
  --rpc-url $MAINNET_RPC_URL \
  --private-key $GABHRU_OWNER_PRIVATE_KEY
```

(`$GABHRU_OWNER_PRIVATE_KEY` is HAPPYS1NGH's key. If it's the same as `$DEPLOYER_PRIVATE_KEY`, use that.)

- [ ] **Step 16.3: Set the resolver (wrapped path)**

If `WRAPPED=1`:

```bash
cast send $NAME_WRAPPER \
  "setResolver(bytes32,address)" \
  $GABHRU_NODE $RESOLVER_ADDR \
  --rpc-url $MAINNET_RPC_URL \
  --private-key $GABHRU_OWNER_PRIVATE_KEY
```

- [ ] **Step 16.4: Verify the swap took effect**

```bash
NEW_RESOLVER=$(cast call $ENS_REGISTRY "resolver(bytes32)(address)" $GABHRU_NODE --rpc-url $MAINNET_RPC_URL)
echo "gabhru.eth resolver is now: $NEW_RESOLVER"
# Should equal $RESOLVER_ADDR
```

---

### Task 17: Verify end-to-end resolution on mainnet

**Files:**
- (none — verification)

- [ ] **Step 17.1: Resolve via viem**

```bash
node --input-type=module -e '
import { createPublicClient, http } from "viem"
import { mainnet } from "viem/chains"
const c = createPublicClient({ chain: mainnet, transport: http(process.env.MAINNET_RPC_URL) })
console.log("test.gabhru.eth →", await c.getEnsAddress({ name: "test.gabhru.eth" }))
'
```

Expected: prints `test.gabhru.eth → 0x000000000000000000000000000000000000bEEF`.

- [ ] **Step 17.2: Resolve via the ENS app**

Open `https://app.ens.domains/test.gabhru.eth` in a browser. The "Records" tab should show resolved values from the gateway.

- [ ] **Step 17.3: Resolve via cast**

```bash
cast resolve-name test.gabhru.eth --rpc-url $MAINNET_RPC_URL
```

Expected: same address.

- [ ] **Step 17.4: Tag the milestone**

```bash
git tag -a v0.1.0-resolver-live -m "Plan 1 complete: OurOffchainResolver live on mainnet, gabhru.eth swapped, test.gabhru.eth resolves end-to-end"
```

(Don't push the tag yet — that's the dev's call.)

---

## Self-review checklist (run before handing off)

- [ ] Spec coverage — does Plan 1 cover the resolver-related sections of the spec?
  - §4.1 ENS resolver wildcard pattern: yes (Tasks 4–5)
  - §5.1 OurOffchainResolver: yes (Tasks 4–5, 15)
  - §5.3 gateway: stub for now (Tasks 7–12); real agent backing in Plan 4
  - §6.2 receive payment flow: only the resolver half, sender-side covered in later plans
- [ ] No placeholders: every code block is complete; commands have expected output
- [ ] Type consistency: `parseResolveData` returns `ParsedResolveData`; `encodeResolveResult` accepts the same union; gateway-signer's `GatewayResponseInput` matches what `signGatewayResponse` is called with
- [ ] Out-of-order safety: the deploy script (Task 6) references env vars that are defined in `.env.example` (Task 1.4 + 6.2); the runbook (Task 13.8) references contracts deployed in Task 5

If a Plan 2 dev reads this without conversation context, they have everything: file paths, complete code, exact commands, expected outputs.

---

## Plan 1 deliverables summary

After Task 17, the repo has:

- A pnpm monorepo with two packages (`contracts`, `gateway`).
- A Foundry-tested ENSIP-10 wildcard CCIP-Read resolver contract deployed and Etherscan-verified on Ethereum mainnet.
- A Vercel-hosted Hono gateway answering CCIP-Read calls with stub data.
- `gabhru.eth` pointed at the resolver. Any subname under it (`<x>.gabhru.eth`) resolves through the gateway.
- A documented mainnet runbook for re-running the ceremony.

Plan 2 (backend foundation) starts here.
