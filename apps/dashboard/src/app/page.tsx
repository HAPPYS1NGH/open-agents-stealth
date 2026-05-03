import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .5a12 12 0 0 0-3.79 23.4c.6.11.82-.26.82-.58v-2.05c-3.34.73-4.04-1.6-4.04-1.6-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.66-.3-5.46-1.33-5.46-5.93 0-1.31.47-2.39 1.24-3.23-.13-.31-.54-1.55.11-3.22 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.3-1.55 3.3-1.23 3.3-1.23.66 1.67.25 2.9.12 3.22.78.84 1.24 1.92 1.24 3.23 0 4.62-2.81 5.62-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" />
    </svg>
  )
}

import { SiteNav } from '@/components/site-nav'
import { HeroTerminal } from '@/components/hero-terminal'

export default function HomePage() {
  return (
    <div className="relative isolate overflow-hidden">
      {/* atmosphere */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-mesh" />
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[80vh] bg-grid" />

      <SiteNav />

      <main className="relative">
        <Hero />
        <Pillars />
        <HowItWorks />
        <Stack />
        <Plans />
        <Footer />
      </main>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pt-24 lg:pt-32">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
        {/* Left column: copy */}
        <div className="lg:col-span-7">
          <span className="chip animate-fade-up" data-tone="accent">
            <span className="dot-live" /> ETHGlobal · ENS track · live on mainnet
          </span>

          <h1 className="mt-7 max-w-3xl text-balance text-5xl leading-[1.02] tracking-tight sm:text-6xl lg:text-[5.25rem]">
            <span className="animate-fade-up stagger-1 block">
              Pay AI agents
            </span>
            <span className="animate-fade-up stagger-2 block">
              <span className="font-display italic text-accent">privately</span>,
            </span>
            <span className="animate-fade-up stagger-3 block text-muted-foreground/90">
              by name.
            </span>
          </h1>

          <p className="animate-fade-up stagger-4 mt-7 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
            Gabhru gives every ERC-8004 agent a free{' '}
            <code className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
              &lt;name&gt;.gabhru.eth
            </code>{' '}
            subname. Senders type the name, your wallet pays a fresh stealth
            address. The mempool sees nothing. The agent sees USDC.
          </p>

          <div className="animate-fade-up stagger-5 mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/onboard"
              className="btn-accent-shadow inline-flex h-12 items-center gap-2 rounded-md bg-accent px-6 text-sm font-medium text-accent-foreground transition-transform hover:-translate-y-px"
            >
              Onboard your agent
              <ArrowUpRight className="h-4 w-4" />
            </Link>
            <Link
              href="/pay/test.gabhru.eth"
              className="inline-flex h-12 items-center gap-2 rounded-md border border-border bg-card/50 px-6 text-sm font-medium text-foreground backdrop-blur transition-colors hover:bg-muted"
            >
              Try the pay flow →
            </Link>
            <a
              href="https://github.com/HAPPYS1NGH/open-agents-stealth"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <GitHubIcon className="h-4 w-4" /> source
            </a>
          </div>

          <dl className="animate-fade-up stagger-6 mt-12 grid max-w-xl grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
            <Stat k="parent ENS" v="gabhru.eth" mono />
            <Stat k="resolver" v="0x6c11…f777" mono />
            <Stat k="onboarding" v="≈ 90s" />
          </dl>
        </div>

        {/* Right column: terminal */}
        <div className="lg:col-span-5">
          <div className="animate-fade-up stagger-3 lg:sticky lg:top-24">
            <HeroTerminal />

            <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="font-mono">~ replays every 4.5s</span>
              <a
                href="https://app.ens.domains/gabhru.eth"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                view on ENS app <ArrowUpRight className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Stat({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="bg-card px-4 py-3">
      <dt className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {k}
      </dt>
      <dd className={`mt-1 truncate text-sm ${mono ? 'font-mono' : ''}`}>{v}</dd>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────── */

function Pillars() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="mb-10 flex items-end justify-between">
        <div>
          <span className="chip">/// what you get</span>
          <h2 className="mt-4 max-w-2xl text-balance text-3xl tracking-tight sm:text-4xl">
            Three primitives,{' '}
            <span className="font-display italic text-muted-foreground">
              one product surface.
            </span>
          </h2>
        </div>
      </div>

      <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3">
        <Pillar
          tag="01"
          title="Wildcard ENS"
          body="Every agent gets a free <name>.gabhru.eth. CCIP-Read gateway resolves on-the-fly with EIP-712 signed payloads — no L1 writes per agent."
          links={[
            ['Resolver on Etherscan', 'https://etherscan.io/address/0x6c11e3cb958c84cfd339123a2b9c4196c755f777#code'],
            ['gabhru.eth on ENS', 'https://app.ens.domains/gabhru.eth'],
          ]}
        />
        <Pillar
          tag="02"
          title="Stealth payments"
          body="ERC-5564 + ERC-6538. Sender derives a fresh address from the agent's spend/view keys. Each USDC payment lands at a unique unlinkable EOA."
        />
        <Pillar
          tag="03"
          title="Safe treasury"
          body="Each agent owns a Safe on Base. Sweeper job rolls stealth balances up to the treasury on a schedule. Reputation links the Safe to ERC-8004."
        />
      </div>
    </section>
  )
}

function Pillar({
  tag,
  title,
  body,
  links,
}: {
  tag: string
  title: string
  body: string
  links?: Array<[string, string]>
}) {
  return (
    <div className="card-glow group relative bg-card p-7 transition-colors">
      <div className="mb-5 flex items-baseline justify-between">
        <span className="font-mono text-xs tracking-[0.18em] text-muted-foreground">
          /{tag}
        </span>
        <span className="h-1.5 w-1.5 rounded-full bg-accent/60 transition-transform group-hover:scale-150" />
      </div>
      <h3 className="text-xl tracking-tight">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
      {links && (
        <ul className="mt-5 space-y-1.5 text-xs">
          {links.map(([label, href]) => (
            <li key={href}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-accent"
              >
                <ArrowUpRight className="h-3 w-3" /> {label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────── */

function HowItWorks() {
  const steps: Array<{ n: string; head: string; sub: string }> = [
    {
      n: '01',
      head: 'Sender types the name',
      sub: '"alice.gabhru.eth" — viem/ethers/Rainbow all just work via CCIP-Read.',
    },
    {
      n: '02',
      head: 'Gateway returns recipe',
      sub: 'EIP-712 signed payload: meta-address, encrypted view key, ephemeral pubkey, view tag.',
    },
    {
      n: '03',
      head: 'Stealth address derived',
      sub: 'Sender computes a fresh EOA only the agent can spend from. ERC-5564 announce.',
    },
    {
      n: '04',
      head: 'Scanner detects + sweeps',
      sub: 'Agent dashboard updates in ~2s. Sweeper rolls funds to its Safe on schedule.',
    },
  ]

  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="mb-10">
        <span className="chip">/// how a payment travels</span>
        <h2 className="mt-4 max-w-2xl text-balance text-3xl tracking-tight sm:text-4xl">
          One name in.{' '}
          <span className="font-display italic text-muted-foreground">
            Four hops. Zero linkability.
          </span>
        </h2>
      </div>

      <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li
            key={s.n}
            className="relative rounded-xl border border-border bg-card p-6 transition-colors hover:border-accent/30"
          >
            <span className="font-mono text-xs tracking-[0.18em] text-muted-foreground">
              step /{s.n}
            </span>
            <h3 className="mt-3 text-base tracking-tight">{s.head}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {s.sub}
            </p>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className="absolute -right-3 top-12 hidden h-px w-6 bg-linear-to-r from-border to-transparent lg:block"
              />
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────── */

function Stack() {
  const items: Array<[string, string]> = [
    ['ENS', 'Wildcard CCIP-Read resolver'],
    ['ERC-5564', 'Stealth address standard'],
    ['ERC-6538', 'Stealth meta-address registry'],
    ['ERC-8004', 'Trustless agent identity'],
    ['Base', 'USDC settlement'],
    ['Safe', 'Per-agent treasury'],
    ['Hono', 'Gateway + REST API'],
    ['Next.js 16', 'Onboarding dashboard'],
  ]
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="mb-8">
        <span className="chip">/// stack</span>
        <h2 className="mt-4 max-w-2xl text-balance text-3xl tracking-tight sm:text-4xl">
          Open standards,{' '}
          <span className="font-display italic text-muted-foreground">
            stitched honestly.
          </span>
        </h2>
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        {items.map(([k, v]) => (
          <div key={k} className="bg-card px-5 py-5">
            <div className="font-mono text-xs uppercase tracking-[0.18em] text-accent/90">
              {k}
            </div>
            <div className="mt-2 text-sm text-muted-foreground">{v}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────── */

function Plans() {
  const plans: Array<{ n: string; t: string; status: 'done' | 'wip' | 'next' }> = [
    { n: '01', t: 'Foundation + ENS resolver', status: 'done' },
    { n: '02', t: 'Postgres, SIWE, agent CRUD', status: 'done' },
    { n: '03', t: 'Onboarding wizard', status: 'done' },
    { n: '04', t: 'Stealth crypto + gateway integration', status: 'done' },
    { n: '05', t: 'Scanner + dashboard', status: 'wip' },
    { n: '06', t: 'TypeScript SDK', status: 'next' },
    { n: '07', t: 'Sweep + reputation + demo polish', status: 'next' },
  ]
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <span className="chip">/// roadmap</span>
          <h2 className="mt-4 text-3xl tracking-tight sm:text-4xl">
            Built in public,{' '}
            <span className="font-display italic text-muted-foreground">
              shipping in plans.
            </span>
          </h2>
        </div>
      </div>

      <ul className="overflow-hidden rounded-xl border border-border">
        {plans.map((p, i) => (
          <li
            key={p.n}
            className={`flex items-center gap-4 bg-card px-5 py-4 ${
              i !== plans.length - 1 ? 'border-b border-border' : ''
            }`}
          >
            <span className="font-mono text-xs tracking-[0.18em] text-muted-foreground">
              plan/{p.n}
            </span>
            <span className="flex-1 text-sm">{p.t}</span>
            <PlanBadge status={p.status} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function PlanBadge({ status }: { status: 'done' | 'wip' | 'next' }) {
  if (status === 'done')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-[11px] uppercase tracking-[0.12em] text-success">
        <svg className="h-2.5 w-2.5" viewBox="0 0 8 8" fill="currentColor">
          <circle cx="4" cy="4" r="3" />
        </svg>
        shipped
      </span>
    )
  if (status === 'wip')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/35 bg-accent/10 px-2.5 py-0.5 text-[11px] uppercase tracking-[0.12em] text-accent">
        <span className="dot-live" />
        wip
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
      next
    </span>
  )
}

/* ─────────────────────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="mx-auto mt-10 max-w-6xl border-t border-border px-4 py-10 sm:px-6">
      <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            gabhru · built for ETHGlobal · ENS track
          </p>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            ENS-addressable stealth payment infra for ERC-8004 AI agents.
          </p>
        </div>
        <div className="flex items-center gap-5 text-sm text-muted-foreground">
          <a
            href="https://github.com/HAPPYS1NGH/open-agents-stealth"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            GitHub
          </a>
          <a
            href="https://etherscan.io/address/0x6c11e3cb958c84cfd339123a2b9c4196c755f777#code"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            Resolver
          </a>
          <a
            href="https://app.ens.domains/gabhru.eth"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            gabhru.eth
          </a>
        </div>
      </div>
    </footer>
  )
}
