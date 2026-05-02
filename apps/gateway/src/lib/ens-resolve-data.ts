import { decodeAbiParameters, encodeAbiParameters, type Hex } from 'viem'

export type ParsedResolveData =
  | { kind: 'addr'; node: Hex; coinType: 60n }
  | { kind: 'addrMulticoin'; node: Hex; coinType: bigint }
  | { kind: 'text'; node: Hex; key: string }
  | { kind: 'contenthash'; node: Hex }

const SEL_ADDR_NODE       = '0x3b3b57de'  // addr(bytes32)
const SEL_ADDR_MULTICOIN  = '0xf1cb7e06'  // addr(bytes32,uint256)
const SEL_TEXT            = '0x59d1d43c'  // text(bytes32,string)
const SEL_CONTENTHASH     = '0xbc1c58d1'  // contenthash(bytes32)

/**
 * Parses the `data` payload of an ENSIP-10 resolve(name,data) call into
 * a tagged union. Throws on unknown selectors.
 */
export function parseResolveData(data: Hex | string): ParsedResolveData {
  const hex = (data.startsWith('0x') ? data : `0x${data}`) as Hex
  const sel = hex.slice(0, 10).toLowerCase() as Hex
  const params = `0x${hex.slice(10)}` as Hex

  if (sel === SEL_ADDR_NODE) {
    const [node] = decodeAbiParameters([{ type: 'bytes32' }], params)
    return { kind: 'addr', node, coinType: 60n }
  }
  if (sel === SEL_ADDR_MULTICOIN) {
    const [node, coinType] = decodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint256' }],
      params
    )
    return { kind: 'addrMulticoin', node, coinType }
  }
  if (sel === SEL_TEXT) {
    const [node, key] = decodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'string' }],
      params
    )
    return { kind: 'text', node, key }
  }
  if (sel === SEL_CONTENTHASH) {
    const [node] = decodeAbiParameters([{ type: 'bytes32' }], params)
    return { kind: 'contenthash', node }
  }
  throw new Error(`parseResolveData: unsupported selector ${sel}`)
}

/**
 * Encodes the result for a parsed resolve call. The encoding must match
 * the original function's return type for the resolver client to decode.
 */
export function encodeResolveResult(parsed: ParsedResolveData, value: Hex | string): Hex {
  switch (parsed.kind) {
    case 'addr':
      return encodeAbiParameters([{ type: 'address' }], [value as Hex])
    case 'addrMulticoin':
      return encodeAbiParameters([{ type: 'bytes' }], [value as Hex])
    case 'text':
      return encodeAbiParameters([{ type: 'string' }], [value as string])
    case 'contenthash':
      return encodeAbiParameters([{ type: 'bytes' }], [value as Hex])
  }
}
