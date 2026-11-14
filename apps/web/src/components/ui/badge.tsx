import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/10 text-primary',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'text-foreground',
        success: 'border-transparent bg-success/12 text-success',
        warning: 'border-transparent bg-warning/18 text-warning-foreground dark:text-warning',
        destructive: 'border-transparent bg-destructive/12 text-destructive',
        info: 'border-transparent bg-info/12 text-info',
        critical: 'border-transparent bg-severity-critical/14 text-severity-critical',
        high: 'border-transparent bg-severity-high/16 text-severity-high',
        medium: 'border-transparent bg-severity-medium/20 text-warning-foreground dark:text-severity-medium',
        low: 'border-transparent bg-severity-low/14 text-severity-low',
        synthetic:
          'border-dashed border-warning bg-warning/15 text-warning-foreground uppercase tracking-wide dark:text-warning',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps extends React.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
