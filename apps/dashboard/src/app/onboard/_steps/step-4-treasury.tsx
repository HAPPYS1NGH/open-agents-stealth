'use client'

import { useState } from 'react'
import { useAccount, useWalletClient, useWaitForTransactionReceipt } from 'wagmi'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { useWizardStore } from '../_store'
import { deployTreasurySafe } from '@/lib/safe-deploy'
import { getApiClient } from '@/lib/api-client'
import type { TreasuryBody, TreasuryResponse } from '@/types/api'

export function Step4Treasury() {
  const { agentRowId, setTreasury, next } = useWizardStore()
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const [pending, setPending] = useState(false)
  const [predicted, setPredicted] = useState<`0x${string}` | null>(null)
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)

  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash ?? undefined })

  async function handleDeploy() {
    if (!address || !walletClient) {
      toast.error('Wallet not connected')
      return
    }
    if (!agentRowId) {
      toast.error('No agent row — restart wizard')
      return
    }
    setPending(true)
    try {
      const { safeAddress, deployTxHash } = await deployTreasurySafe({
        walletClient,
        ownerEoa: address as `0x${string}`,
      })
      setPredicted(safeAddress)
      setTxHash(deployTxHash)
      toast.message('Safe deploy tx submitted', { description: deployTxHash })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  async function handleConfirm() {
    if (!predicted || !txHash || !agentRowId) return
    try {
      const body: TreasuryBody = { safeAddress: predicted, deployTxHash: txHash }
      const res = await getApiClient().post<TreasuryResponse>(
        `/agents/${agentRowId}/treasury`,
        body,
      )
      setTreasury(predicted, txHash)
      toast.success(`Treasury Safe persisted: ${res.treasurySafeAddress}`)
      next()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deploy your treasury Safe</CardTitle>
        <CardDescription>
          A 1-of-1 Safe owned by your wallet. Stealth-payment sweeps consolidate funds here. Heads-up:
          transfers from stealth addresses to this Safe are visible on-chain — keep this Safe separate from
          your main wallet for maximum privacy.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {predicted && (
          <p className="text-xs">
            Predicted address: <code>{predicted}</code>
          </p>
        )}
        {txHash && (
          <p className="text-xs">
            Deploy tx: <code>{txHash}</code>
          </p>
        )}
        {receipt && (
          <p className="text-xs text-emerald-600">
            Confirmed in block {receipt.blockNumber.toString()}.
          </p>
        )}
      </CardContent>
      <CardFooter className="justify-end gap-2">
        {!txHash && (
          <Button onClick={handleDeploy} disabled={pending}>
            {pending ? 'Confirming in wallet…' : 'Deploy Safe'}
          </Button>
        )}
        {txHash && receipt && (
          <Button onClick={handleConfirm}>Confirm with backend</Button>
        )}
        {txHash && !receipt && <Button disabled>Waiting for receipt…</Button>}
      </CardFooter>
    </Card>
  )
}
