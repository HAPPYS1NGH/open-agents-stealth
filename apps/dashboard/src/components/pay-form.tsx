'use client'

import { useState } from 'react'
import { useAccount, useWriteContract } from 'wagmi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { ConnectButton } from '@/components/connect-button'
import {
  parseUsdcInput,
  resolveRecipient,
  viewTagAsMetadata,
  type ResolvedRecipient,
} from '@/lib/pay-flow'
import { BASE_USDC_ADDRESS, usdcAbi } from '@/lib/usdc'
import {
  ERC5564_ANNOUNCER_ADDRESS,
  STEALTH_SCHEME_ID,
  announcerAbi,
} from '@/lib/announcer'
import { shortAddr, shortTx } from '@/lib/usdc-format'

interface PayFormProps {
  ensName: string
}

type Stage = 'idle' | 'resolving' | 'transfer' | 'announce' | 'done' | 'error'

export function PayForm({ ensName }: PayFormProps) {
  const { isConnected } = useAccount()
  const [amount, setAmount] = useState('')
  const [recipient, setRecipient] = useState<ResolvedRecipient | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [transferTx, setTransferTx] = useState<`0x${string}` | null>(null)
  const [announceTx, setAnnounceTx] = useState<`0x${string}` | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { writeContractAsync } = useWriteContract()

  async function handlePay() {
    setErrorMsg(null)
    setTransferTx(null)
    setAnnounceTx(null)
    try {
      setStage('resolving')
      const r = recipient ?? (await resolveRecipient(ensName))
      setRecipient(r)

      const raw = parseUsdcInput(amount)

      setStage('transfer')
      const tHash = await writeContractAsync({
        address: BASE_USDC_ADDRESS,
        abi: usdcAbi,
        functionName: 'transfer',
        args: [r.safeAddress, raw],
      })
      setTransferTx(tHash)

      setStage('announce')
      const aHash = await writeContractAsync({
        address: ERC5564_ANNOUNCER_ADDRESS,
        abi: announcerAbi,
        functionName: 'announce',
        args: [
          STEALTH_SCHEME_ID,
          r.stealthEoa,
          r.ephemeralPub,
          viewTagAsMetadata(r.viewTag),
        ],
      })
      setAnnounceTx(aHash)

      setStage('done')
    } catch (err) {
      setStage('error')
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }

  const working = stage === 'resolving' || stage === 'transfer' || stage === 'announce'

  return (
    <Card className="space-y-4 p-6">
      <header>
        <h2 className="text-lg font-semibold">Pay {ensName}</h2>
        <p className="text-xs text-muted-foreground">
          Sends USDC on Base to a fresh stealth address + announces via ERC-5564.
        </p>
      </header>

      {!isConnected ? <ConnectButton /> : null}

      <div className="space-y-2">
        <Label htmlFor="amount">Amount (USDC)</Label>
        <Input
          id="amount"
          type="text"
          inputMode="decimal"
          placeholder="1.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      {recipient ? (
        <div className="rounded border p-3 text-xs text-muted-foreground">
          <div>
            Safe: <code>{shortAddr(recipient.safeAddress)}</code>
          </div>
          <div>
            Stealth EOA: <code>{shortAddr(recipient.stealthEoa)}</code>
          </div>
          <div>
            View tag: <code>0x{recipient.viewTag.toString(16).padStart(2, '0')}</code>
          </div>
        </div>
      ) : null}

      <Button onClick={handlePay} disabled={!isConnected || working}>
        {working ? `Working… (${stage})` : 'Send USDC + Announce'}
      </Button>

      {transferTx ? (
        <p className="text-xs">
          Transfer:{' '}
          <a
            href={`https://basescan.org/tx/${transferTx}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {shortTx(transferTx)}
          </a>
        </p>
      ) : null}
      {announceTx ? (
        <p className="text-xs">
          Announce:{' '}
          <a
            href={`https://basescan.org/tx/${announceTx}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {shortTx(announceTx)}
          </a>
        </p>
      ) : null}
      {errorMsg ? <p className="text-xs text-red-600">{errorMsg}</p> : null}
      {stage === 'done' ? (
        <p className="text-xs text-green-700">
          Sent. The recipient&apos;s dashboard should reflect this within ~2s.
        </p>
      ) : null}
    </Card>
  )
}
