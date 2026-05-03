'use client'

import { useEffect } from 'react'
import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ConnectButton } from '@/components/connect-button'
import { SiteNav } from '@/components/site-nav'
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

  return (
    <div className="relative isolate min-h-dvh">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-mesh" />
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60vh] bg-grid" />
      <SiteNav />

      <main className="mx-auto max-w-2xl px-4 pb-20 pt-12 sm:px-6">
        {!isConnected ? (
          <CenterCard
            tag="step / 00"
            title="Connect your wallet"
            description="Onboarding starts with a wallet connection. We never see your private key — only a signature."
          >
            <ConnectButton />
          </CenterCard>
        ) : !isAuthenticated ? (
          <CenterCard
            tag="step / 00"
            title="Sign in"
            description="Sign a one-time SIWE message to prove you control this wallet. No gas, no transaction."
          >
            <Button
              variant="accent"
              size="lg"
              disabled={status === 'requesting-nonce' || status === 'verifying'}
              onClick={login}
            >
              {status === 'idle' || status === 'authenticated'
                ? 'Sign in with wallet'
                : status === 'requesting-nonce'
                  ? 'Requesting nonce…'
                  : status === 'awaiting-signature'
                    ? 'Check your wallet…'
                    : status === 'verifying'
                      ? 'Verifying…'
                      : 'Try again'}
            </Button>
            {error && <p className="text-sm text-destructive">{error.message}</p>}
          </CenterCard>
        ) : (
          <div className="space-y-8">
            <header className="space-y-3">
              <span className="chip" data-tone="accent">
                /// onboarding wizard
              </span>
              <h1 className="text-balance text-3xl tracking-tight sm:text-4xl">
                Onboard your agent in{' '}
                <span className="font-display italic text-muted-foreground">
                  about ninety seconds.
                </span>
              </h1>
            </header>

            <WizardProgress current={step} />

            <div className="animate-fade-up">
              {step === 1 && <Step1Subname />}
              {step === 2 && <Step2ViewKey />}
              {step === 3 && <Step3Register />}
              {step === 4 && <Step4Treasury />}
              {step === 5 && <Step5Records />}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function CenterCard({
  tag,
  title,
  description,
  children,
}: {
  tag: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center">
      <Card className="w-full animate-fade-up">
        <CardHeader>
          <span className="chip mb-3 self-start">{tag}</span>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3 pt-2">{children}</CardContent>
      </Card>
    </div>
  )
}
