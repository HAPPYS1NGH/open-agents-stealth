import {
  encodeAbiParameters,
  encodePacked,
  keccak256,
  type Address,
  type Hex,
  type LocalAccount,
} from 'viem'

export interface GatewayResponseInput {
  target: Address
  expires: bigint
  request: Hex
  result: Hex
}

/**
 * Mirrors SignatureVerifier.makeSignatureHash on-chain. Producing the same
 * hash here means signatures are accepted by the deployed resolver.
 */
export function makeGatewaySignatureHash(input: GatewayResponseInput): Hex {
  return keccak256(
    encodePacked(
      ['bytes2', 'address', 'uint64', 'bytes32', 'bytes32'],
      [
        '0x1900',
        input.target,
        input.expires,
        keccak256(input.request),
        keccak256(input.result),
      ],
    ),
  )
}

/**
 * Signs the response and returns both the signature and the response
 * blob (ABI-encoded for the resolver's resolveWithProof callback).
 */
export async function signGatewayResponse(
  signer: LocalAccount,
  input: GatewayResponseInput,
): Promise<{ signature: Hex; encodedResponse: Hex }> {
  if (!signer.sign) {
    throw new Error('signGatewayResponse: signer must support raw hash signing (sign({ hash }))')
  }
  const hash = makeGatewaySignatureHash(input)
  const signature = await signer.sign({ hash })
  const encodedResponse = encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
    [input.result, input.expires, signature],
  )
  return { signature, encodedResponse }
}
