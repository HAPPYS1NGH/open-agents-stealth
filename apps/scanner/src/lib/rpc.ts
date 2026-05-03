import { createPublicClient, http } from 'viem'
import { base } from 'viem/chains'
import { env } from '../env.js'

// viem's createPublicClient returns a deeply-typed shape that fights with
// our explicit `PublicClient<…>` annotations (the chain generic creates
// "two different types with this name" errors). We let inference do the
// right thing and export the inferred type.
let cached: ReturnType<typeof makeClient> | null = null

function makeClient() {
  return createPublicClient({
    chain: base,
    transport: http(env.BASE_RPC_URL),
  })
}

/**
 * Returns a memoized viem PublicClient for Base mainnet. Memoization keeps
 * the http transport's connection-pool warm across cron invocations on the
 * same Vercel function instance.
 */
export function getRpcClient(): ReturnType<typeof makeClient> {
  if (!cached) cached = makeClient()
  return cached
}

/** Test-only — resets the cached client so vi.mock'd transports take effect. */
export function resetRpcClientForTest(): void {
  cached = null
}
