import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { env } from './env.js'
import { tickRoute } from './routes/tick.js'
import { webhookRoute } from './routes/webhook.js'

const app = new Hono()

app.get('/health', (c) => c.json({ ok: true, service: 'scanner' }))
app.route('/', tickRoute)
app.route('/', webhookRoute)

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  // Eagerly read env at boot so config errors surface immediately rather than
  // on the first request. The Proxy keeps tests lazy; this access fixes
  // production fail-loud behavior.
  void env.DATABASE_URL
  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`scanner listening on :${info.port}`)
  })
}

export default app
