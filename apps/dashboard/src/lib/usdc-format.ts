const USDC_DECIMALS = 6n

/**
 * Formats a uint256-as-string USDC amount as a comma-separated decimal:
 *   "5000000"   -> "5.00 USDC"
 *   "12345678"  -> "12.35 USDC" (rounded half-up at 2 decimals)
 *   "999000000" -> "999.00 USDC"
 *
 * Deterministic across SSR/CSR (no Intl, no locale lookups).
 */
export function formatUsdc(rawAmount: string): string {
  const big = BigInt(rawAmount)
  const integer = big / 10n ** USDC_DECIMALS
  const fraction = big % 10n ** USDC_DECIMALS
  // 6 decimals → keep 2 places; round half-up by adding 5_000 before truncating.
  const rounded = (fraction + 5_000n) / 10_000n
  const fracStr = rounded.toString().padStart(2, '0').slice(0, 2)
  const intStr = integer.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${intStr}.${fracStr} USDC`
}

/** Truncates a 0x-hex address for display: 0xaaaa…aaaa. */
export function shortAddr(addr: string): string {
  if (!addr.startsWith('0x') || addr.length < 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/** Truncates a tx hash similarly: 0xcdcdcdcd…cd. */
export function shortTx(hash: string): string {
  if (!hash.startsWith('0x') || hash.length < 14) return hash
  return `${hash.slice(0, 10)}…${hash.slice(-2)}`
}

/** Returns a "x seconds ago" string from an ISO timestamp. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
