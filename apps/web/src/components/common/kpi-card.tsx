import * as React from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function KpiCard({
  label,
  value,
  icon: Icon,
  footnote,
  tone = 'default',
  loading,
  href,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  footnote?: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'critical';
  loading?: boolean;
  href?: string;
}) {
  const inner = (
    <Card className={cn('gap-2 py-4', href && 'transition-colors hover:bg-accent/40')}>
      <div className="flex items-start justify-between gap-2 px-4">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span
          className={cn(
            'flex size-8 items-center justify-center rounded-md',
            tone === 'success' && 'bg-success/10 text-success',
            tone === 'warning' && 'bg-warning/15 text-warning-foreground dark:text-warning',
            tone === 'critical' && 'bg-severity-critical/10 text-severity-critical',
            tone === 'default' && 'bg-primary/10 text-primary',
          )}
        >
          <Icon className="size-4" />
        </span>
      </div>
      <div className="px-4">
        {loading ? (
          <Skeleton className="h-8 w-28" />
        ) : (
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
        )}
      </div>
      {footnote && <div className="px-4 text-xs text-muted-foreground">{footnote}</div>}
    </Card>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {inner}
      </Link>
    );
  }
  return inner;
}
