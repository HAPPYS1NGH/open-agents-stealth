import { generateKeysFromSignature } from '@fluidkey/stealth-account-kit'
import { secp256k1 } from '@noble/curves/secp256k1'
import { bytesToHex } from 'viem'
import type { Hex } from 'viem'
import { buildMetaAddress } from './stealth-meta.js'

/**
 * Fixed, domain-separated message that the wizard asks the owner EOA to sign.
 * MUST stay byte-identical to the Plan 3 string so re-running the wizard with
 * Plan 4 regenerates keys for an existing agent.
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
 * Deterministically derives the agent's stealth key pair and meta-address from
 * a single EIP-191 signature over STEALTH_DERIVATION_MESSAGE.
 *
 * Wraps Fluidkey's audited generateKeysFromSignature, then computes compressed
 * pubkeys via @noble/curves/secp256k1 and assembles per ENSIP-26.
 */
export function deriveStealthKeysFromSignature(
  signature: `0x${string}`,
): DerivedStealthKeys {
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new Error('deriveStealthKeysFromSignature: signature must be 0x-prefixed hex')
  }
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
