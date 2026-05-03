'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { ArrowUpRight, Copy, Plus, Settings2 } from 'lucide-react'
import { useMe } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SiteNav } from '@/components/site-nav'

const PARENT_DOMAIN = process.env['NEXT_PUBLIC_PARENT_DOMAIN'] ?? 'gabhru.eth'

export default function DashboardPage() {
  const router = useRouter()
  const { data, isAuthenticated, isLoading, error } = useMe()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.push('/')
  }, [isAuthenticated, isLoading, router])

  return (
    <div className="relative isolate min-h-dvh">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-mesh" />
      <SiteNav />

      <main className="mx-auto max-w-4xl px-4 pb-20 pt-12 sm:px-6">
        {isLoading && <SkeletonHeader />}
        {error && (
          <Card className="border-destructive/30">
            <CardContent className="py-6 text-sm text-destructive">
              Failed to load agents.
            </CardContent>
          </Card>
        )}

        {data && (
          <>
            <header className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-3">
                <span className="chip" data-tone="accent">
                  /// agents
                </span>
                <h1 className="text-balance text-4xl tracking-tight sm:text-5xl">
                  Your agents
                </h1>
                <p className="font-mono text-xs text-muted-foreground">
                  signed in as{' '}
                  <span className="text-foreground/80">
                    {short(data.ownerEoa)}
                  </span>
                </p>
              </div>
              <Link href="/onboard">
                <Button variant="accent" size="lg">
                  <Plus size={16} /> New agent
                </Button>
              </Link>
            </header>

            {data.agents.length === 0 ? (
              <EmptyState />
            ) : (
              <ul className="space-y-3">
                {data.agents.map((agent) => {
                  const fullName = `${agent.subnameLabel}.${PARENT_DOMAIN}`
                  return (
                    <li key={agent.id}>
                      <Card className="card-glow transition-colors hover:border-foreground/20">
                        <CardContent className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate font-mono text-sm font-medium text-foreground sm:text-base">
                                {fullName}
                              </span>
                              {agent.agentId ? (
                                <Badge variant="success">
                                  agent · {agent.agentId}
                                </Badge>
                              ) : (
                                <Badge variant="secondary">not registered</Badge>
                              )}
                              {agent.treasurySafeAddress ? (
                                <Badge variant="accent">treasury</Badge>
                              ) : (
                                <Badge variant="secondary">no treasury</Badge>
                              )}
                            </div>
                            <span className="block font-mono text-[11px] text-muted-foreground">
                              created {new Date(agent.createdAt).toLocaleString()}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                navigator.clipboard.writeText(fullName)
                                toast.success(`Copied ${fullName}`)
                              }}
                            >
                              <Copy size={14} /> Copy name
                            </Button>
                            <Link href={`/pay/${fullName}`}>
                              <Button size="sm" variant="ghost">
                                Pay link <ArrowUpRight size={14} />
                              </Button>
                            </Link>
                            <Link href={`/dashboard/${agent.id}` as never}>
                              <Button size="sm" variant="ghost">
                                <Settings2 size={14} /> Settings
                              </Button>
                            </Link>
                          </div>
                        </CardContent>
                      </Card>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function SkeletonHeader() {
  return (
    <div className="space-y-4">
      <div className="h-3 w-32 animate-pulse rounded bg-muted" />
      <div className="h-9 w-56 animate-pulse rounded bg-muted" />
    </div>
  )
}

function EmptyState() {
  return (
    <Card className="overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-30" />
      <CardHeader className="relative">
        <CardTitle>No agents yet.</CardTitle>
        <CardDescription>
          Onboard your first agent to claim a free <code>.gabhru.eth</code> name and start
          receiving private USDC payments.
        </CardDescription>
      </CardHeader>
      <CardContent className="relative">
        <Link href="/onboard">
          <Button variant="accent" size="lg">
            <Plus size={16} /> Onboard your first agent
          </Button>
        </Link>
      </CardContent>
    </Card>
  )
}

function short(addr: string | undefined | null) {
  if (!addr) return ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
