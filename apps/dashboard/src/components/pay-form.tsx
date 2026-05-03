'use client'

import { useState } from 'react'
import { useAccount, useWriteContract } from 'wagmi'
import { ArrowUpRight, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
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

const STAGE_LABEL: Record<Exclude<Stage, 'idle' | 'done' | 'error'>, string> = {
  resolving: 'Resolving via CCIP-Read…',
  transfer: 'Approve USDC transfer in your wallet',
  announce: 'Approve ERC-5564 announce',
}

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
    <Card>
      <CardContent className="space-y-6 px-6 py-6">
        {!isConnected ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-muted/40 p-4">
            <p className="text-sm text-muted-foreground">
              Connect a wallet on Base to send USDC.
            </p>
            <ConnectButton />
          </div>
        ) : null}

        <div className="space-y-2.5">
          <Label htmlFor="amount">Amount · USDC</Label>
          <div className="relative">
            <Input
              id="amount"
              type="text"
              inputMode="decimal"
              placeholder="1.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-14 pr-20 font-mono text-2xl tracking-tight"
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              usdc
            </span>
          </div>
        </div>

        {recipient ? (
          <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-4 font-mono text-[11px] leading-relaxed">
            <Row k="resolved" v={ensName} accent />
            <Row k="safe" v={shortAddr(recipient.safeAddress)} />
            <Row k="stealth eoa" v={shortAddr(recipient.stealthEoa)} />
            <Row
              k="view tag"
              v={`0x${recipient.viewTag.toString(16).padStart(2, '0')}`}
            />
          </div>
        ) : null}

        <Button
          variant="accent"
          size="xl"
          className="w-full"
          onClick={handlePay}
          disabled={!isConnected || working || !amount}
        >
          {working ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {STAGE_LABEL[stage as 'resolving' | 'transfer' | 'announce']}
            </>
          ) : stage === 'done' ? (
            <>
              <Check className="h-4 w-4" /> Sent
            </>
          ) : (
            'Send USDC + announce'
          )}
        </Button>

        {(transferTx || announceTx || errorMsg || stage === 'done') && (
          <div className="space-y-2 border-t border-border pt-4 text-xs">
            {transferTx && (
              <TxRow label="transfer" hash={transferTx} />
            )}
            {announceTx && (
              <TxRow label="announce" hash={announceTx} />
            )}
            {stage === 'done' && (
              <p className="flex items-center gap-2 text-success">
                <Check className="h-3.5 w-3.5" />
                Sent. Recipient dashboard updates in ~2s.
              </p>
            )}
            {errorMsg && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 font-mono text-destructive">
                {errorMsg}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className={accent ? 'text-accent' : 'text-foreground'}>{v}</span>
    </div>
  )
}

function TxRow({ label, hash }: { label: string; hash: `0x${string}` }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <a
        href={`https://basescan.org/tx/${hash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 font-mono text-foreground hover:text-accent"
      >
        {shortTx(hash)} <ArrowUpRight className="h-3 w-3" />
      </a>
    </div>
  )
}
