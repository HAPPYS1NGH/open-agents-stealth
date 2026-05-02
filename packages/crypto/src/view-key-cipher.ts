import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import type { MasterKey } from './master-key.js'

/**
 * Stored as `v1:<base64(JSON(envelope))>` in agents.view_key_encrypted.
 */
export interface CiphertextEnvelope {
  v: 1
  kid: string
  iv: string
  tag: string
  ct: string
}

const PREFIX = 'v1:'
const ALGORITHM = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

/**
 * Encrypts a 0x-prefixed view private key (or any string secret) with the
 * supplied master key. Returns a `v1:`-prefixed ciphertext envelope.
 * Each call generates a fresh 96-bit IV; GCM auth tag rejects tampering.
 */
export function encryptViewKey(plaintext: string, masterKey: MasterKey): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encryptViewKey: plaintext must be a non-empty string')
  }
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGORITHM, masterKey.rawBytes, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  if (tag.length !== TAG_LEN) {
    throw new Error('encryptViewKey: unexpected auth tag length')
  }
  const env: CiphertextEnvelope = {
    v: 1,
    kid: masterKey.kid,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
  }
  return PREFIX + Buffer.from(JSON.stringify(env)).toString('base64')
}

/**
 * Decrypts a v1 ciphertext envelope. Throws on missing prefix, kid mismatch,
 * or failed GCM auth tag verification.
 */
export function decryptViewKey(blob: string, masterKey: MasterKey): string {
  const env = parseEnvelope(blob)
  if (env.kid !== masterKey.kid) {
    throw new Error(`decryptViewKey: kid mismatch (envelope=${env.kid}, master=${masterKey.kid})`)
  }
  const iv = Buffer.from(env.iv, 'base64')
  const tag = Buffer.from(env.tag, 'base64')
  const ct = Buffer.from(env.ct, 'base64')
  if (iv.length !== IV_LEN) throw new Error('decryptViewKey: bad iv length')
  if (tag.length !== TAG_LEN) throw new Error('decryptViewKey: bad tag length')
  const decipher = createDecipheriv(ALGORITHM, masterKey.rawBytes, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString('utf8')
}

/**
 * Parses a `v1:`-prefixed base64 envelope. Exposed for test fixtures + the
 * Plan 5 scanner that wants to inspect `kid` without decrypting.
 */
export function parseEnvelope(blob: string): CiphertextEnvelope {
  if (typeof blob !== 'string' || !blob.startsWith(PREFIX)) {
    throw new Error('parseEnvelope: missing v1: prefix')
  }
  const json = Buffer.from(blob.slice(PREFIX.length), 'base64').toString('utf8')
  const env = JSON.parse(json) as CiphertextEnvelope
  if (env.v !== 1) throw new Error(`parseEnvelope: unsupported version ${env.v}`)
  return env
}

/**
 * Cheap, side-effect-free predicate. Distinguishes Plan 3 `stub:` rows from
 * Plan 4 ciphertext.
 */
export function isCiphertextEnvelope(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX)
}
