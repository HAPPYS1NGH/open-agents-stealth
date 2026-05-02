import { Hono } from 'hono'
import { resolveRoute } from './routes/resolve.js'

const app = new Hono()

app.get('/health', (c) => c.json({ ok: true }))
app.route('/', resolveRoute)

export default app
