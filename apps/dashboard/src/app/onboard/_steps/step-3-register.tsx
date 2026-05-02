'use client'

import { useState } from 'react'
import { useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { decodeEventLog } from 'viem'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { useWizardStore } from '../_store'
import {
  IDENTITY_REGISTRY_ABI,
  IDENTITY_REGISTRY_ADDRESS,
  PLAN3_PLACEHOLDER_AGENT_URI,
} from '@/lib/identity-registry-abi'
import { getApiClient } from '@/lib/api-client'
import type { RegisterOnchainBody, RegisterOnchainResponse } from '@/types/api'

export function Step3Register() {
  const { agentRowId, setOnchain, next } = useWizardStore()
  const { address } = useAccount()
  const [submitting, setSubmitting] = useState(false)

  const { writeContractAsync, data: pendingTxHash, reset: resetWrite } = useWriteContract()
  const { data: receipt, isLoading: waitingReceipt } = useWaitForTransactionReceipt({
    hash: pendingTxHash,
  })

  async function handleRegister() {
    if (!address) {
      toast.error('Wallet not connected')
      return
    }
    if (!agentRowId) {
      toast.error('No agent row — restart wizard')
      return
    }
    setSubmitting(true)
    try {
      const txHash = await writeContractAsync({
        address: IDENTITY_REGISTRY_ADDRESS,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'register',
        args: [PLAN3_PLACEHOLDER_AGENT_URI],
      })
      toast.message('Register tx submitted', { description: txHash })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleConfirm() {
    if (!receipt || !pendingTxHash) {
      toast.error('Tx receipt not yet available')
      return
    }
    if (!agentRowId) return

    let tokenId: bigint | null = null
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== IDENTITY_REGISTRY_ADDRESS.toLowerCase()) continue
      try {
        const decoded = decodeEventLog({
          abi: IDENTITY_REGISTRY_ABI,
          data: log.data,
          topics: log.topics,
          eventName: 'Transfer',
        })
        const args = decoded.args as { from: `0x${string}`; to: `0x${string}`; tokenId: bigint }
        if (args.from === '0x0000000000000000000000000000000000000000') {
          tokenId = args.tokenId
          break
        }
      } catch {
        // not a Transfer event, skip
      }
    }
    if (tokenId === null) {
      toast.error('Could not find Transfer log in receipt')
      return
    }
    const agentIdStr = `8453:${tokenId.toString()}`

    try {
      const body: RegisterOnchainBody = { agentId: agentIdStr, txHash: pendingTxHash }
      await getApiClient().post<RegisterOnchainResponse>(
        `/agents/${agentRowId}/register-onchain`,
        body,
      )
      setOnchain(agentIdStr, pendingTxHash)
      toast.success(`Registered as ${agentIdStr}`)
      next()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Register on Base</CardTitle>
        <CardDescription>
          Mint an ERC-8004 agent NFT to your wallet. This is the only step that costs gas (~$0.01 on Base).
          We'll verify the on-chain mint server-side and link your subname to the new agent ID.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border border-border bg-muted px-3 py-2 text-xs">
          <div>Contract: <code>{IDENTITY_REGISTRY_ADDRESS}</code></div>
          <div>Function: <code>register("{PLAN3_PLACEHOLDER_AGENT_URI}")</code></div>
        </div>
        {pendingTxHash && (
          <p className="text-xs text-muted-foreground">
            Pending tx: <code>{pendingTxHash}</code>
          </p>
        )}
        {waitingReceipt && (
          <p className="text-xs text-muted-foreground">Waiting for confirmation…</p>
        )}
        {receipt && (
          <p className="text-xs text-emerald-600">
            Confirmed in block {receipt.blockNumber.toString()}.
          </p>
        )}
      </CardContent>
      <CardFooter className="justify-end gap-2">
        {!pendingTxHash && (
          <Button onClick={handleRegister} disabled={submitting}>
            {submitting ? 'Confirming in wallet…' : 'Sign register tx'}
          </Button>
        )}
        {pendingTxHash && receipt && (
          <Button onClick={handleConfirm}>Confirm with backend</Button>
        )}
        {pendingTxHash && !receipt && (
          <Button disabled>Waiting for receipt…</Button>
        )}
        {pendingTxHash && (
          <Button
            variant="outline"
            onClick={() => {
              resetWrite()
            }}
          >
            Reset
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
