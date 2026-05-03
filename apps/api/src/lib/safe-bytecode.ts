import { createPublicClient, http, type Address } from 'viem'
import { base } from 'viem/chains'

/**
 * Allowlisted Safe singletons on Base mainnet.
 *
 * Safe Protocol Kit v5 deploys v1.3.0-L2 by default; v1.4.1-L2 is the
 * canonical "current" release. Both are audited; either is fine for the
 * treasury role. We accept both so a Protocol-Kit upgrade doesn't silently
 * break treasury verification.
 *
 * Lowercase hex (no 0x), so `.has()` lookups don't have to re-checksum.
 */
const ALLOWED_SAFE_SINGLETONS_LC = new Set([
  '0xfb1bffc9d739b8d520daf37df666da4c687191ea', // Safe v1.3.0 L2
  '0x29fcb43b46531bca003ddc8fcb67ffe91900c762', // Safe v1.4.1 L2
])

/** Default lowercased singleton kept for backwards-compat with existing imports. */
export const SAFE_L2_SINGLETON_BASE: Address = '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762'

export interface SafeBytecodeCheckParams {
  rpcUrl: string
  safeAddress: Address
  /**
   * Optional override for the allowlist — pass a single address to require an
   * exact-match singleton. Mostly useful for tests; production callers omit.
   */
  expectedSingleton?: Address
}

export interface SafeBytecodeCheckResult {
  ok: boolean
  reason: string | null
}

/**
 * Confirms `safeAddress` is a deployed Safe proxy whose singleton (storage slot 0)
 * is in our allowlist of known-good Safe singletons on Base.
 *
 * Why storage-slot-0 instead of bytecode pattern matching: Safe doesn't deploy
 * EIP-1167 minimal proxies. It deploys SafeProxy.sol, a tiny Solidity contract
 * that stores the singleton in slot 0 (set by constructor) and DELEGATECALLs it
 * from fallback(). The runtime bytecode does NOT inline the singleton address,
 * so the only reliable way to read which logic contract a SafeProxy points at is
 * to read the storage slot it set in its constructor. This matches how the
 * SafeProxy itself resolves the singleton at runtime.
 */
export async function checkSafeBytecode(
  params: SafeBytecodeCheckParams,
): Promise<SafeBytecodeCheckResult> {
  const client = createPublicClient({
    chain: base,
    transport: http(params.rpcUrl, { timeout: 5_000 }),
  })

  let bytecode: `0x${string}` | undefined
  try {
    bytecode = await client.getCode({ address: params.safeAddress })
  } catch (err) {
    return { ok: false, reason: `getCode failed: ${String(err)}` }
  }

  if (!bytecode || bytecode === '0x') {
    return { ok: false, reason: 'no contract deployed at address' }
  }

  let slot0Hex: `0x${string}`
  try {
    slot0Hex = (await client.getStorageAt({
      address: params.safeAddress,
      slot: '0x0',
    })) as `0x${string}`
  } catch (err) {
    return { ok: false, reason: `getStorageAt(0x0) failed: ${String(err)}` }
  }
  if (!slot0Hex || slot0Hex === '0x' || slot0Hex.length !== 66) {
    return { ok: false, reason: `unexpected storage[0] shape: ${slot0Hex}` }
  }

  const singletonLc = ('0x' + slot0Hex.slice(-40).toLowerCase()) as `0x${string}`

  if (params.expectedSingleton) {
    if (singletonLc !== params.expectedSingleton.toLowerCase()) {
      return {
        ok: false,
        reason: `proxy points at ${singletonLc}, expected ${params.expectedSingleton.toLowerCase()}`,
      }
    }
    return { ok: true, reason: null }
  }

  if (!ALLOWED_SAFE_SINGLETONS_LC.has(singletonLc)) {
    return {
      ok: false,
      reason: `proxy points at unknown singleton ${singletonLc}; allowlist is {Safe v1.3.0-L2, v1.4.1-L2}`,
    }
  }

  return { ok: true, reason: null }
}

/**
 * Confirms the deploy tx is mined and successful.
 */
export async function checkSafeDeployTx(params: {
  rpcUrl: string
  txHash: `0x${string}`
}): Promise<{ ok: boolean; reason: string | null }> {
  const client = createPublicClient({
    chain: base,
    transport: http(params.rpcUrl, { timeout: 5_000 }),
  })
  try {
    const receipt = await client.getTransactionReceipt({ hash: params.txHash })
    if (receipt.status !== 'success') {
      return { ok: false, reason: `tx status is ${receipt.status}` }
    }
    return { ok: true, reason: null }
  } catch (err) {
    return { ok: false, reason: `getTransactionReceipt failed: ${String(err)}` }
  }
}
