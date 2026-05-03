import type { IncomingMessage, ServerResponse } from 'http'
import app from '../src/server.js'

export const config = {
  runtime: 'nodejs',
}

/**
 * Manual Vercel-Node adapter for Hono.
 *
 * The default `@hono/node-server/vercel` adapter wraps the incoming request
 * body in a ReadableStream that listens for stream `end` events. On Vercel's
 * Node Function runtime the body is buffered eagerly and `end` never fires,
 * which hangs every POST handler that calls `c.req.json()` until the 15s
 * function timeout. Symptom in logs: "Failed to find Response internal state
 * key" + 504 timeouts on routes that use a JSON body.
 *
 * We sidestep it by reading the body to a Buffer ourselves, then handing
 * Hono a fully-realized Web Request. Response is then streamed back chunk-
 * by-chunk so we don't reintroduce the same state-key issue on the way out.
 */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? 'localhost'
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'https'
  const url = `${proto}://${host}${req.url ?? '/'}`

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v)
    } else {
      headers.set(key, String(value))
    }
  }

  const method = req.method ?? 'GET'
  const init: RequestInit = { method, headers }
  if (method !== 'GET' && method !== 'HEAD') {
    const body = await readBody(req)
    if (body.length > 0) {
      init.body = body
    }
  }

  const response = await app.fetch(new Request(url, init))

  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })

  if (response.body) {
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) res.write(value)
    }
  }
  res.end()
}
