'use client'

import { useEffect } from 'react'
import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ConnectButton } from '@/components/connect-button'
import { WizardProgress } from '@/components/wizard-progress'
import { useWizardStore } from './_store'
import { useSiweLogin } from '@/hooks/use-siwe-login'
import { useMe } from '@/hooks/use-me'
import { Step1Subname } from './_steps/step-1-subname'
import { Step2ViewKey } from './_steps/step-2-viewkey'
import { Step3Register } from './_steps/step-3-register'
import { Step4Treasury } from './_steps/step-4-treasury'
import { Step5Records } from './_steps/step-5-records'
import { Button } from '@/components/ui/button'

export default function OnboardPage() {
  const { isConnected } = useAccount()
  const { isAuthenticated } = useMe()
  const { status, login, error } = useSiweLogin()
  const step = useWizardStore((s) => s.step)
  const router = useRouter()

  useEffect(() => {
    if (step === 'done') router.push('/dashboard')
  }, [step, router])

  if (!isConnected) {
    return (
      <main className="mx-auto max-w-xl p-6 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Connect your wallet</CardTitle>
            <CardDescription>
              Onboarding starts with a wallet connection. We never see your private key.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConnectButton />
          </CardContent>
        </Card>
      </main>
    )
  }

  if (!isAuthenticated) {
    return (
      <main className="mx-auto max-w-xl p-6 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Sign a one-time message to prove you control this wallet. No gas, no transaction.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button disabled={status === 'requesting-nonce' || status === 'verifying'} onClick={login}>
              {status === 'idle' || status === 'authenticated' ? 'Sign in with wallet' :
                status === 'requesting-nonce' ? 'Requesting nonce…' :
                status === 'awaiting-signature' ? 'Check your wallet…' :
                status === 'verifying' ? 'Verifying…' :
                'Try again'}
            </Button>
            {error && <p className="text-sm text-destructive">{error.message}</p>}
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-2xl p-6 py-12 space-y-6">
      <WizardProgress current={step} />
      {step === 1 && <Step1Subname />}
      {step === 2 && <Step2ViewKey />}
      {step === 3 && <Step3Register />}
      {step === 4 && <Step4Treasury />}
      {step === 5 && <Step5Records />}
    </main>
  )
}
