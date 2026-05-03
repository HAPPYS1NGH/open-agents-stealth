'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const ENDPOINT_KEYS = ['mcp', 'a2a', 'web'] as const
type EndpointKey = (typeof ENDPOINT_KEYS)[number]

/**
 * ENSIP-18 standard text-record keys we surface as discrete inputs.
 *
 * Storing each as a separate text record (rather than nesting inside
 * agent-context JSON) is what lets ENS-aware tooling — wallets, third-party
 * apps, our own /records-preview page — pick them up via direct
 * text(node, key) lookups. Nested inside agent-context they're invisible
 * to anything that doesn't parse our specific JSON shape.
 */
const PROFILE_KEYS = [
  { key: 'name', label: 'name', placeholder: 'Display name', type: 'text' as const },
  { key: 'description', label: 'description', placeholder: 'Short bio (≤160 chars)', type: 'textarea' as const },
  { key: 'avatar', label: 'avatar', placeholder: 'https://… (image URL or ipfs://…)', type: 'url-or-ipfs' as const },
  { key: 'url', label: 'url', placeholder: 'https://your-website.example', type: 'url' as const },
  { key: 'com.github', label: 'com.github', placeholder: 'github-handle (no @)', type: 'text' as const },
  { key: 'com.twitter', label: 'com.twitter', placeholder: 'twitter-handle (no @)', type: 'text' as const },
] as const
type ProfileKey = (typeof PROFILE_KEYS)[number]['key']

export interface RecordsFormProps {
  initial: Record<string, string>
  onSubmit: (records: Record<string, string>) => Promise<void> | void
  submitLabel?: string
}

interface ValidationErrors {
  context?: string
  endpoints: Partial<Record<EndpointKey, string>>
  profile: Partial<Record<ProfileKey, string>>
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v)
    return ['http:', 'https:'].includes(u.protocol)
  } catch {
    return false
  }
}

function isAvatarValue(v: string): boolean {
  // ENSIP-12 avatar accepts https:// + ipfs:// + eip155:… NFT pointers.
  // We validate the two common cases and accept eip155:* without further
  // parsing (full validation is out of scope here).
  if (v.startsWith('ipfs://') && v.length > 'ipfs://'.length) return true
  if (v.startsWith('eip155:')) return true
  return isHttpUrl(v)
}

function validate(
  contextValue: string,
  endpoints: Record<EndpointKey, string>,
  profile: Record<ProfileKey, string>,
): ValidationErrors {
  const errors: ValidationErrors = { endpoints: {}, profile: {} }
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
    if (!isHttpUrl(v)) {
      errors.endpoints[key] = `agent-endpoint[${key}] must be a valid URL`
    }
  }
  for (const pk of PROFILE_KEYS) {
    const v = profile[pk.key].trim()
    if (v.length === 0) continue
    if (pk.key === 'description' && v.length > 160) {
      errors.profile[pk.key] = 'description must be ≤160 chars (ENSIP-18)'
    } else if (pk.key === 'url' && !isHttpUrl(v)) {
      errors.profile[pk.key] = 'url must be http(s)://…'
    } else if (pk.key === 'avatar' && !isAvatarValue(v)) {
      errors.profile[pk.key] = 'avatar must be http(s)://, ipfs://, or eip155:…'
    }
  }
  return errors
}

const initialProfile = (initial: Record<string, string>): Record<ProfileKey, string> =>
  Object.fromEntries(PROFILE_KEYS.map((p) => [p.key, initial[p.key] ?? ''])) as Record<ProfileKey, string>

export function RecordsForm({ initial, onSubmit, submitLabel = 'Save records' }: RecordsFormProps) {
  const [contextValue, setContextValue] = useState(initial['agent-context'] ?? '')
  const [endpoints, setEndpoints] = useState<Record<EndpointKey, string>>({
    mcp: initial['agent-endpoint[mcp]'] ?? '',
    a2a: initial['agent-endpoint[a2a]'] ?? '',
    web: initial['agent-endpoint[web]'] ?? '',
  })
  const [profile, setProfile] = useState<Record<ProfileKey, string>>(initialProfile(initial))
  const [errors, setErrors] = useState<ValidationErrors>({ endpoints: {}, profile: {} })
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    const validation = validate(contextValue, endpoints, profile)
    setErrors(validation)
    if (
      validation.context ||
      Object.keys(validation.endpoints).length > 0 ||
      Object.keys(validation.profile).length > 0
    ) {
      return
    }

    const records: Record<string, string> = {}
    if (contextValue.trim()) records['agent-context'] = contextValue.trim()
    for (const key of ENDPOINT_KEYS) {
      const v = endpoints[key].trim()
      if (v) records[`agent-endpoint[${key}]`] = v
    }
    for (const pk of PROFILE_KEYS) {
      const v = profile[pk.key].trim()
      if (v) records[pk.key] = v
    }
    setSubmitting(true)
    try {
      await onSubmit(records)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile · ENSIP-18</CardTitle>
          <CardDescription>
            Standard ENS profile keys. Each saves as a discrete <code>text(node, key)</code>{' '}
            record so wallets, third-party apps, and our records-preview page render them
            individually — not nested inside <code>agent-context</code> JSON.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {PROFILE_KEYS.map((pk) => (
            <div key={pk.key} className="space-y-2">
              <Label htmlFor={`profile-${pk.key}`}>{pk.label}</Label>
              {pk.type === 'textarea' ? (
                <Textarea
                  id={`profile-${pk.key}`}
                  placeholder={pk.placeholder}
                  rows={2}
                  value={profile[pk.key]}
                  onChange={(e) => setProfile((prev) => ({ ...prev, [pk.key]: e.target.value }))}
                />
              ) : (
                <Input
                  id={`profile-${pk.key}`}
                  type="text"
                  placeholder={pk.placeholder}
                  value={profile[pk.key]}
                  onChange={(e) => setProfile((prev) => ({ ...prev, [pk.key]: e.target.value }))}
                />
              )}
              {errors.profile[pk.key] && (
                <p className="text-xs text-destructive">{errors.profile[pk.key]}</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agent · ENSIP-26</CardTitle>
          <CardDescription>
            Read by ENS-aware AI clients when looking up your agent.{' '}
            <code>agent-context</code> is a JSON profile blob (legacy format —
            prefer the per-key inputs above for new fields). The endpoint fields
            point to your agent's MCP server, A2A endpoint, or website.
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
    </div>
  )
}
