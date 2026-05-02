import { describe, expect, it } from 'vitest'
import {
  isStealthMetaAddress,
  splitMetaAddress,
  buildMetaAddress,
} from '../src/stealth-meta.js'

const SPEND_PUB = '0x02' + 'aa'.repeat(32)
const VIEW_PUB = '0x03' + 'bb'.repeat(32)
const META = '0x' + SPEND_PUB.slice(2) + VIEW_PUB.slice(2)

describe('isStealthMetaAddress', () => {
  it('accepts 132-hex addresses', () => {
    expect(isStealthMetaAddress(META)).toBe(true)
  })

  it('rejects wrong-length hex', () => {
    expect(isStealthMetaAddress('0x' + 'aa'.repeat(33))).toBe(false)
  })

  it('rejects missing 0x prefix', () => {
    expect(isStealthMetaAddress(META.slice(2))).toBe(false)
  })

  it('rejects non-hex characters', () => {
    expect(isStealthMetaAddress('0x' + 'ZZ'.repeat(66))).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isStealthMetaAddress('')).toBe(false)
  })
})

describe('splitMetaAddress', () => {
  it('returns spend + view halves with 33-byte compressed prefix preserved', () => {
    const out = splitMetaAddress(META)
    expect(out.spendPubKey).toBe(SPEND_PUB)
    expect(out.viewPubKey).toBe(VIEW_PUB)
  })

  it('throws on a malformed meta-address', () => {
    expect(() => splitMetaAddress('0xdeadbeef')).toThrow()
  })
})

describe('buildMetaAddress', () => {
  it('round-trips with splitMetaAddress', () => {
    const built = buildMetaAddress(SPEND_PUB, VIEW_PUB)
    expect(built).toBe(META)
    expect(splitMetaAddress(built)).toEqual({
      spendPubKey: SPEND_PUB,
      viewPubKey: VIEW_PUB,
    })
  })

  it('rejects non-33-byte pubkeys', () => {
    expect(() => buildMetaAddress('0xaa', VIEW_PUB)).toThrow()
    expect(() => buildMetaAddress(SPEND_PUB, '0xbb')).toThrow()
  })
})
