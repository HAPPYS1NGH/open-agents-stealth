'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { Copy, ExternalLink, Plus } from 'lucide-react'
import { useMe } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const PARENT_DOMAIN = process.env['NEXT_PUBLIC_PARENT_DOMAIN'] ?? 'gabhru.eth'

export default function DashboardPage() {
  const router = useRouter()
  const { data, isAuthenticated, isLoading, error } = useMe()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.push('/')
  }, [isAuthenticated, isLoading, router])

  if (isLoading) return <main className="p-8 text-sm text-muted-foreground">Loading…</main>
  if (error || !data) return <main className="p-8 text-sm text-destructive">Failed to load agents.</main>

  return (
    <main className="mx-auto max-w-3xl p-6 py-12 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Your agents</h1>
          <p className="text-sm text-muted-foreground">Signed in as <code>{data.ownerEoa}</code></p>
        </div>
        <Link href="/onboard">
          <Button>
            <Plus size={16} /> New agent
          </Button>
        </Link>
      </div>

      {data.agents.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No agents yet</CardTitle>
          </CardHeader>
          <CardContent>
            <Link href="/onboard">
              <Button>Onboard your first agent</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <ul className="space-y-3">
        {data.agents.map((agent) => {
          const fullName = `${agent.subnameLabel}.${PARENT_DOMAIN}`
          return (
            <li key={agent.id}>
              <Card>
                <CardContent className="flex items-center justify-between gap-4 py-4">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{fullName}</span>
                      {agent.agentId ? (
                        <Badge variant="success">{agent.agentId}</Badge>
                      ) : (
                        <Badge variant="secondary">not registered</Badge>
                      )}
                      {agent.treasurySafeAddress ? (
                        <Badge variant="outline">treasury</Badge>
                      ) : (
                        <Badge variant="secondary">no treasury</Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Created {new Date(agent.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(fullName)
                        toast.success(`Copied ${fullName}`)
                      }}
                    >
                      <Copy size={14} /> Copy receive link
                    </Button>
                    <Link href={`/dashboard/${agent.id}` as never}>
                      <Button size="sm" variant="ghost">
                        Settings <ExternalLink size={14} />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
