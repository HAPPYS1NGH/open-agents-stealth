import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { env } from './env.js'
import { createDb } from '@open-agents/db'
import { authRoute } from './routes/auth.js'
import { meRoute } from './routes/me.js'
import { agentsRoute } from './routes/agents.js'
import { paymentsStreamRoute } from './routes/payments-stream.js'

const app = new Hono()

app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'] }))
app.get('/health', (c) => c.json({ ok: true, service: 'api' }))

app.route('/', authRoute)
app.route('/', meRoute)
app.route('/', agentsRoute)
app.route('/', paymentsStreamRoute)

export const db = createDb(env.DATABASE_URL)

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`api listening on :${info.port}`)
  })
}

export default app
