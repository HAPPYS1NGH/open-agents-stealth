import { describe, expect, it } from 'vitest'
import { encodeFunctionData, encodeAbiParameters, parseAbi, namehash } from 'viem'
import { parseResolveData, encodeResolveResult } from '../src/lib/ens-resolve-data.js'

const node = namehash('test.gabhru.eth')

describe('parseResolveData', () => {
  it('detects addr(node)', () => {
    const data = encodeFunctionData({
      abi: parseAbi(['function addr(bytes32) view returns (address)']),
      functionName: 'addr',
      args: [node],
    })
    const parsed = parseResolveData(data)
    expect(parsed.kind).toBe('addr')
    expect(parsed.node).toBe(node)
    if (parsed.kind === 'addr') expect(parsed.coinType).toBe(60n)
  })

  it('detects addr(node, coinType)', () => {
    const data = encodeFunctionData({
      abi: parseAbi(['function addr(bytes32, uint256) view returns (bytes)']),
      functionName: 'addr',
      args: [node, 2147492101n],  // Base mainnet coinType
    })
    const parsed = parseResolveData(data)
    expect(parsed.kind).toBe('addrMulticoin')
    if (parsed.kind === 'addrMulticoin') {
      expect(parsed.coinType).toBe(2147492101n)
    }
  })

  it('detects text(node, key)', () => {
    const data = encodeFunctionData({
      abi: parseAbi(['function text(bytes32, string) view returns (string)']),
      functionName: 'text',
      args: [node, 'agent-context'],
    })
    const parsed = parseResolveData(data)
    expect(parsed.kind).toBe('text')
    if (parsed.kind === 'text') expect(parsed.key).toBe('agent-context')
  })

  it('throws on unknown selector', () => {
    expect(() => parseResolveData('0xdeadbeef00000000')).toThrow()
  })
})

describe('encodeResolveResult', () => {
  it('encodes addr() result as a single address', () => {
    const out = encodeResolveResult({ kind: 'addr', node, coinType: 60n }, '0x000000000000000000000000000000000000bEEF')
    const decoded = encodeAbiParameters([{ type: 'address' }], ['0x000000000000000000000000000000000000bEEF'])
    expect(out).toBe(decoded)
  })

  it('encodes addrMulticoin() result as bytes', () => {
    const out = encodeResolveResult(
      { kind: 'addrMulticoin', node, coinType: 2147492101n },
      '0x000000000000000000000000000000000000bEEF'
    )
    const decoded = encodeAbiParameters([{ type: 'bytes' }], ['0x000000000000000000000000000000000000bEEF'])
    expect(out).toBe(decoded)
  })

  it('encodes text() result as a string', () => {
    const out = encodeResolveResult({ kind: 'text', node, key: 'agent-context' }, '{"name":"acmebot"}')
    const decoded = encodeAbiParameters([{ type: 'string' }], ['{"name":"acmebot"}'])
    expect(out).toBe(decoded)
  })
})
