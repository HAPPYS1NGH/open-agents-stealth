'use client'

import { useState } from 'react'
import { useSignMessage } from 'wagmi'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useWizardStore } from '../_store'
import {
  STEALTH_DERIVATION_MESSAGE,
  deriveStealthKeysFromSignatureBrowser,
} from '@/lib/stealth-derive-client'
import { getApiClient } from '@/lib/api-client'

export function Step2ViewKey() {
  const { agentRowId, setViewKey, setSpendKey, setStealthMeta, next } = useWizardStore()
  const { signMessageAsync } = useSignMessage()
  const [isWorking, setIsWorking] = useState(false)

  async function handleDerive() {
    if (!agentRowId) {
      toast.error('Missing agent — restart the wizard')
      return
    }
    setIsWorking(true)
    try {
      const sig = (await signMessageAsync({
        message: STEALTH_DERIVATION_MESSAGE,
      })) as `0x${string}`

      const derived = deriveStealthKeysFromSignatureBrowser(sig)

      await getApiClient().post<{ id: string; viewKeyEncrypted: string }>(
        `/agents/${agentRowId}/view-key`,
        {
          viewKey: derived.viewPrivKey,
          stealthMeta: derived.stealthMetaAddress,
        },
      )

      setSpendKey(derived.spendPrivKey)
      setStealthMeta(derived.stealthMetaAddress)
      setViewKey(derived.viewPrivKey)

      toast.success('Stealth keys derived and registered')
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
        <CardTitle>Derive your stealth keys</CardTitle>
        <CardDescription>
          Sign a fixed message with your wallet — no gas, no transaction. Your signature deterministically
          derives a spend key (kept only in your browser), a view key (encrypted server-side so we can scan
          incoming payments), and the public meta-address we publish under your subname.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
          {STEALTH_DERIVATION_MESSAGE}
        </p>
        <p className="text-xs text-muted-foreground">
          Re-signing the same message with the same wallet always produces the same keys. If you ever lose
          your <code>.env</code>, return to this step and re-derive.
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
