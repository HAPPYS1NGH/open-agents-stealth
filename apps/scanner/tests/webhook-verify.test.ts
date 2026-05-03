import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyAlchemySignature } from '../src/lib/webhook-verify.js'

const SECRET = '0123456789abcdef0123456789abcdef'

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex')
}

describe('verifyAlchemySignature', () => {
  it('returns true for a correctly-signed body', () => {
    const body = '{"type":"ADDRESS_ACTIVITY","webhookId":"wh_42"}'
    expect(
      verifyAlchemySignature({ rawBody: body, signatureHeader: sign(body), secret: SECRET }),
    ).toBe(true)
  })

  it('is case-insensitive on the signature header', () => {
    const body = '{"x":1}'
    expect(
      verifyAlchemySignature({
        rawBody: body,
        signatureHeader: sign(body).toUpperCase(),
        secret: SECRET,
      }),
    ).toBe(true)
  })

  it('returns false on body tampering', () => {
    const body = '{"x":1}'
    expect(
      verifyAlchemySignature({
        rawBody: '{"x":2}',
        signatureHeader: sign(body),
        secret: SECRET,
      }),
    ).toBe(false)
  })

  it('returns false when signatureHeader is undefined', () => {
    expect(
      verifyAlchemySignature({
        rawBody: '{}',
        signatureHeader: undefined,
        secret: SECRET,
      }),
    ).toBe(false)
  })

  it('returns false on length mismatch (no timing leak via length)', () => {
    expect(
      verifyAlchemySignature({
        rawBody: '{}',
        signatureHeader: 'abc',
        secret: SECRET,
      }),
    ).toBe(false)
  })
})
