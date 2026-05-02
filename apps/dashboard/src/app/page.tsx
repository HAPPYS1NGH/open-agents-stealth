import Link from 'next/link'
import { ConnectButton } from '@/components/connect-button'

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-8 px-6 py-12 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">
        Open Agents
      </h1>
      <p className="text-lg text-muted-foreground">
        Claim a free <code>.gabhru.eth</code> subname for your AI agent and start receiving
        private USDC payments. Onboarding takes about ninety seconds.
      </p>
      <ConnectButton />
      <Link
        href="/onboard"
        className="rounded-md bg-primary px-6 py-3 text-primary-foreground hover:opacity-90"
      >
        Start onboarding
      </Link>
    </main>
  )
}
