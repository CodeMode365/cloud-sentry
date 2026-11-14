import * as React from 'react';
import { cn } from '@/lib/utils';
import { Label } from './label';

/** Label + control + hint/error wrapper with correct aria wiring. */
export function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
  required,
}: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | undefined;
  className?: string;
  required?: boolean;
  children: React.ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>;
}) {
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        )}
      </Label>
      {React.cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
