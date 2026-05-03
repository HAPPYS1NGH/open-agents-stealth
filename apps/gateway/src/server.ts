import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { resolveRoute } from './routes/resolve.js'

const app = new Hono()

// Open CORS — the gateway is a public CCIP-Read endpoint. Browsers
// (ens.domains, our dashboard's viem getEnsAddress, anyone integrating
// gabhru.eth) need to follow the OffchainLookup from the universal
// resolver back to this URL, which the same-origin rule blocks without
// these headers.
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}))

app.get('/health', (c) => c.json({ ok: true }))
app.route('/', resolveRoute)

export default app
