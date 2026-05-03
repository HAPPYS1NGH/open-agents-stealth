import * as React from 'react'
import { cn } from '@/lib/cn'

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        'block text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground',
        className,
      )}
      {...props}
    />
  ),
)
Label.displayName = 'Label'
