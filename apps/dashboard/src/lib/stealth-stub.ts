import { keccak256, type Hex } from 'viem'

/**
 * Fixed, domain-separated message that the wizard asks the owner EOA to sign.
 * MUST stay byte-identical between Plan 3 (stub) and Plan 4 (real derivation)
 * so that re-running the wizard regenerates the same keys.
 */
export const STEALTH_DERIVATION_MESSAGE =
  'gabhru.eth: derive stealth keys for agent on Base mainnet (v1)'

/**
 * Plan 3 PLACEHOLDER. Returns a 32-byte hex blob that is deterministic in the
 * input signature but is NOT a real ERC-5564 view private key. Plan 4 replaces
 * this with fluidkey-stealth-account-kit's generateKeysFromSignature.
 */
export function deriveViewKeyStub(signatureHex: string): Hex {
  if (!/^0x[0-9a-fA-F]+$/.test(signatureHex)) {
    throw new Error('deriveViewKeyStub: input must be 0x-prefixed hex')
  }
  return keccak256(signatureHex as Hex)
}

/**
 * Wraps the stub key in a `stub:` prefix so the backend can identify
 * placeholder rows during the Plan 4 migration.
 */
export function packStubViewKeyForApi(viewKeyHex: Hex): string {
  return `stub:${viewKeyHex}`
}
