'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const ENDPOINT_KEYS = ['mcp', 'a2a', 'web'] as const
type EndpointKey = (typeof ENDPOINT_KEYS)[number]

export interface RecordsFormProps {
  initial: Record<string, string>
  onSubmit: (records: Record<string, string>) => Promise<void> | void
  submitLabel?: string
}

interface ValidationErrors {
  context?: string
  endpoints: Partial<Record<EndpointKey, string>>
}

function validate(
  contextValue: string,
  endpoints: Record<EndpointKey, string>,
): ValidationErrors {
  const errors: ValidationErrors = { endpoints: {} }
  if (contextValue.trim().length > 0) {
    try {
      JSON.parse(contextValue)
    } catch {
      errors.context = 'agent-context must be valid JSON'
    }
  }
  for (const key of ENDPOINT_KEYS) {
    const v = endpoints[key].trim()
    if (v.length === 0) continue
    try {
      const u = new URL(v)
      if (!['http:', 'https:'].includes(u.protocol)) {
        errors.endpoints[key] = `agent-endpoint[${key}] must be a valid URL`
      }
    } catch {
      errors.endpoints[key] = `agent-endpoint[${key}] must be a valid URL`
    }
  }
  return errors
}

export function RecordsForm({ initial, onSubmit, submitLabel = 'Save records' }: RecordsFormProps) {
  const [contextValue, setContextValue] = useState(initial['agent-context'] ?? '')
  const [endpoints, setEndpoints] = useState<Record<EndpointKey, string>>({
    mcp: initial['agent-endpoint[mcp]'] ?? '',
    a2a: initial['agent-endpoint[a2a]'] ?? '',
    web: initial['agent-endpoint[web]'] ?? '',
  })
  const [errors, setErrors] = useState<ValidationErrors>({ endpoints: {} })
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    const validation = validate(contextValue, endpoints)
    setErrors(validation)
    if (validation.context || Object.keys(validation.endpoints).length > 0) return

    const records: Record<string, string> = {}
    if (contextValue.trim()) records['agent-context'] = contextValue.trim()
    for (const key of ENDPOINT_KEYS) {
      const v = endpoints[key].trim()
      if (v) records[`agent-endpoint[${key}]`] = v
    }
    setSubmitting(true)
    try {
      await onSubmit(records)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>ENSIP-26 records</CardTitle>
        <CardDescription>
          These are read by ENS-aware clients when they look up your agent. <code>agent-context</code> is a
          JSON profile (name, description, image). The endpoint fields point to your agent's MCP server,
          A2A endpoint, or website.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="agent-context">agent-context (JSON)</Label>
          <Textarea
            id="agent-context"
            placeholder='{"name":"My agent","description":"…","image":"https://…"}'
            rows={4}
            value={contextValue}
            onChange={(e) => setContextValue(e.target.value)}
          />
          {errors.context && <p className="text-xs text-destructive">{errors.context}</p>}
        </div>
        {ENDPOINT_KEYS.map((key) => (
          <div key={key} className="space-y-2">
            <Label htmlFor={`agent-endpoint-${key}`}>agent-endpoint[{key}]</Label>
            <Input
              id={`agent-endpoint-${key}`}
              placeholder={`https://your-agent.example/${key}`}
              value={endpoints[key]}
              onChange={(e) => setEndpoints((prev) => ({ ...prev, [key]: e.target.value }))}
            />
            {errors.endpoints[key] && (
              <p className="text-xs text-destructive">{errors.endpoints[key]}</p>
            )}
          </div>
        ))}
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Saving…' : submitLabel}
        </Button>
      </CardFooter>
    </Card>
  )
}
