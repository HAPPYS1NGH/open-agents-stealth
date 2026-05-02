// One-shot seed of the legacy 'test' agent into Postgres.
// Required so test.gabhru.eth keeps resolving on mainnet after the gateway
// switches from the hardcoded stub to the Postgres-backed agents repo.
//
// Usage:
//   set -a && . path/to/.env.production && set +a
//   node scripts/seed-test-agent.mjs

import { createDb, findAgentByLabel, insertAgent } from '../packages/db/src/index.ts'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

const db = createDb(url)
const existing = await findAgentByLabel(db, 'test')
if (existing) {
  console.log(`'test' agent already exists: id=${existing.id}`)
  process.exit(0)
}

const row = await insertAgent(db, {
  ownerEoa: '0x0000000000000000000000000000000000000001',
  subnameLabel: 'test',
  baseAddr: '0x000000000000000000000000000000000000bEEF',
  textRecords: {
    'agent-context': '{"name":"Plan 1 stub","description":"Hardcoded; replaced in Plan 4."}',
  },
})
console.log(`Seeded 'test' agent: id=${row.id}`)
