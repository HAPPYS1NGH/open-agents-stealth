'use client'

import { useState } from 'react'
import { useSignMessage } from 'wagmi'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  STEALTH_DERIVATION_MESSAGE,
  deriveStealthKeysFromSignatureBrowser,
} from '@/lib/stealth-derive-client'
import { getApiClient } from '@/lib/api-client'

interface Props {
  agentId: string
  /** True if the agent already has a v1: envelope; we add ?force=1 to overwrite. */
  hasExistingEnvelope: boolean
  onDone?: () => void
}

/**
 * Standalone re-derive helper. Used to heal agents whose stealth-meta got
 * clobbered by the pre-fix PATCH bug. Identical signing + POST flow as
 * wizard step 2; only difference is force=1 when an envelope already exists.
 */
export function RederiveStealthKeysButton({ agentId, hasExistingEnvelope, onDone }: Props) {
  const { signMessageAsync } = useSignMessage()
  const [working, setWorking] = useState(false)

  async function handle() {
    setWorking(true)
    try {
      const sig = (await signMessageAsync({ message: STEALTH_DERIVATION_MESSAGE })) as `0x${string}`
      const derived = deriveStealthKeysFromSignatureBrowser(sig)
      const path = hasExistingEnvelope
        ? `/agents/${agentId}/view-key?force=1`
        : `/agents/${agentId}/view-key`
      await getApiClient().post(path, {
        viewKey: derived.viewPrivKey,
        stealthMeta: derived.stealthMetaAddress,
      })
      toast.success('Stealth keys re-derived and stealth-meta republished')
      onDone?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setWorking(false)
    }
  }

  return (
    <Button onClick={handle} disabled={working} variant="outline" size="sm">
      {working ? 'Check your wallet…' : hasExistingEnvelope ? 'Re-derive stealth keys (force)' : 'Derive stealth keys'}
    </Button>
  )
}
