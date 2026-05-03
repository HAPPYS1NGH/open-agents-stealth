import { base, mainnet } from 'wagmi/chains'
import { createPublicClient, http } from 'viem'
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

/**
 * One-off read-only client used by the sender console (`/pay/[ens]`) for
 * ENS lookups via the universal resolver. ENS lives on Ethereum mainnet;
 * the visitor's connected wallet stays on Base for the writes, so we keep
 * mainnet OFF the wagmi chain list — adding it would prompt RainbowKit to
 * surface a chain-switch UI mid-payment.
 */
// Cloudflare's eth-rpc is the most browser-reliable default (good CORS,
// no rate-limit on light usage, no API key needed). Override via
// NEXT_PUBLIC_MAINNET_RPC_URL for higher-volume traffic (Alchemy/Infura).
const mainnetRpc =
  process.env['NEXT_PUBLIC_MAINNET_RPC_URL'] ?? 'https://cloudflare-eth.com'

export const ensReadClient = createPublicClient({
  chain: mainnet,
  transport: http(mainnetRpc),
})
