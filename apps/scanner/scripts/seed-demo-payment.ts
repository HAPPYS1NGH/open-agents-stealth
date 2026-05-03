import {
  createDb,
  findAgentByLabel,
  insertGatewayAnnouncement,
  insertPayment,
} from '@open-agents/db'

const DB_URL =
  process.env['DATABASE_URL'] ??
  'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
const SUBLABEL = process.argv[2]
if (!SUBLABEL) {
  console.error(
    'Usage: pnpm --filter @open-agents/scanner seed:demo <subname-label>',
  )
  process.exit(1)
}

async function main(): Promise<void> {
  const db = createDb(DB_URL)
  const agent = await findAgentByLabel(db, SUBLABEL!)
  if (!agent) {
    console.error(`No agent with subname ${SUBLABEL} — run the wizard first`)
    process.exit(2)
  }

  const RUN_TAG = Date.now().toString(16).slice(-8)
  const STEALTH = ('0x' + RUN_TAG + 'fa'.repeat(16)).toLowerCase() as `0x${string}`
  const EPH = '0x02' + RUN_TAG + 'cc'.repeat(28)
  const TX = ('0x' + RUN_TAG + 'de'.repeat(28)) as `0x${string}`

  await insertGatewayAnnouncement(db, {
    agentId: agent.id,
    stealthAddress: STEALTH,
    ephemeralPub: EPH,
    viewTag: 0x99,
  })

  const payment = await insertPayment(db, {
    agentId: agent.id,
    stealthAddress: STEALTH,
    ephemeralPub: EPH,
    txHash: TX,
    logIndex: 0,
    blockNumber: '20100000',
    tokenAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    amount: '5000000', // 5 USDC
    fromAddress: '0x' + 'be'.repeat(20),
  })

  console.log(
    `Inserted payment ${payment.id} for agent ${agent.id} (${SUBLABEL})`,
  )
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
