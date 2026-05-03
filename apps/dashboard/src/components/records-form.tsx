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
] as const
type ProfileKey = (typeof PROFILE_KEYS)[number]['key']

/**
 * ENSIP-25 (`agent-registration[<registry>][<agentId>]`) records are
 * written by the on-chain register flow (Plan 4) — never by the user
 * directly. We render them read-only so the owner can see which
 * registries their ENS name is verified against.
 */
const ENSIP25_KEY_REGEX = /^agent-registration\[([^\]]+)\]\[([^\]]+)\]$/

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

  // Compute the "preview" of what agent-context JSON would be if we
  // auto-derived it from the ENSIP-18 inputs. Per ENSIP-26 the JSON
  // typically holds {name, description, image, …}; keep our derivation
  // aligned so consumers that only parse agent-context still see the
  // canonical values.
  const derivedAgentContext = (() => {
    const j: Record<string, string> = {}
    if (profile.name.trim()) j.name = profile.name.trim()
    if (profile.description.trim()) j.description = profile.description.trim()
    if (profile.avatar.trim()) j.image = profile.avatar.trim()
    return Object.keys(j).length > 0 ? JSON.stringify(j, null, 2) : ''
  })()

  // Find any ENSIP-25 verification records in the agent's existing records
  // so we can show them as read-only chips.
  const ensip25Rows = Object.entries(initial)
    .map(([k, v]) => {
      const m = ENSIP25_KEY_REGEX.exec(k)
      if (!m) return null
      return { key: k, registry: m[1]!, agentId: m[2]!, value: v }
    })
    .filter((row): row is { key: string; registry: string; agentId: string; value: string } => row !== null)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile · ENSIP-18</CardTitle>
          <CardDescription>
            Standard ENS profile keys. Each saves as a discrete <code>text(node, key)</code>{' '}
            record so wallets, third-party apps, and our records-preview page render them
            individually. ENSIP-26 consumers that only read <code>agent-context</code>{' '}
            JSON also see these — the agent-context blob below is auto-derived from these
            fields so the same value reaches both audiences.
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

      {ensip25Rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Verification · ENSIP-25</CardTitle>
            <CardDescription>
              On-chain agent registries this ENS name is verified against.
              Set automatically by the register-onchain flow — read-only here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {ensip25Rows.map((row) => (
              <div
                key={row.key}
                className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs"
              >
                <code className="font-mono text-foreground">{row.key}</code>
                <div className="flex gap-4 font-mono text-[11px] text-muted-foreground">
                  <span>registry: {row.registry}</span>
                  <span>agentId: {row.agentId}</span>
                  <span>value: {row.value}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Agent · ENSIP-26</CardTitle>
          <CardDescription>
            Read by ENS-aware AI clients. The endpoint fields point to your agent's
            MCP server, A2A endpoint, or website. <code>agent-context</code> is the
            ENSIP-26 JSON blob — auto-derived from your ENSIP-18 fields above.
            Override below only if you need ENSIP-26-specific keys not covered by
            ENSIP-18.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="agent-context">
              agent-context (JSON){' '}
              {!contextValue.trim() && derivedAgentContext && (
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  · auto-derived from ENSIP-18
                </span>
              )}
            </Label>
            <Textarea
              id="agent-context"
              placeholder={derivedAgentContext || '{"foo":"bar"}'}
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
