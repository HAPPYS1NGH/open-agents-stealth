import { describe, expect, it } from 'vitest'
import { secp256k1 } from '@noble/curves/secp256k1'
import { bytesToHex, isAddress } from 'viem'
import { deriveStealthForQuery } from '../src/stealth-per-query.js'
import { buildMetaAddress } from '../src/stealth-meta.js'

const SPEND_PRIV = '0x' + '11'.repeat(32)
const VIEW_PRIV = '0x' + '22'.repeat(32)
const SPEND_PUB = bytesToHex(secp256k1.getPublicKey(SPEND_PRIV.slice(2), true))
const VIEW_PUB = bytesToHex(secp256k1.getPublicKey(VIEW_PRIV.slice(2), true))
const META = buildMetaAddress(SPEND_PUB, VIEW_PUB)

describe('deriveStealthForQuery', () => {
  it('returns a 20-byte EVM address, a 33-byte ephemeral pubkey, and a view tag byte', () => {
    const out = deriveStealthForQuery(META)
    expect(isAddress(out.stealthAddress)).toBe(true)
    expect(out.ephemeralPubKey).toMatch(/^0x[0-9a-f]{66}$/)
    expect(out.viewTag).toBeGreaterThanOrEqual(0)
    expect(out.viewTag).toBeLessThanOrEqual(255)
  })

  it('returns a different stealth address on each call (fresh ephemeral key)', () => {
    const a = deriveStealthForQuery(META)
    const b = deriveStealthForQuery(META)
    expect(a.stealthAddress).not.toBe(b.stealthAddress)
    expect(a.ephemeralPubKey).not.toBe(b.ephemeralPubKey)
  })

  it('throws on a malformed meta-address', () => {
    expect(() => deriveStealthForQuery('0xdeadbeef')).toThrow()
    expect(() => deriveStealthForQuery('not-hex')).toThrow()
  })

  it('is deterministic when given an explicit ephemeral key (used by tests)', () => {
    const ephPriv = '0x' + 'cd'.repeat(32)
    const a = deriveStealthForQuery(META, { ephemeralPrivKeyOverride: ephPriv })
    const b = deriveStealthForQuery(META, { ephemeralPrivKeyOverride: ephPriv })
    expect(a.stealthAddress).toBe(b.stealthAddress)
    expect(a.ephemeralPubKey).toBe(b.ephemeralPubKey)
    expect(a.viewTag).toBe(b.viewTag)
  })

  it('shared secret matches sender-side and receiver-side (ECDH consistency)', () => {
    const ephPriv = '0x' + 'ee'.repeat(32)
    const out = deriveStealthForQuery(META, { ephemeralPrivKeyOverride: ephPriv })

    const sharedFromReceiver = secp256k1.getSharedSecret(
      VIEW_PRIV.slice(2),
      out.ephemeralPubKey.slice(2),
      true,
    )
    const sharedFromSender = secp256k1.getSharedSecret(
      ephPriv.slice(2),
      VIEW_PUB.slice(2),
      true,
    )
    expect(bytesToHex(sharedFromReceiver).toLowerCase()).toBe(
      bytesToHex(sharedFromSender).toLowerCase(),
    )
  })
})
