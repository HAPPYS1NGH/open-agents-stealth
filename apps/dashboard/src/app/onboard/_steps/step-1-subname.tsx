'use client'

import { useState } from 'react'
import { useAccount } from 'wagmi'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useWizardStore } from '../_store'
import { useCreateAgent } from '@/hooks/use-create-agent'

const LABEL_REGEX = /^[a-z0-9-]{1,63}$/

const PARENT_DOMAIN = process.env['NEXT_PUBLIC_PARENT_DOMAIN'] ?? 'gabhru.eth'

export function Step1Subname() {
  const [label, setLabel] = useState('')
  const { address } = useAccount()
  const { setSubname, next } = useWizardStore()
  const { create, isPending, error } = useCreateAgent()

  const labelValid = LABEL_REGEX.test(label)

  async function handleSubmit() {
    if (!address) {
      toast.error('Wallet not connected')
      return
    }
    if (!labelValid) {
      toast.error('Use 1–63 lowercase letters, numbers, or hyphens')
      return
    }
    const agent = await create({
      subnameLabel: label,
      baseAddr: address,
      textRecords: {},
    })
    if (!agent) {
      if (error?.code === 'conflict') {
        toast.error(`'${label}.${PARENT_DOMAIN}' is taken — try another label`)
      } else if (error) {
        toast.error(error.message)
      }
      return
    }
    setSubname(agent.id, agent.subnameLabel)
    toast.success(`Reserved ${agent.subnameLabel}.${PARENT_DOMAIN}`)
    next()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pick your agent name</CardTitle>
        <CardDescription>
          You will receive payments at <code>&lt;name&gt;.{PARENT_DOMAIN}</code>. Lowercase letters,
          digits, and hyphens only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="label">Subname</Label>
          <div className="flex items-center gap-2">
            <Input
              id="label"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="mybot"
              value={label}
              onChange={(e) => setLabel(e.target.value.toLowerCase())}
            />
            <span className="text-sm text-muted-foreground">.{PARENT_DOMAIN}</span>
          </div>
          {label && !labelValid && (
            <p className="text-xs text-destructive">
              Use 1–63 characters: lowercase letters, digits, or hyphens.
            </p>
          )}
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <Button disabled={!labelValid || isPending} onClick={handleSubmit}>
          {isPending ? 'Reserving…' : 'Reserve subname'}
        </Button>
      </CardFooter>
    </Card>
  )
}
