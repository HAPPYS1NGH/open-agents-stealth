export { STEALTH_DERIVATION_MESSAGE } from '@open-agents/crypto'

/**
 * @deprecated Use deriveStealthKeysFromSignatureBrowser from
 * @/lib/stealth-derive-client. Throws to surface accidental imports.
 */
export function deriveViewKeyStub(_signatureHex: string): never {
  throw new Error(
    'deriveViewKeyStub is deprecated as of Plan 4. Import deriveStealthKeysFromSignatureBrowser from @/lib/stealth-derive-client instead.',
  )
}

/** @deprecated See deriveViewKeyStub. */
export function packStubViewKeyForApi(_viewKeyHex: `0x${string}`): never {
  throw new Error(
    'packStubViewKeyForApi is deprecated as of Plan 4. POST { viewKey, stealthMeta } to /agents/:id/view-key instead.',
  )
}
