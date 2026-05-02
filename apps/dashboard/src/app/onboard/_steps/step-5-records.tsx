'use client'

import Link from 'next/link'
import { toast } from 'sonner'
import { useWizardStore } from '../_store'
import { RecordsForm } from '@/components/records-form'
import { getApiClient } from '@/lib/api-client'
import type { AgentResponse, PatchAgentBody } from '@/types/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

const PARENT_DOMAIN = process.env['NEXT_PUBLIC_PARENT_DOMAIN'] ?? 'gabhru.eth'

export function Step5Records() {
  const { agentRowId, subnameLabel, next } = useWizardStore()

  async function handleSubmit(records: Record<string, string>) {
    if (!agentRowId) {
      toast.error('No agent row — restart wizard')
      return
    }
    const body: PatchAgentBody = { textRecords: records }
    try {
      await getApiClient().patch<AgentResponse>(`/agents/${agentRowId}`, body)
      toast.success('Records published')
      next()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-4">
      <RecordsForm initial={{}} onSubmit={handleSubmit} submitLabel="Publish records & finish" />
      {subnameLabel && (
        <Card>
          <CardHeader>
            <CardTitle>Almost done</CardTitle>
            <CardDescription>
              After publishing, you can preview your full ENS profile:
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              className="text-sm underline"
              href={`https://app.ens.domains/${subnameLabel}.${PARENT_DOMAIN}`}
              target="_blank"
              rel="noreferrer"
            >
              app.ens.domains/{subnameLabel}.{PARENT_DOMAIN}
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
