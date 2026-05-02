'use client'

import { useState } from 'react'
import { useSignMessage } from 'wagmi'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useWizardStore } from '../_store'
import {
  STEALTH_DERIVATION_MESSAGE,
  deriveViewKeyStub,
  packStubViewKeyForApi,
} from '@/lib/stealth-stub'
import { getApiClient } from '@/lib/api-client'
import type { AgentResponse } from '@/types/api'

export function Step2ViewKey() {
  const { agentRowId, setViewKey, next } = useWizardStore()
  const { signMessageAsync } = useSignMessage()
  const [isWorking, setIsWorking] = useState(false)

  async function handleDerive() {
    if (!agentRowId) {
      toast.error('Missing agent — restart the wizard')
      return
    }
    setIsWorking(true)
    try {
      const sig = await signMessageAsync({ message: STEALTH_DERIVATION_MESSAGE })
      const viewKeyHex = deriveViewKeyStub(sig)
      const ciphertext = packStubViewKeyForApi(viewKeyHex)

      await getApiClient().patch<AgentResponse>(`/agents/${agentRowId}`, {
        viewKeyEncrypted: ciphertext,
      })

      setViewKey(viewKeyHex)
      toast.success('View key derived (Plan 3 stub)')
      next()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Derive your stealth view key <Badge variant="secondary">stub</Badge>
        </CardTitle>
        <CardDescription>
          Sign a fixed message with your wallet — no gas, no transaction. The signature deterministically
          derives a 32-byte placeholder view key. The real ERC-5564 derivation lands in the next release;
          your subname will keep working through the upgrade.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
          {STEALTH_DERIVATION_MESSAGE}
        </p>
        <p className="text-xs text-muted-foreground">
          Re-signing the same message in the same wallet always produces the same key. If you ever lose your
          local copy, return here and re-derive.
        </p>
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={handleDerive} disabled={isWorking}>
          {isWorking ? 'Check your wallet…' : 'Sign and derive'}
        </Button>
      </CardFooter>
    </Card>
  )
}
