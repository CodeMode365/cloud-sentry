import * as React from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col gap-4 rounded-lg border bg-card py-5 text-card-foreground shadow-xs',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 px-5', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return <h3 className={cn('text-sm leading-none font-semibold', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('ml-auto flex items-center gap-2', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-2 px-5', className)} {...props} />;
}
