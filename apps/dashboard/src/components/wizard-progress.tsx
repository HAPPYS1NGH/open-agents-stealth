import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'

const STEPS = [
  { idx: 1, label: 'Subname' },
  { idx: 2, label: 'View key' },
  { idx: 3, label: 'On-chain' },
  { idx: 4, label: 'Treasury' },
  { idx: 5, label: 'Records' },
] as const

export interface WizardProgressProps {
  current: number | 'done'
}

export function WizardProgress({ current }: WizardProgressProps) {
  const currentNum = current === 'done' ? 6 : current
  const progressPct =
    currentNum >= STEPS.length
      ? 100
      : Math.max(0, ((currentNum - 1) / (STEPS.length - 1)) * 100)

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          /// onboarding · step {Math.min(currentNum, STEPS.length)} of {STEPS.length}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {Math.round(progressPct)}%
        </span>
      </div>

      <div className="relative h-px w-full bg-border">
        <div
          className="absolute left-0 top-0 h-full bg-accent transition-[width] duration-500 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <ol className="flex items-center justify-between gap-2 pt-2">
        {STEPS.map((s) => {
          const completed = currentNum > s.idx
          const active = currentNum === s.idx
          return (
            <li key={s.idx} className="flex flex-1 items-center gap-2">
              <span
                className={cn(
                  'grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11px] font-mono transition-colors',
                  completed && 'border-accent bg-accent text-accent-foreground',
                  active && !completed && 'border-accent text-accent shadow-[0_0_0_3px_hsl(var(--accent)/0.18)]',
                  !completed && !active && 'border-border text-muted-foreground',
                )}
              >
                {completed ? <Check size={13} strokeWidth={3} /> : s.idx}
              </span>
              <span
                className={cn(
                  'hidden text-[11px] uppercase tracking-[0.1em] sm:inline',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {s.label}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
