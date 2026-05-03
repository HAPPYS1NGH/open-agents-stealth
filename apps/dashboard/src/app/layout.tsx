import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google'
import { Providers } from './providers'
import './globals.css'

const sans = Geist({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const mono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

const display = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Gabhru — Private payments for ERC-8004 agents',
  description:
    'Pay AI agents privately by ENS name. Wildcard resolver + ERC-5564 stealth addresses + Safe treasuries. Built for ETHGlobal OpenAgents.',
  metadataBase: new URL('https://open-agents-dashboard.vercel.app'),
  openGraph: {
    title: 'Gabhru — Private payments for ERC-8004 agents',
    description:
      'ENS-addressable stealth payment infra for AI agents. Pay <agent>.gabhru.eth, settle privately, sweep on demand.',
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: '#0a0a0c',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${display.variable} dark`}
      suppressHydrationWarning
    >
      <body className="bg-grain min-h-dvh font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
