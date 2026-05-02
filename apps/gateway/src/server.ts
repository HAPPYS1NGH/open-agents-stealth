import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { env } from './env.js'

const app = new Hono()

app.get('/health', (c) => c.json({ ok: true }))

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`gateway listening on :${info.port}`)
  })
}

export default app
