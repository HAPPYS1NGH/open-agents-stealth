import {
  encryptViewKey,
  decryptViewKey,
  isCiphertextEnvelope,
  parseMasterKey,
  type MasterKey,
} from '@open-agents/crypto'
import { env } from '../env.js'

let _masterKey: MasterKey | null = null

function masterKey(): MasterKey {
  if (!_masterKey) _masterKey = parseMasterKey(env.VIEW_KEY_MASTER_KEY)
  return _masterKey
}

export function encryptForStorage(viewKeyPlaintext: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(viewKeyPlaintext)) {
    throw new Error('encryptForStorage: viewKey must be 0x-prefixed 32-byte hex')
  }
  return encryptViewKey(viewKeyPlaintext, masterKey())
}

export function decryptFromStorage(ciphertext: string): string {
  if (!isCiphertextEnvelope(ciphertext)) {
    throw new Error('decryptFromStorage: not a v1 ciphertext envelope')
  }
  return decryptViewKey(ciphertext, masterKey())
}

export function isStub(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith('stub:')
}
