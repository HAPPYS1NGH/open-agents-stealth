import { parseAbi, type Address } from 'viem'

/** ERC-5564 Announcer on Base mainnet (per spec §5.2). */
export const ERC5564_ANNOUNCER_ADDRESS: Address =
  '0x55649E01B5Df198D18D95b5cc5051630cfD45564'

export const announcerAbi = parseAbi([
  'function announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata)',
])

/** Scheme 1 = secp256k1 / SECP256K1_KECCAK_256 per ERC-5564. */
export const STEALTH_SCHEME_ID = 1n
