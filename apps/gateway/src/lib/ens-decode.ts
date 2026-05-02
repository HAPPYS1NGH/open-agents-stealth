/**
 * Decodes a DNS-encoded name (length-prefixed labels terminated by 0x00)
 * into an array of UTF-8 label strings.
 *
 * Example: 0x04test07gabhru03eth00 → ['test', 'gabhru', 'eth']
 */
export function decodeDnsName(input: Uint8Array | `0x${string}`): string[] {
  const bytes = typeof input === 'string'
    ? Uint8Array.from(input.slice(2).match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
    : input

  const labels: string[] = []
  let i = 0
  const decoder = new TextDecoder()
  while (i < bytes.length) {
    const len = bytes[i]!
    if (len === 0) return labels
    if (i + 1 + len > bytes.length) {
      throw new Error('decodeDnsName: truncated input')
    }
    labels.push(decoder.decode(bytes.subarray(i + 1, i + 1 + len)))
    i += 1 + len
  }
  throw new Error('decodeDnsName: missing null terminator')
}

/**
 * Encodes a dotted name into DNS wire format. For tests and parity.
 */
export function dnsEncode(name: string): Uint8Array {
  const labels = name.split('.')
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  let totalLen = 0
  for (const label of labels) {
    const labelBytes = encoder.encode(label)
    if (labelBytes.length > 63) throw new Error('dnsEncode: label too long')
    parts.push(new Uint8Array([labelBytes.length]))
    parts.push(labelBytes)
    totalLen += 1 + labelBytes.length
  }
  parts.push(new Uint8Array([0]))
  totalLen += 1
  const out = new Uint8Array(totalLen)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}
