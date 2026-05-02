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
