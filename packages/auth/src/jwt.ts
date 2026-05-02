import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

const DEFAULT_TTL_SECONDS = 15 * 60

export interface JwtClaims extends JWTPayload {
  sub: string
  ownerEoa?: string
}

export interface MintJwtParams {
  /** The authenticated wallet address (owner EOA). Used as `sub`. */
  sub: string
  /** The owner EOA address (mirrored into custom claim for convenience). */
  ownerEoa?: string
  /** JWT signing secret string. Must be ≥32 bytes for HS256. */
  secret: string
  /** Token TTL in seconds. Defaults to 900 (15 min). */
  ttlSeconds?: number
}

export interface VerifyJwtParams {
  token: string
  secret: string
}

/**
 * Mints a signed HS256 JWT. The subject is the owner EOA address.
 * TTL defaults to 15 minutes. The /me endpoint issues a fresh token
 * on each successful request to implement rolling expiry.
 */
export async function mintJwt(params: MintJwtParams): Promise<string> {
  const secret = new TextEncoder().encode(params.secret)
  const ttl = params.ttlSeconds ?? DEFAULT_TTL_SECONDS
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ ownerEoa: params.ownerEoa ?? params.sub })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(params.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(secret)
}

/**
 * Verifies a JWT and returns its claims. Throws if invalid, tampered, or expired.
 */
export async function verifyJwt(params: VerifyJwtParams): Promise<JwtClaims> {
  const secret = new TextEncoder().encode(params.secret)
  const { payload } = await jwtVerify(params.token, secret, { algorithms: ['HS256'] })
  if (!payload.sub) throw new Error('JWT missing sub claim')
  return payload as JwtClaims
}
