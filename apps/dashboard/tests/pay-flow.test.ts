import { describe, expect, it, vi } from 'vitest'
import { encodeAbiParameters } from 'viem'
import {
  parseUsdcInput,
  viewTagAsMetadata,
  resolveRecipient,
} from '../src/lib/pay-flow'

vi.mock('../src/lib/chains', () => ({
  ensReadClient: {
    getEnsAddress: vi.fn(),
    getEnsText: vi.fn(),
  },
}))

import { ensReadClient } from '../src/lib/chains'

describe('parseUsdcInput', () => {
  it('handles whole numbers', () => {
    expect(parseUsdcInput('5')).toBe(5_000_000n)
  })
  it('handles decimals', () => {
    expect(parseUsdcInput('1.5')).toBe(1_500_000n)
  })
  it('rejects more than 6 decimals', () => {
    expect(() => parseUsdcInput('1.1234567')).toThrow()
  })
  it('rejects non-numeric', () => {
    expect(() => parseUsdcInput('abc')).toThrow()
  })
})

describe('viewTagAsMetadata', () => {
  it('encodes a single byte', () => {
    expect(viewTagAsMetadata(0x42)).toBe('0x42')
  })
  it('zero-pads short tags', () => {
    expect(viewTagAsMetadata(0x5)).toBe('0x05')
  })
  it('rejects out-of-range', () => {
    expect(() => viewTagAsMetadata(256)).toThrow()
  })
})

describe('resolveRecipient', () => {
  const SAFE = '0x' + 'aa'.repeat(20)
  const EOA = '0x' + 'bb'.repeat(20)
  const EPH = '0x02' + '11'.repeat(32)
  const VIEW_TAG = 0x42

  it('returns safe + payload fields', async () => {
    const payload = encodeAbiParameters(
      [{ type: 'address' }, { type: 'bytes' }, { type: 'uint8' }],
      [EOA as `0x${string}`, EPH as `0x${string}`, VIEW_TAG],
    )
    ;(ensReadClient.getEnsAddress as ReturnType<typeof vi.fn>).mockResolvedValueOnce(SAFE)
    ;(ensReadClient.getEnsText as ReturnType<typeof vi.fn>).mockResolvedValueOnce(payload)

    const r = await resolveRecipient('alice.gabhru.eth')
    expect(r.safeAddress).toBe(SAFE.toLowerCase())
    expect(r.stealthEoa).toBe(EOA.toLowerCase())
    expect(r.ephemeralPub.toLowerCase()).toBe(EPH.toLowerCase())
    expect(r.viewTag).toBe(VIEW_TAG)
  })

  it('throws when getEnsAddress returns null', async () => {
    ;(ensReadClient.getEnsAddress as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    await expect(resolveRecipient('ghost.gabhru.eth')).rejects.toThrow(/No safe address/)
  })

  it('throws when stealth-payload is empty', async () => {
    ;(ensReadClient.getEnsAddress as ReturnType<typeof vi.fn>).mockResolvedValueOnce(SAFE)
    ;(ensReadClient.getEnsText as ReturnType<typeof vi.fn>).mockResolvedValueOnce('0x')
    await expect(resolveRecipient('coldstart.gabhru.eth')).rejects.toThrow(
      /stealth-payload/,
    )
  })
})
