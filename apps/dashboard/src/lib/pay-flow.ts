import {
  decodeAbiParameters,
  namehash,
  parseUnits,
  type Address,
  type Hex,
} from 'viem'
import { ensReadClient } from './chains'
import { BASE_USDC_DECIMALS } from './usdc'

export interface ResolvedRecipient {
  /** Lowercased Safe address (where USDC is sent). */
  safeAddress: Address
  /** Lowercased EOA address (announced via ERC-5564). */
  stealthEoa: Address
  /** Compressed secp256k1 ephemeral pubkey (33 bytes). */
  ephemeralPub: Hex
  /** ERC-5564 view tag byte. */
  viewTag: number
}

/**
 * Resolves an `<label>.gabhru.eth` name into the four pieces the sender
 * needs. Two ENS queries: getEnsAddress (Safe address from gateway addr())
 * and getEnsText with key="stealth-payload" (eoa, ephemeralPub, viewTag).
 *
 * Both queries route through our gateway via universal-resolver CCIP-Read.
 * The Plan 5 stable-cycle semantic guarantees both reads return the same
 * issuance row.
 */
export async function resolveRecipient(name: string): Promise<ResolvedRecipient> {
  const safeAddress = await ensReadClient.getEnsAddress({ name })
  if (!safeAddress) throw new Error(`No safe address for ${name}`)

  const payloadHex = await ensReadClient.getEnsText({
    name,
    key: 'stealth-payload',
  })
  if (!payloadHex || payloadHex === '0x') {
    throw new Error(`No stealth-payload record for ${name}`)
  }

  const [stealthEoa, ephemeralPub, viewTag] = decodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint8' }],
    payloadHex as Hex,
  ) as [Address, Hex, number]

  return {
    safeAddress: safeAddress.toLowerCase() as Address,
    stealthEoa: stealthEoa.toLowerCase() as Address,
    ephemeralPub,
    viewTag,
  }
}

/**
 * Converts a human USDC amount ("5.50") to a uint256 raw value (5_500_000n).
 * Throws on negative or non-numeric input.
 */
export function parseUsdcInput(input: string): bigint {
  const cleaned = input.trim()
  if (!/^\d+(\.\d{1,6})?$/.test(cleaned)) {
    throw new Error('Amount must be a decimal with up to 6 places')
  }
  return parseUnits(cleaned, BASE_USDC_DECIMALS)
}

/**
 * Wraps the view-tag byte as a 1-byte `bytes` for the announce metadata arg.
 * ERC-5564 explicitly allows the metadata to be the view-tag prefix.
 */
export function viewTagAsMetadata(viewTag: number): Hex {
  if (viewTag < 0 || viewTag > 255) {
    throw new Error('viewTag must fit in a single byte')
  }
  return ('0x' + viewTag.toString(16).padStart(2, '0')) as Hex
}

/** Computed namehash, exposed for tests. */
export function nodeOf(name: string): Hex {
  return namehash(name)
}
