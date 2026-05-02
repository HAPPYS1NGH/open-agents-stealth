import { describe, expect, it } from 'vitest'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import {
  STEALTH_DERIVATION_MESSAGE,
  deriveStealthKeysFromSignature,
} from '../src/stealth-derivation.js'

const TEST_PRIV = '0x' + '11'.repeat(32)

function eip191Hash(message: string): Uint8Array {
  const prefix = `\x19Ethereum Signed Message:\n${message.length}`
  const bytes = new TextEncoder().encode(prefix + message)
  return keccak_256(bytes)
}

function fakeSignature(priv: string, message: string): `0x${string}` {
  const sig = secp256k1.sign(eip191Hash(message), priv.slice(2))
  const r = sig.r.toString(16).padStart(64, '0')
  const s = sig.s.toString(16).padStart(64, '0')
  const v = (27 + (sig.recovery ?? 0)).toString(16).padStart(2, '0')
  return `0x${r}${s}${v}` as `0x${string}`
}

describe('STEALTH_DERIVATION_MESSAGE', () => {
  it('matches the Plan 3 string verbatim', () => {
    expect(STEALTH_DERIVATION_MESSAGE).toBe(
      'gabhru.eth: derive stealth keys for agent on Base mainnet (v1)',
    )
  })
})

describe('deriveStealthKeysFromSignature', () => {
  it('produces well-formed 32-byte priv keys and 33-byte compressed pubs', () => {
    const sig = fakeSignature(TEST_PRIV, STEALTH_DERIVATION_MESSAGE)
    const out = deriveStealthKeysFromSignature(sig)
    expect(out.spendPrivKey).toMatch(/^0x[0-9a-f]{64}$/)
    expect(out.viewPrivKey).toMatch(/^0x[0-9a-f]{64}$/)
    expect(out.spendPubKey).toMatch(/^0x[0-9a-f]{66}$/)
    expect(out.viewPubKey).toMatch(/^0x[0-9a-f]{66}$/)
    expect(out.stealthMetaAddress).toMatch(/^0x[0-9a-f]{132}$/)
  })

  it('is deterministic — same signature → same triple', () => {
    const sig = fakeSignature(TEST_PRIV, STEALTH_DERIVATION_MESSAGE)
    const a = deriveStealthKeysFromSignature(sig)
    const b = deriveStealthKeysFromSignature(sig)
    expect(a.spendPrivKey).toBe(b.spendPrivKey)
    expect(a.viewPrivKey).toBe(b.viewPrivKey)
    expect(a.stealthMetaAddress).toBe(b.stealthMetaAddress)
  })

  it('is signature-sensitive — different signatures → different triples', () => {
    const sigA = fakeSignature(TEST_PRIV, STEALTH_DERIVATION_MESSAGE)
    const sigB = fakeSignature('0x' + '22'.repeat(32), STEALTH_DERIVATION_MESSAGE)
    const a = deriveStealthKeysFromSignature(sigA)
    const b = deriveStealthKeysFromSignature(sigB)
    expect(a.spendPrivKey).not.toBe(b.spendPrivKey)
    expect(a.viewPrivKey).not.toBe(b.viewPrivKey)
    expect(a.stealthMetaAddress).not.toBe(b.stealthMetaAddress)
  })

  it('throws on a non-hex signature', () => {
    expect(() => deriveStealthKeysFromSignature('not-hex' as `0x${string}`)).toThrow()
  })

  it('throws on a too-short signature', () => {
    expect(() =>
      deriveStealthKeysFromSignature('0xdeadbeef' as `0x${string}`),
    ).toThrow()
  })

  it('the meta-address is exactly spendPub || viewPub (compressed)', () => {
    const sig = fakeSignature(TEST_PRIV, STEALTH_DERIVATION_MESSAGE)
    const out = deriveStealthKeysFromSignature(sig)
    const concat = (out.spendPubKey.slice(2) + out.viewPubKey.slice(2)).toLowerCase()
    expect(out.stealthMetaAddress.slice(2).toLowerCase()).toBe(concat)
  })
})
