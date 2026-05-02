import type { Hex } from 'viem'

/**
 * Per ENSIP-26, the stealth-meta record is 66 raw bytes (132 hex chars):
 * the compressed (33-byte) spend pubkey followed by the compressed view pubkey.
 * Both pubkeys keep their 0x02/0x03 SEC1 prefix byte.
 */
const META_HEX_LEN = 2 + 132
const PUB_HEX_LEN = 2 + 66

/**
 * Strict format check: 0x-prefixed, exactly 132 hex chars after the prefix.
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
