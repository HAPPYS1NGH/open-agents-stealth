import Safe, { type SafeAccountConfig, type SafeDeploymentConfig } from '@safe-global/protocol-kit'
import type { WalletClient } from 'viem'

export interface DeployTreasuryParams {
  walletClient: WalletClient
  ownerEoa: `0x${string}`
}

export interface DeployTreasuryResult {
  safeAddress: `0x${string}`
  deployTxHash: `0x${string}`
}

/**
 * Deploys a 1-of-1 Safe owned by `ownerEoa` on the chain configured in
 * `walletClient`. Returns the Safe's address and the deployment tx hash.
 *
 * Uses Safe Protocol Kit's `Safe.init({ provider, signer, predictedSafe })`
 * + `createSafeDeploymentTransaction` flow. The walletClient sends the tx
 * via wagmi's underlying transport so the user sees it in their wallet.
 */
export async function deployTreasurySafe(
  params: DeployTreasuryParams,
): Promise<DeployTreasuryResult> {
  const { walletClient, ownerEoa } = params

  const safeAccountConfig: SafeAccountConfig = {
    owners: [ownerEoa],
    threshold: 1,
  }

  const safeDeploymentConfig: SafeDeploymentConfig = {
    saltNonce: BigInt(Date.now()).toString(),
  }

  const provider = walletClient.transport as unknown as {
    request: (args: { method: string; params?: unknown }) => Promise<unknown>
  }

  const protocolKit = await Safe.init({
    provider: provider as never,
    signer: ownerEoa,
    predictedSafe: {
      safeAccountConfig,
      safeDeploymentConfig,
    },
  })

  const deploymentTx = await protocolKit.createSafeDeploymentTransaction()
  const predictedAddress = (await protocolKit.getAddress()) as `0x${string}`

  const txHash = await walletClient.sendTransaction({
    account: ownerEoa,
    to: deploymentTx.to as `0x${string}`,
    data: deploymentTx.data as `0x${string}`,
    value: BigInt(deploymentTx.value ?? 0),
    chain: walletClient.chain,
  })

  return {
    safeAddress: predictedAddress,
    deployTxHash: txHash as `0x${string}`,
  }
}
