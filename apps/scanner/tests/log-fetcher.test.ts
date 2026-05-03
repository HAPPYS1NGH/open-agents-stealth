import { describe, expect, it, vi } from 'vitest'
import { fetchTransferLogsToAddresses, chunkBlockRange } from '../src/lib/log-fetcher.js'
import { BASE_USDC_ADDRESS } from '../src/lib/usdc.js'

describe('chunkBlockRange', () => {
  it('returns a single chunk when range fits', () => {
    expect(chunkBlockRange(100n, 1099n, 1000n)).toEqual([
      { fromBlock: 100n, toBlock: 1099n },
    ])
  })

  it('splits inclusive ranges into chunks of size N', () => {
    expect(chunkBlockRange(0n, 2500n, 1000n)).toEqual([
      { fromBlock: 0n, toBlock: 999n },
      { fromBlock: 1000n, toBlock: 1999n },
      { fromBlock: 2000n, toBlock: 2500n },
    ])
  })

  it('handles fromBlock === toBlock', () => {
    expect(chunkBlockRange(7n, 7n, 1000n)).toEqual([
      { fromBlock: 7n, toBlock: 7n },
    ])
  })

  it('throws when fromBlock > toBlock', () => {
    expect(() => chunkBlockRange(20n, 10n, 1000n)).toThrow()
  })

  it('throws on non-positive chunk size', () => {
    expect(() => chunkBlockRange(0n, 100n, 0n)).toThrow()
  })
})

describe('fetchTransferLogsToAddresses', () => {
  it('returns an empty array when address list is empty', async () => {
    const fakeClient = { getLogs: vi.fn() } as unknown as Parameters<
      typeof fetchTransferLogsToAddresses
    >[0]['client']
    const out = await fetchTransferLogsToAddresses({
      client: fakeClient,
      addresses: [],
      fromBlock: 1n,
      toBlock: 1000n,
    })
    expect(out).toEqual([])
    expect((fakeClient as { getLogs: { mock: { calls: unknown[] } } }).getLogs.mock.calls.length).toBe(0)
  })

  it('issues one getLogs per chunk and concatenates results', async () => {
    const stub = vi
      .fn()
      .mockResolvedValueOnce([
        {
          args: { from: '0x1', to: '0x2', value: 1n },
          transactionHash: '0xa',
          logIndex: 0,
          blockNumber: 1n,
          address: BASE_USDC_ADDRESS,
        },
      ])
      .mockResolvedValueOnce([
        {
          args: { from: '0x3', to: '0x4', value: 2n },
          transactionHash: '0xb',
          logIndex: 1,
          blockNumber: 1500n,
          address: BASE_USDC_ADDRESS,
        },
      ])
    const fakeClient = { getLogs: stub } as unknown as Parameters<
      typeof fetchTransferLogsToAddresses
    >[0]['client']
    const out = await fetchTransferLogsToAddresses({
      client: fakeClient,
      addresses: [('0x' + 'aa'.repeat(20)) as `0x${string}`],
      fromBlock: 1n,
      toBlock: 1500n,
      chunkSize: 1000n,
    })
    expect(stub).toHaveBeenCalledTimes(2)
    expect(out.length).toBe(2)
    expect(out[0]!.transactionHash).toBe('0xa')
    expect(out[1]!.transactionHash).toBe('0xb')
  })

  it('lowercases address inputs before passing to getLogs', async () => {
    const stub = vi.fn().mockResolvedValue([])
    const fakeClient = { getLogs: stub } as unknown as Parameters<
      typeof fetchTransferLogsToAddresses
    >[0]['client']
    await fetchTransferLogsToAddresses({
      client: fakeClient,
      addresses: [('0xAbCdEf' + '00'.repeat(17)) as `0x${string}`],
      fromBlock: 1n,
      toBlock: 100n,
    })
    const call = stub.mock.calls[0]![0] as { args: { to: string[] } }
    expect(call.args.to[0]).toBe(('0xAbCdEf' + '00'.repeat(17)).toLowerCase())
  })
})
