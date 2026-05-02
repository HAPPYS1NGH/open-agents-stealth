import { createHash } from 'node:crypto'

/**
 * A parsed master key: 32 raw bytes plus a 4-byte `kid` (key id) derived from
 * sha256(rawBytes).slice(0, 4). The kid lets ciphertext rows declare which
 * key they were encrypted under, so multi-key rotation works.
 */
export interface MasterKey {
  rawBytes: Buffer
  kid: string
}

/**
 * Parses a 0x-prefixed 32-byte hex string into a MasterKey.
 * Throws on malformed input. Used by the api at boot time.
 */
export function parseMasterKey(hex: string): MasterKey {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('parseMasterKey: expected a 0x-prefixed 32-byte hex string')
  }
  const rawBytes = Buffer.from(hex.slice(2), 'hex')
  if (rawBytes.length !== 32) {
    throw new Error('parseMasterKey: master key must be exactly 32 bytes')
  }
  const kid = createHash('sha256').update(rawBytes).digest('hex').slice(0, 8)
  return { rawBytes, kid }
}
