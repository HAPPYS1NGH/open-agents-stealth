import { parseAbiItem, type Address } from 'viem'

/**
 * Canonical Circle-issued USDC on Base mainnet.
 * https://basescan.org/token/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
 */
export const BASE_USDC_ADDRESS: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

/** USDC has 6 decimals; the dashboard formats display-side. */
export const BASE_USDC_DECIMALS = 6

/**
 * The single event ABI item the scanner cares about. Using parseAbiItem
 * keeps the bundle tiny — we never construct ERC-20 transfers, only decode them.
 */
export const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
)
