import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verifies the `x-alchemy-signature` header against the raw request body.
 *
 * Alchemy signs the **raw bytes** of the body; verifying against a re-encoded
 * JSON string drops whitespace differences and breaks the check. The Hono
 * webhook handler reads the body via `c.req.text()` (string preserving the
 * exact bytes Alchemy sent) and passes it here unchanged.
 *
 * Returns true when the signature is valid; false otherwise. Uses
 * timingSafeEqual to thwart trivial timing attacks.
 */
export function verifyAlchemySignature(args: {
  rawBody: string
  signatureHeader: string | undefined
  secret: string
}): boolean {
  if (!args.signatureHeader) return false

  const computed = createHmac('sha256', args.secret).update(args.rawBody).digest('hex')
  const provided = args.signatureHeader.toLowerCase()

  if (computed.length !== provided.length) return false
  return timingSafeEqual(Buffer.from(computed, 'utf8'), Buffer.from(provided, 'utf8'))
}
