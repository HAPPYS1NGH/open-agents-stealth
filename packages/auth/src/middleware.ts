import type { Context, MiddlewareHandler, Next } from 'hono'
import { verifyJwt, type JwtClaims } from './jwt.js'

declare module 'hono' {
  interface ContextVariableMap {
    jwtClaims: JwtClaims
  }
}

/**
 * Hono middleware that reads a Bearer token from the Authorization header,
 * verifies it with verifyJwt, and stores the claims in `c.var.jwtClaims`.
 * Returns 401 if the header is missing or the token fails verification.
 *
 * Usage:
 *   app.use('/me', jwtMiddleware(env.JWT_SECRET))
 */
export function jwtMiddleware(secret: string): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or malformed Authorization header' }, 401)
    }
    const token = authHeader.slice(7)
    try {
      const claims = await verifyJwt({ token, secret })
      c.set('jwtClaims', claims)
      await next()
    } catch {
      return c.json({ error: 'Invalid or expired token' }, 401)
    }
  }
}
