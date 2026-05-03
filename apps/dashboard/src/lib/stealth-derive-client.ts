import {
  deriveStealthKeysFromSignature,
  STEALTH_DERIVATION_MESSAGE,
  type DerivedStealthKeys,
} from '@open-agents/crypto'

export { STEALTH_DERIVATION_MESSAGE }
export type { DerivedStealthKeys }

export function deriveStealthKeysFromSignatureBrowser(
  signature: `0x${string}`,
): DerivedStealthKeys {
  return deriveStealthKeysFromSignature(signature)
}
