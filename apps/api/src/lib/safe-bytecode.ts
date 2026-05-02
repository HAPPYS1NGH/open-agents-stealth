import { createPublicClient, http, type Address } from 'viem'
import { base } from 'viem/chains'

/** Safe v1.4.1-L2 singleton on Base mainnet. */
export const SAFE_L2_SINGLETON_BASE: Address = '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762'

/**
 * Safe minimal proxy runtime bytecode is a fixed shape:
 * `0x363d3d373d3d3d363d73<singleton>5af43d82803e903d91602b57fd5bf3`
 */
export const SAFE_PROXY_RUNTIME_PREFIX = '0x363d3d373d3d3d363d73'.toLowerCase()
export const SAFE_PROXY_RUNTIME_SUFFIX = '5af43d82803e903d91602b57fd5bf3'.toLowerCase()

export interface SafeBytecodeCheckParams {
  rpcUrl: string
  safeAddress: Address
  expectedSingleton?: Address
}

export interface SafeBytecodeCheckResult {
  ok: boolean
  reason: string | null
}

/**
 * Reads runtime code at safeAddress and confirms it's a Safe proxy pointing
 * at expectedSingleton. Returns { ok: false, reason } on any mismatch.
 */
export async function checkSafeBytecode(
  params: SafeBytecodeCheckParams,
): Promise<SafeBytecodeCheckResult> {
  const expectedSingleton = (params.expectedSingleton ?? SAFE_L2_SINGLETON_BASE).toLowerCase()
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

  const lower = bytecode.toLowerCase()
  if (!lower.startsWith(SAFE_PROXY_RUNTIME_PREFIX)) {
    return { ok: false, reason: 'bytecode does not start with Safe proxy prefix' }
  }
  if (!lower.endsWith(SAFE_PROXY_RUNTIME_SUFFIX)) {
    return { ok: false, reason: 'bytecode does not end with Safe proxy suffix' }
  }

  const singletonStart = SAFE_PROXY_RUNTIME_PREFIX.length
  const singletonHex = '0x' + lower.slice(singletonStart, singletonStart + 40)
  if (singletonHex !== expectedSingleton) {
    return {
      ok: false,
      reason: `proxy points at ${singletonHex}, expected ${expectedSingleton}`,
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
