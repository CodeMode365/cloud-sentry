import { Info } from 'lucide-react';
import type { SavingsEstimate } from '@cloudsentry/shared-types';
import { Tooltip } from '@/components/ui/tooltip';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Renders an estimated savings amount with its estimate type; never presents an estimate as a fact. */
export function SavingsAmount({
  savings,
  period = 'monthly',
  className,
  showLabel = true,
}: {
  savings: SavingsEstimate;
  period?: 'monthly' | 'annual';
  className?: string;
  showLabel?: boolean;
}) {
  if (savings.status === 'UNAVAILABLE' || savings.monthly === null) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-sm text-muted-foreground', className)}>
        Not estimated
        {savings.unavailableReason && (
          <Tooltip content={savings.unavailableReason}>
            <button type="button" aria-label="Why savings are not estimated" className="rounded-sm">
              <Info className="size-3.5" />
            </button>
          </Tooltip>
        )}
      </span>
    );
  }
  const value = period === 'monthly' ? savings.monthly : savings.annual;
  return (
    <span className={cn('inline-flex flex-col', className)}>
      <span className="font-semibold tabular-nums">
        {savings.estimateType === 'UPPER_BOUND' ? 'up to ' : ''}
        {formatCurrency(value, { currency: savings.currency })}
        <span className="text-xs font-normal text-muted-foreground">
          /{period === 'monthly' ? 'mo' : 'yr'}
        </span>
      </span>
      {showLabel && (
        <span className="text-[11px] text-muted-foreground">
          {savings.estimateType === 'UPPER_BOUND' ? 'Estimated upper bound' : 'Estimated'}
        </span>
      )}
    </span>
  );
}

export function SimpleSavings({
  monthly,
  estimateType,
}: {
  monthly: number | null;
  estimateType?: 'POINT' | 'UPPER_BOUND' | null;
}) {
  if (monthly === null) return <span className="text-sm text-muted-foreground">Not estimated</span>;
  return (
    <span className="tabular-nums">
      {estimateType === 'UPPER_BOUND' ? 'up to ' : ''}
      {formatCurrency(monthly)}
      <span className="text-xs text-muted-foreground">/mo est.</span>
    </span>
  );
}
