import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { env } from './env.js'

const app = new Hono()

app.get('/health', (c) => c.json({ ok: true, service: 'scanner' }))

// Routes wired in subsequent tasks (Task 5: /tick, Task 6: /webhook).

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`scanner listening on :${info.port}`)
  })
}

export default app
