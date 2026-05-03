'use client'

import { use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import useSWR from 'swr'
import { ArrowUpRight, ChevronLeft } from 'lucide-react'
import { useMe } from '@/hooks/use-me'
import { getApiClient } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SiteNav } from '@/components/site-nav'
import { RecordsForm } from '@/components/records-form'
import { RederiveStealthKeysButton } from '@/components/rederive-stealth-keys-button'
import type { AgentResponse, PatchAgentBody } from '@/types/api'

const PARENT_DOMAIN = process.env['NEXT_PUBLIC_PARENT_DOMAIN'] ?? 'gabhru.eth'

interface PageProps {
  params: Promise<{ agentId: string }>
}

export default function AgentSettingsPage({ params }: PageProps) {
  const { agentId } = use(params)
  const router = useRouter()
  const { isAuthenticated } = useMe()

  const { data: agent, error, mutate } = useSWR<AgentResponse, Error>(
    isAuthenticated ? `/agents/${agentId}` : null,
    (path: string) => getApiClient().get<AgentResponse>(path),
    { revalidateOnFocus: false },
  )

  if (!isAuthenticated) {
    if (typeof window !== 'undefined') router.push('/')
    return null
  }

  if (error) {
    return (
      <Shell>
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle>Agent not found</CardTitle>
            <CardDescription>{error.message}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard">
              <Button variant="outline">
                <ChevronLeft size={14} /> Back to agents
              </Button>
            </Link>
          </CardContent>
        </Card>
      </Shell>
    )
  }

  if (!agent)
    return (
      <Shell>
        <p className="font-mono text-xs text-muted-foreground">loading…</p>
      </Shell>
    )

  async function handleSave(records: Record<string, string>) {
    const body: PatchAgentBody = { textRecords: records }
    try {
      await getApiClient().patch<AgentResponse>(`/agents/${agentId}`, body)
      toast.success('Records updated')
      mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const fullName = `${agent.subnameLabel}.${PARENT_DOMAIN}`

  return (
    <Shell>
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft size={12} /> all agents
          </Link>
          <h1 className="font-mono text-3xl font-medium tracking-tight">{fullName}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/dashboard/${agentId}/payments`}>
            <Button variant="outline" size="sm">
              View payments <ArrowUpRight size={14} />
            </Button>
          </Link>
          <a
            href={`https://app.ens.domains/${fullName}`}
            target="_blank"
            rel="noreferrer"
          >
            <Button variant="ghost" size="sm">
              ENS profile <ArrowUpRight size={14} />
            </Button>
          </a>
        </div>
      </header>

      <section className="space-y-6">
        <Card>
          <CardHeader>
            <span className="chip mb-1 self-start">/// identity</span>
            <CardTitle>Identity</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <Field k="owner" v={agent.ownerEoa} mono />
            <Field
              k="agent wallet"
              v={agent.agentWalletEoa ?? 'not set'}
              mono
              muted={!agent.agentWalletEoa}
            />
            <Field
              k="treasury safe"
              v={agent.treasurySafeAddress ?? 'not deployed'}
              mono
              muted={!agent.treasurySafeAddress}
            />
            <div>
              <Label>on-chain id</Label>
              <div className="mt-1.5">
                {agent.agentId ? (
                  <Badge variant="success">agent · {agent.agentId}</Badge>
                ) : (
                  <Badge variant="secondary">not registered</Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <span className="chip mb-1 self-start">/// stealth keys</span>
            <CardTitle>Stealth meta-address</CardTitle>
            <CardDescription>
              The <code>stealth-meta</code> text record under your subname is what senders
              read to derive a fresh address.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {agent.textRecords['stealth-meta'] ? (
              <Badge variant="success">published</Badge>
            ) : (
              <Badge variant="warning">missing — re-derive to publish</Badge>
            )}
            <RederiveStealthKeysButton
              agentId={agentId}
              hasExistingEnvelope={agent.viewKeyState === 'v1' || agent.viewKeyState === 'stub'}
              onDone={() => mutate()}
            />
          </CardContent>
        </Card>

        <RecordsForm initial={agent.textRecords} onSubmit={handleSave} />
      </section>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate min-h-dvh">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-mesh" />
      <SiteNav />
      <main className="mx-auto max-w-3xl px-4 pb-20 pt-12 sm:px-6">{children}</main>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </span>
  )
}

function Field({
  k,
  v,
  mono,
  muted,
}: {
  k: string
  v: string
  mono?: boolean
  muted?: boolean
}) {
  return (
    <div className="min-w-0">
      <Label>{k}</Label>
      <div
        className={`mt-1.5 truncate text-sm ${mono ? 'font-mono' : ''} ${
          muted ? 'text-muted-foreground' : 'text-foreground'
        }`}
      >
        {v}
      </div>
    </div>
  )
}
