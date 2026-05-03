'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ConnectButton } from '@/components/connect-button'
import { cn } from '@/lib/cn'

interface SiteNavProps {
  variant?: 'transparent' | 'solid'
}

export function SiteNav({ variant = 'transparent' }: SiteNavProps) {
  const path = usePathname()
  const isActive = (href: string) =>
    href === '/' ? path === '/' : path?.startsWith(href)

  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full',
        variant === 'transparent'
          ? 'border-b border-border/40 bg-background/60 backdrop-blur-xl'
          : 'border-b border-border bg-background',
      )}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-md border border-accent/40 bg-accent/10 text-accent transition-colors group-hover:bg-accent/20">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none">
              <path
                d="M12 2 L21 7 V17 L12 22 L3 17 V7 Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12" r="2.5" fill="currentColor" />
            </svg>
          </span>
          <span className="font-mono text-sm font-medium tracking-tight">
            gabhru<span className="text-muted-foreground">.eth</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 text-sm sm:flex">
          <NavLink href="/" active={isActive('/')}>
            Home
          </NavLink>
          <NavLink href="/onboard" active={isActive('/onboard')}>
            Onboard
          </NavLink>
          <NavLink href="/dashboard" active={isActive('/dashboard')}>
            Dashboard
          </NavLink>
          <a
            href="https://github.com/HAPPYS1NGH/open-agents-stealth"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            GitHub
          </a>
        </nav>

        <div className="flex items-center gap-2">
          <ConnectButton />
        </div>
      </div>
    </header>
  )
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-md px-3 py-1.5 transition-colors',
        active
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </Link>
  )
}
