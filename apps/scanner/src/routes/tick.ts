import { Hono } from 'hono'
import { env } from '../env.js'
import { getRpcClient } from '../lib/rpc.js'
import { runTick } from '../lib/run-tick.js'

export const tickRoute = new Hono()

/**
 * Per Vercel docs, the cron-injected header is `Authorization: Bearer
 * ${process.env.CRON_SECRET}`. Local dev (NODE_ENV !== 'production') with
 * CRON_SECRET unset short-circuits the guard so `curl localhost:3002/tick`
 * just works. In production, an unset CRON_SECRET REJECTS every request —
 * a deploy that forgets the secret should fail closed, not open the cron
 * endpoint to the world.
 */
function isAuthorized(authHeader: string | undefined): boolean {
  if (!env.CRON_SECRET) {
    if (process.env['NODE_ENV'] === 'production') return false
    return true
  }
  if (!authHeader) return false
  return authHeader === `Bearer ${env.CRON_SECRET}`
}

tickRoute.post('/tick', async (c) => {
  if (!isAuthorized(c.req.header('Authorization'))) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  if (env.SCANNER_RPC === 'off') {
    // Test mode — the cron shell still executes but skips the network call.
    return c.json({
      scannedAt: new Date().toISOString(),
      currentBlock: '0',
      agentsScanned: 0,
      perAgent: [],
      note: 'SCANNER_RPC=off — RPC disabled',
    })
  }

  const result = await runTick({ client: getRpcClient() })
  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'tick complete',
      scannedAt: result.scannedAt,
      agentsScanned: result.agentsScanned,
      totalInserted: result.perAgent.reduce((n, p) => n + p.reconcile.inserted, 0),
    }),
  )
  return c.json(result)
})

// Vercel Cron also accepts GET (some integrations probe with GET first).
tickRoute.get('/tick', async (c) => {
  return c.json({ ok: true, hint: 'POST to actually run the scan' })
})
