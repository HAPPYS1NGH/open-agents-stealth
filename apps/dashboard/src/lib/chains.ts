import { base } from 'wagmi/chains'
import { http } from 'viem'
import { createConfig } from 'wagmi'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'

const projectId = process.env['NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID']
if (!projectId) {
  console.warn('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set; WalletConnect will be disabled.')
}

const rpcUrl = process.env['NEXT_PUBLIC_BASE_RPC_URL'] ?? 'https://mainnet.base.org'

/**
 * Single wagmi config used by every component. We only support Base mainnet —
 * any wrong-chain state surfaces as a banner and a "switch network" button.
 */
export const wagmiConfig = getDefaultConfig({
  appName: 'Open Agents',
  projectId: projectId ?? 'placeholder-project-id-set-env-var',
  chains: [base],
  transports: {
    [base.id]: http(rpcUrl),
  },
  ssr: true,
}) as ReturnType<typeof createConfig>

export { base }
