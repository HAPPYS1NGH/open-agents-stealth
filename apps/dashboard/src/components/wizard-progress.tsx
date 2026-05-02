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
  return (
    <ol className="flex items-center justify-between gap-2">
      {STEPS.map((s) => {
        const completed = currentNum > s.idx
        const active = currentNum === s.idx
        return (
          <li key={s.idx} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold',
                completed && 'border-primary bg-primary text-primary-foreground',
                active && !completed && 'border-primary text-primary',
                !completed && !active && 'border-border text-muted-foreground',
              )}
            >
              {completed ? <Check size={14} /> : s.idx}
            </span>
            <span
              className={cn(
                'text-sm',
                active ? 'font-semibold text-foreground' : 'text-muted-foreground',
              )}
            >
              {s.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
