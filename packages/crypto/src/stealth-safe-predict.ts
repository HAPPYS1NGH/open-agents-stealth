import { predictStealthSafeAddressWithBytecode } from '@fluidkey/stealth-account-kit'
import type { Address, Hex } from 'viem'

/**
 * Canonical SafeProxy v1.3.0 creation bytecode.
 *
 * Read once from `SafeProxyFactory.proxyCreationCode()` at
 * `0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2` on Base mainnet (the same
 * factory address @safe-global/safe-deployments lists for v1.3.0). The
 * bytecode is identical across every chain that hosts SafeProxyFactory v1.3.0,
 * so embedding it as a constant is safe — if Safe ever ships a different
 * runtime under the same factory, every previously-predicted address would
 * relocate, which would surface immediately in the announcement → scanner
 * round-trip.
 */
export const SAFE_PROXY_CREATION_CODE_V1_3_0: Hex =
  '0x608060405234801561001057600080fd5b506040516101e63803806101e68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505060ab806101196000396000f3fe608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea2646970667358221220d1429297349653a4918076d650332de1a1068c5f3e07c5c82360c277770b955264736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564'

export interface PredictStealthSafeOptions {
  /** Defaults to Base mainnet (8453). */
  chainId?: number
}

/**
 * Predicts the CREATE2 address of a 1-of-1 Safe v1.3.0 owned by `stealthEoa`.
 *
 * The Safe is NOT deployed by this call — it just computes where it WILL be
 * once someone calls `SafeProxyFactory.createProxyWithNonce(...)` with the
 * same args. USDC/ETH transferred to this address sit there idle until the
 * Safe is materialized; the spec's sweep flow deploys the Safe and executes
 * the transfer in a single user-op.
 *
 * Why v1.3.0: matches the default version `@safe-global/protocol-kit` v5
 * deploys for the treasury, so all Safes in the system speak the same ABI.
 *
 * Sync: relies on a hardcoded creation-bytecode constant + CREATE2 math, no
 * RPC call. Suitable for the gateway hot path (sub-millisecond).
 */
export function predictStealthSafeAddress(
  stealthEoa: Address,
  options: PredictStealthSafeOptions = {},
): Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(stealthEoa)) {
    throw new Error('predictStealthSafeAddress: stealthEoa must be 20-byte hex address')
  }
  const { stealthSafeAddress } = predictStealthSafeAddressWithBytecode({
    safeProxyBytecode: SAFE_PROXY_CREATION_CODE_V1_3_0,
    threshold: 1,
    stealthAddresses: [stealthEoa],
    chainId: options.chainId ?? 8453,
    safeVersion: '1.3.0',
  })
  return stealthSafeAddress as Address
}
