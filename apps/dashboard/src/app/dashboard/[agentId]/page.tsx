'use client'

import { use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import useSWR from 'swr'
import { useMe } from '@/hooks/use-me'
import { getApiClient } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
      <main className="mx-auto max-w-2xl p-6 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Agent not found</CardTitle>
            <CardDescription>{error.message}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard">
              <Button variant="outline">Back to agents</Button>
            </Link>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (!agent) return <main className="p-8 text-sm text-muted-foreground">Loading…</main>

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
    <main className="mx-auto max-w-2xl p-6 py-12 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{fullName}</h1>
          <p className="text-xs text-muted-foreground">
            <Link href="/dashboard" className="underline">
              ← back to agents
            </Link>
          </p>
        </div>
        <Link
          href={`https://app.ens.domains/${fullName}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs underline"
        >
          Preview ENS profile
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Owner: </span>
            <code>{agent.ownerEoa}</code>
          </div>
          <div>
            <span className="text-muted-foreground">On-chain ID: </span>
            {agent.agentId ? <Badge variant="success">{agent.agentId}</Badge> : <Badge variant="secondary">not registered</Badge>}
          </div>
          <div>
            <span className="text-muted-foreground">Agent wallet: </span>
            <code>{agent.agentWalletEoa ?? 'not set'}</code>
          </div>
          <div>
            <span className="text-muted-foreground">Treasury Safe: </span>
            <code>{agent.treasurySafeAddress ?? 'not deployed'}</code>
          </div>
          <div className="flex items-center justify-between gap-4 pt-2">
            <div>
              <span className="text-muted-foreground">stealth-meta record: </span>
              {agent.textRecords['stealth-meta'] ? (
                <Badge variant="success">published</Badge>
              ) : (
                <Badge variant="secondary">missing — re-derive to publish</Badge>
              )}
            </div>
            <RederiveStealthKeysButton
              agentId={agentId}
              hasExistingEnvelope={agent.viewKeyState === 'v1' || agent.viewKeyState === 'stub'}
              onDone={() => mutate()}
            />
          </div>
        </CardContent>
      </Card>

      <RecordsForm initial={agent.textRecords} onSubmit={handleSave} />
    </main>
  )
}
