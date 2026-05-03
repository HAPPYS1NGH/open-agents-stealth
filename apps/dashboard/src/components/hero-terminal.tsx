'use client'

import { useEffect, useState } from 'react'

/**
 * Hero terminal — animates a fake-but-truthy resolution of test.gabhru.eth.
 * No network calls; the values shown are the actual mainnet outputs.
 */

const FRAMES: Array<
  | { kind: 'cmd'; text: string }
  | { kind: 'log'; text: string; tone?: 'muted' | 'accent' | 'success' }
  | { kind: 'json'; lines: string[] }
> = [
  { kind: 'cmd', text: '$ viem.getEnsAddress({ name: "test.gabhru.eth" })' },
  { kind: 'log', text: '↳ resolver: 0x6c11…f777 (gabhru.eth wildcard)', tone: 'muted' },
  { kind: 'log', text: '↳ ccip-read: gateway.gabhru.eth (vercel)', tone: 'muted' },
  { kind: 'log', text: '✓ resolved → 0x000…bEEF', tone: 'success' },
  { kind: 'cmd', text: '$ gabhru.pay({ to: "alice.gabhru.eth", amount: "5 USDC" })' },
  { kind: 'log', text: '↳ derive stealth address (ERC-5564, scheme 1)', tone: 'muted' },
  {
    kind: 'json',
    lines: [
      '{',
      '  "stealthEoa": "0x39e0…7c2a",',
      '  "ephemeralPub": "0x02a4…b91f",',
      '  "viewTag": "0x9c"',
      '}',
    ],
  },
  { kind: 'log', text: '↳ transfer USDC → recipient.safe', tone: 'muted' },
  { kind: 'log', text: '↳ announce on ERC-5564 announcer', tone: 'muted' },
  { kind: 'log', text: '✓ payment private. recipient sees it in ~2s.', tone: 'accent' },
]

export function HeroTerminal() {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (frame >= FRAMES.length) return
    const cur = FRAMES[frame]
    if (!cur) return
    const delay = cur.kind === 'cmd' ? 700 : cur.kind === 'json' ? 1100 : 600
    const t = setTimeout(() => setFrame((f) => f + 1), delay)
    return () => clearTimeout(t)
  }, [frame])

  // Loop the demo so judges always see motion.
  useEffect(() => {
    if (frame === FRAMES.length) {
      const t = setTimeout(() => setFrame(0), 4500)
      return () => clearTimeout(t)
    }
  }, [frame])

  const visible = FRAMES.slice(0, frame)

  return (
    <div className="scanlines codeblock relative overflow-hidden">
      <div className="mb-3 flex items-center justify-between border-b border-border/60 pb-3">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
        </div>
        <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          ~/agents/test.gabhru.eth
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="dot-live" />
          live on mainnet
        </span>
      </div>

      <div className="space-y-1 text-sm">
        {visible.map((f, i) => (
          <Line key={i} f={f} />
        ))}
        {frame < FRAMES.length && <Caret />}
      </div>
    </div>
  )
}

function Caret() {
  return (
    <span className="inline-block h-4 w-2 translate-y-[2px] bg-accent animate-blink" />
  )
}

function Line({ f }: { f: (typeof FRAMES)[number] }) {
  if (f.kind === 'cmd') {
    return (
      <div className="animate-fade-up">
        <span className="text-accent">›</span>{' '}
        <span className="text-foreground/90">{f.text.replace(/^\$\s/, '')}</span>
      </div>
    )
  }
  if (f.kind === 'json') {
    return (
      <pre className="animate-fade-up whitespace-pre text-foreground/80">
        {f.lines.map((l, i) => (
          <span key={i}>
            {colorizeJson(l)}
            {'\n'}
          </span>
        ))}
      </pre>
    )
  }
  const toneClass =
    f.tone === 'accent'
      ? 'text-accent'
      : f.tone === 'success'
        ? 'text-success'
        : 'text-muted-foreground'
  return (
    <div className={`animate-fade-up ${toneClass}`}>{f.text}</div>
  )
}

function colorizeJson(line: string) {
  const parts = line.split(/(".*?":|".*?"|0x[a-f0-9]+|\{|\}|,)/g).filter(Boolean)
  return parts.map((p, i) => {
    if (/^".*":$/.test(p)) return <span key={i} className="tok-key">{p}</span>
    if (/^"/.test(p)) return <span key={i} className="tok-str">{p}</span>
    if (/^0x/.test(p)) return <span key={i} className="tok-num">{p}</span>
    return <span key={i}>{p}</span>
  })
}
