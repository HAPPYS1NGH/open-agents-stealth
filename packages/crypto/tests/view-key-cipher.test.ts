import { describe, expect, it } from 'vitest'
import {
  encryptViewKey,
  decryptViewKey,
  parseEnvelope,
  isCiphertextEnvelope,
} from '../src/view-key-cipher.js'
import { parseMasterKey } from '../src/master-key.js'

const MK = '0x' + 'aa'.repeat(32)
const masterKey = parseMasterKey(MK)
const VIEW_KEY = '0x' + 'cd'.repeat(32)

describe('encryptViewKey / decryptViewKey round trip', () => {
  it('decrypts to the same plaintext', () => {
    const ct = encryptViewKey(VIEW_KEY, masterKey)
    const pt = decryptViewKey(ct, masterKey)
    expect(pt).toBe(VIEW_KEY)
  })

  it('produces a different ciphertext on each call (random IV)', () => {
    const a = encryptViewKey(VIEW_KEY, masterKey)
    const b = encryptViewKey(VIEW_KEY, masterKey)
    expect(a).not.toBe(b)
  })

  it('starts with the v1: prefix', () => {
    const ct = encryptViewKey(VIEW_KEY, masterKey)
    expect(ct.startsWith('v1:')).toBe(true)
  })

  it('decrypt fails with a wrong master key', () => {
    const ct = encryptViewKey(VIEW_KEY, masterKey)
    const wrong = parseMasterKey('0x' + 'bb'.repeat(32))
    expect(() => decryptViewKey(ct, wrong)).toThrow()
  })

  it('decrypt fails on tampered ciphertext (auth tag rejects)', () => {
    const ct = encryptViewKey(VIEW_KEY, masterKey)
    const env = parseEnvelope(ct)
    const tampered = { ...env, ct: env.ct.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) }
    const tamperedBlob = `v1:${Buffer.from(JSON.stringify(tampered)).toString('base64')}`
    expect(() => decryptViewKey(tamperedBlob, masterKey)).toThrow()
  })
})

describe('isCiphertextEnvelope', () => {
  it('returns true for a real envelope', () => {
    const ct = encryptViewKey(VIEW_KEY, masterKey)
    expect(isCiphertextEnvelope(ct)).toBe(true)
  })

  it('returns false for the Plan 3 stub prefix', () => {
    expect(isCiphertextEnvelope('stub:0xdeadbeef')).toBe(false)
  })

  it('returns false for empty / null / non-string', () => {
    expect(isCiphertextEnvelope('')).toBe(false)
    // @ts-expect-error testing runtime behaviour for null
    expect(isCiphertextEnvelope(null)).toBe(false)
  })
})
