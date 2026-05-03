import { z } from 'zod'
import { env } from './env.js'
import { getRpcClient } from './lib/rpc.js'
import { runTick } from './lib/run-tick.js'

const workerEnvSchema = z.object({
  SCANNER_WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  SCANNER_WORKER_JITTER_MS: z.coerce.number().int().min(0).default(2_000),
})
const workerEnv = workerEnvSchema.parse(process.env)

let stopping = false

function jitter(): number {
  return Math.floor(Math.random() * workerEnv.SCANNER_WORKER_JITTER_MS)
}

async function loop(): Promise<void> {
  while (!stopping) {
    const startedAt = Date.now()
    try {
      const result = await runTick({ client: getRpcClient() })
      const inserted = result.perAgent.reduce((n, p) => n + p.reconcile.inserted, 0)
      console.log(
        JSON.stringify({
          level: 'info',
          msg: 'worker tick',
          agents: result.agentsScanned,
          inserted,
          tookMs: Date.now() - startedAt,
        }),
      )
    } catch (err) {
      console.error(
        JSON.stringify({ level: 'error', msg: 'worker tick failed', err: String(err) }),
      )
    }
    if (stopping) break
    const sleepMs = workerEnv.SCANNER_WORKER_INTERVAL_MS + jitter()
    await new Promise<void>((resolve) => setTimeout(resolve, sleepMs))
  }
  console.log('[worker] shut down cleanly')
}

function installSignalHandlers(): void {
  const handler = (sig: NodeJS.Signals) => {
    console.log(`[worker] received ${sig}, draining…`)
    stopping = true
  }
  process.once('SIGINT', handler)
  process.once('SIGTERM', handler)
}

if (process.argv[1]?.endsWith('worker.ts') || process.argv[1]?.endsWith('worker.js')) {
  installSignalHandlers()
  console.log(`[worker] starting; interval=${workerEnv.SCANNER_WORKER_INTERVAL_MS}ms`)
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  loop()
}

export const __test__ = { loop, requestStopForTest: () => (stopping = true) }
// `env` reference keeps the import meaningful even if loop() shape evolves.
void env
