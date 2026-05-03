import type { Address, PublicClient } from 'viem'
import { BASE_USDC_ADDRESS, TRANSFER_EVENT } from './usdc.js'

export interface BlockRangeChunk {
  fromBlock: bigint
  toBlock: bigint
}

/**
 * Splits an inclusive [fromBlock, toBlock] range into chunks of at most
 * `chunkSize` blocks each. Each chunk is itself inclusive and contiguous.
 *
 * Used to keep `eth_getLogs` requests within the RPC's range cap. Public
 * Base RPC caps at 5000; we default to 1000 for headroom.
 */
export function chunkBlockRange(
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize: bigint,
): BlockRangeChunk[] {
  if (chunkSize <= 0n) throw new Error('chunkBlockRange: chunkSize must be > 0')
  if (fromBlock > toBlock) {
    throw new Error(`chunkBlockRange: fromBlock (${fromBlock}) > toBlock (${toBlock})`)
  }
  const chunks: BlockRangeChunk[] = []
  let cur = fromBlock
  while (cur <= toBlock) {
    const end = cur + chunkSize - 1n
    chunks.push({ fromBlock: cur, toBlock: end > toBlock ? toBlock : end })
    cur = end + 1n
  }
  return chunks
}

export interface DecodedTransferLog {
  transactionHash: `0x${string}`
  logIndex: number
  blockNumber: bigint
  address: Address
  args: {
    from: Address
    to: Address
    value: bigint
  }
}

export interface FetchTransferLogsParams {
  client: Pick<PublicClient, 'getLogs'>
  addresses: Address[]
  fromBlock: bigint
  toBlock: bigint
  chunkSize?: bigint
  contract?: Address
}

/**
 * Fetches USDC Transfer events whose `to` matches any of the supplied
 * stealth addresses, over the inclusive [fromBlock, toBlock] range.
 *
 * Splits into chunks of `chunkSize` (default 1000) blocks, issues one
 * getLogs per chunk, concatenates. Returns logs in the order the RPC
 * returned them (chunk order, then RPC order within a chunk).
 *
 * No-ops when `addresses` is empty (saves an RPC roundtrip).
 */
export async function fetchTransferLogsToAddresses(
  params: FetchTransferLogsParams,
): Promise<DecodedTransferLog[]> {
  if (params.addresses.length === 0) return []
  const chunkSize = params.chunkSize ?? 1000n
  const contract = params.contract ?? BASE_USDC_ADDRESS
  const lowered = params.addresses.map((a) => a.toLowerCase() as Address)

  const chunks = chunkBlockRange(params.fromBlock, params.toBlock, chunkSize)
  const out: DecodedTransferLog[] = []
  for (const c of chunks) {
    const logs = await params.client.getLogs({
      address: contract,
      event: TRANSFER_EVENT,
      args: { to: lowered },
      fromBlock: c.fromBlock,
      toBlock: c.toBlock,
    })
    for (const log of logs) {
      out.push({
        transactionHash: log.transactionHash as `0x${string}`,
        logIndex: log.logIndex as number,
        blockNumber: log.blockNumber as bigint,
        address: log.address as Address,
        args: {
          from: log.args.from as Address,
          to: log.args.to as Address,
          value: log.args.value as bigint,
        },
      })
    }
  }
  return out
}
