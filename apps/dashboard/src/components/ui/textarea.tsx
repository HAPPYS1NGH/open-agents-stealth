import * as React from 'react'
import { cn } from '@/lib/cn'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-border bg-card/60 px-3.5 py-2.5 font-mono text-sm leading-relaxed text-foreground ring-offset-background',
        'placeholder:text-muted-foreground/70',
        'transition-[border-color,box-shadow,background-color] duration-150',
        'hover:border-foreground/20',
        'focus-visible:border-accent/60 focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
