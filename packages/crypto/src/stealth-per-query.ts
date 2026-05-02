import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { bytesToHex, getAddress } from 'viem'
import type { Address, Hex } from 'viem'
import { isStealthMetaAddress, splitMetaAddress } from './stealth-meta.js'

export interface PerQueryStealth {
  /** Checksummed 20-byte stealth EOA address. The gateway returns this as the addr() answer. */
  stealthAddress: Address
  /** 33-byte compressed ephemeral pubkey R = r·G. Persisted so the receiver can scan. */
  ephemeralPubKey: Hex
  /** First byte of keccak(s); receivers use this as a cheap pre-filter before full ECDH. */
  viewTag: number
}

export interface DeriveStealthOptions {
  /**
   * Override the ephemeral private key. ONLY for tests. Production callers
   * must omit this so a fresh CSPRNG key is generated per call.
   */
  ephemeralPrivKeyOverride?: `0x${string}`
}

/**
 * Generates a fresh ERC-5564 stealth address for a single CCIP-Read query.
 *
 *   1. r = random 32-byte priv (or override for tests).
 *   2. R = r·G (compressed) — the ephemeralPubKey.
 *   3. s = r·viewPub (compressed shared secret).
 *   4. h = keccak256(s without the SEC1 prefix byte).
 *   5. childPub = spendPub + h·G (point addition on secp256k1).
 *   6. stealthAddress = last 20 bytes of keccak256(childPub uncompressed XY).
 *   7. viewTag = h[0].
 */
export function deriveStealthForQuery(
  metaAddress: string,
  options: DeriveStealthOptions = {},
): PerQueryStealth {
  if (!isStealthMetaAddress(metaAddress)) {
    throw new Error('deriveStealthForQuery: not a 132-hex stealth meta-address')
  }
  const { spendPubKey, viewPubKey } = splitMetaAddress(metaAddress)

  const ephPrivBytes = options.ephemeralPrivKeyOverride
    ? hexToBytes32(options.ephemeralPrivKeyOverride)
    : secp256k1.utils.randomPrivateKey()
  if (ephPrivBytes.length !== 32) {
    throw new Error('deriveStealthForQuery: ephemeral priv must be 32 bytes')
  }

  const ephPubBytes = secp256k1.getPublicKey(ephPrivBytes, true)
  const ephemeralPubKey = bytesToHex(ephPubBytes) as Hex

  const sharedCompressed = secp256k1.getSharedSecret(
    ephPrivBytes,
    viewPubKey.slice(2),
    true,
  )
  const sharedXOnly = sharedCompressed.slice(1)
  const h = keccak_256(sharedXOnly)
  const viewTag = h[0]!

  const spendPoint = secp256k1.ProjectivePoint.fromHex(spendPubKey.slice(2))
  const hScalar = bytesToBigInt(h) % secp256k1.CURVE.n
  if (hScalar === 0n) {
    throw new Error('deriveStealthForQuery: degenerate scalar (h mod n == 0); retry')
  }
  const hPoint = secp256k1.ProjectivePoint.BASE.multiply(hScalar)
  const childPoint = spendPoint.add(hPoint)
  const childPubBytes = childPoint.toRawBytes(false)

  const childPubXY = childPubBytes.slice(1)
  const addrBytes = keccak_256(childPubXY).slice(-20)
  const stealthAddress = getAddress(`0x${Buffer.from(addrBytes).toString('hex')}`)

  return { stealthAddress, ephemeralPubKey, viewTag }
}

function hexToBytes32(hex: `0x${string}`): Uint8Array {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('hexToBytes32: expected 0x-prefixed 32-byte hex')
  }
  return Uint8Array.from(Buffer.from(hex.slice(2), 'hex'))
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  return n
}
