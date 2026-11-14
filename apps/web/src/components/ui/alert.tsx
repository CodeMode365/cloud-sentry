import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground [&>svg]:text-muted-foreground',
        info: 'border-info/30 bg-info/8 [&>svg]:text-info',
        warning: 'border-warning/50 bg-warning/10 [&>svg]:text-warning-foreground dark:[&>svg]:text-warning',
        destructive: 'border-destructive/40 bg-destructive/8 text-destructive [&>svg]:text-destructive',
        success: 'border-success/30 bg-success/8 [&>svg]:text-success',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('col-start-2 font-medium tracking-tight', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('col-start-2 text-sm text-muted-foreground [&_p]:leading-relaxed', className)}
      {...props}
    />
  );
}
