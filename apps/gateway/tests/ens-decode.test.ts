import { describe, expect, it } from 'vitest'
import { decodeDnsName, dnsEncode } from '../src/lib/ens-decode.js'

describe('decodeDnsName', () => {
  it('round-trips a 3-label name', () => {
    const encoded = dnsEncode('test.gabhru.eth')
    expect(decodeDnsName(encoded)).toEqual(['test', 'gabhru', 'eth'])
  })

  it('handles 2-label names', () => {
    const encoded = dnsEncode('gabhru.eth')
    expect(decodeDnsName(encoded)).toEqual(['gabhru', 'eth'])
  })

  it('handles deeper nesting', () => {
    const encoded = dnsEncode('a.b.c.d.eth')
    expect(decodeDnsName(encoded)).toEqual(['a', 'b', 'c', 'd', 'eth'])
  })

  it('throws on malformed input (no terminator)', () => {
    const bad = new Uint8Array([4, 116, 101, 115, 116])  // "test" without 0x00
    expect(() => decodeDnsName(bad)).toThrow()
  })
})
