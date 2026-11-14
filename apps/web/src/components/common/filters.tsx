'use client';

import * as React from 'react';
import { useAccounts } from '@/lib/queries';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export const ALL = '__all__';

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = 'All',
  className = 'w-full sm:w-44',
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: readonly { value: string; label: string }[];
  allLabel?: string;
  className?: string;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger aria-label={label} className={className}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AccountFilter({
  value,
  onChange,
  className,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  className?: string;
}) {
  const accounts = useAccounts();
  const options = React.useMemo(
    () => (accounts.data ?? []).map((a) => ({ value: a.accountId, label: `${a.alias} (${a.accountId})` })),
    [accounts.data],
  );
  return (
    <FilterSelect
      label="Account"
      value={value}
      onChange={onChange}
      options={options}
      allLabel="All accounts"
      {...(className ? { className } : {})}
    />
  );
}

export function useAccountAlias(): (accountId: string) => string {
  const accounts = useAccounts();
  return React.useCallback(
    (accountId: string) => accounts.data?.find((a) => a.accountId === accountId)?.alias ?? accountId,
    [accounts.data],
  );
}
