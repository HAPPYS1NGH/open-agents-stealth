import type { Address } from 'viem'

export interface StubAgent {
  label: string                  // e.g., 'test'
  baseAddr: Address              // address returned for addr() queries
  textRecords: Record<string, string>
}

/**
 * Hardcoded test agents for Plan 1 verification. Replaced in Plan 4 by
 * a Postgres-backed lookup that derives a fresh stealth address per query
 * and reads the published context/endpoint records from the agents row.
 */
export const STUB_AGENTS: Readonly<Record<string, StubAgent>> = {
  test: {
    label: 'test',
    baseAddr: '0x000000000000000000000000000000000000bEEF',
    textRecords: {
      'agent-context': '{"name":"Plan 1 stub","description":"Hardcoded; replaced in Plan 4."}',
    },
  },
}

export function findStubAgent(label: string): StubAgent | undefined {
  return STUB_AGENTS[label.toLowerCase()]
}
