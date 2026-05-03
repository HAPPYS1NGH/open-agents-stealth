import * as React from 'react'
import { cn } from '@/lib/cn'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-11 w-full rounded-md border border-border bg-card/60 px-3.5 py-2 text-sm text-foreground ring-offset-background',
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
Input.displayName = 'Input'
