import { ChevronDown } from 'lucide-react'
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * Styled native select — keyboard accessible and reliable inside dense
 * property panels, themed to match the shadcn/ui look.
 */
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <span className={cn('relative inline-flex w-full', className)}>
      <select
        ref={ref}
        className='h-9 w-full appearance-none rounded-md border border-input bg-card px-3 pr-8 text-sm text-card-foreground shadow-sm focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50'
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className='pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground'
        aria-hidden
      />
    </span>
  )
)
Select.displayName = 'Select'
