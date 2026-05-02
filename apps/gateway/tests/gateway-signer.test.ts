import { describe, expect, it } from 'vitest'
import { keccak256, encodePacked, recoverAddress, hashMessage } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { signGatewayResponse, makeGatewaySignatureHash } from '../src/lib/gateway-signer.js'

const PK = '0x0000000000000000000000000000000000000000000000000000000000000001'
const account = privateKeyToAccount(PK)

describe('makeGatewaySignatureHash', () => {
  it('matches the on-chain hash format from SignatureVerifier.sol', () => {
    const target = '0x000000000000000000000000000000000000bEEF'
    const expires = 1746302400n
    const request = '0xdeadbeef'
    const result = '0xcafebabe'

    const hash = makeGatewaySignatureHash({ target, expires, request, result })

    // Mirrors: keccak256(0x1900 || target || expires || keccak(request) || keccak(result))
    const expected = keccak256(
      encodePacked(
        ['bytes2', 'address', 'uint64', 'bytes32', 'bytes32'],
        ['0x1900', target, expires, keccak256(request), keccak256(result)]
      )
    )
    expect(hash).toBe(expected)
  })
})

describe('signGatewayResponse', () => {
  it('produces a recoverable signature', async () => {
    const target = '0x000000000000000000000000000000000000bEEF'
    const expires = BigInt(Math.floor(Date.now() / 1000) + 60)
    const request = '0xdeadbeef'
    const result = '0xcafebabe'

    const { signature } = await signGatewayResponse(account, { target, expires, request, result })
    const hash = makeGatewaySignatureHash({ target, expires, request, result })
    const recovered = await recoverAddress({ hash, signature })
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase())
  })
})
