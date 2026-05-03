import { describe, expect, it, vi } from 'vitest'
import {
  formatUsdc,
  relativeTime,
  shortAddr,
  shortTx,
} from '../src/lib/usdc-format'

describe('formatUsdc', () => {
  it('formats whole-USDC amounts', () => {
    expect(formatUsdc('5000000')).toBe('5.00 USDC')
  })
  it('formats sub-cent amounts (rounds)', () => {
    expect(formatUsdc('12345678')).toBe('12.35 USDC')
  })
  it('inserts thousands separators', () => {
    expect(formatUsdc('1234567000000')).toBe('1,234,567.00 USDC')
  })
})

describe('shortAddr / shortTx', () => {
  it('truncates a 20-byte address', () => {
    expect(shortAddr('0x' + 'aa'.repeat(20))).toBe('0xaaaa…aaaa')
  })
  it('truncates a 32-byte tx', () => {
    expect(shortTx('0x' + 'cd'.repeat(32))).toBe('0xcdcdcdcd…cd')
  })
})

describe('relativeTime', () => {
  it('returns seconds ago', () => {
    const now = new Date('2026-05-01T12:00:00Z').getTime()
    vi.setSystemTime(now)
    expect(relativeTime('2026-05-01T11:59:30Z')).toBe('30s ago')
    vi.useRealTimers()
  })
})
