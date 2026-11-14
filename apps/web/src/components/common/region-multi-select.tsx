'use client';

import * as React from 'react';
import { ChevronDown, X } from 'lucide-react';
import { AWS_REGION_PATTERN, COMMON_AWS_REGIONS } from '@cloudsentry/validators';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export function RegionMultiSelect({
  value,
  onChange,
  id,
  disabled,
  invalid,
  'aria-describedby': describedBy,
}: {
  value: string[];
  onChange: (regions: string[]) => void;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  'aria-describedby'?: string;
}) {
  const [filter, setFilter] = React.useState('');
  const options = React.useMemo(() => {
    const all = Array.from(new Set<string>([...COMMON_AWS_REGIONS, ...value])).sort();
    const f = filter.trim().toLowerCase();
    return f ? all.filter((r) => r.includes(f)) : all;
  }, [filter, value]);
  const canAddCustom =
    filter.trim() !== '' && AWS_REGION_PATTERN.test(filter.trim()) && !options.includes(filter.trim());

  const toggle = (region: string) => {
    onChange(value.includes(region) ? value.filter((r) => r !== region) : [...value, region].sort());
  };

  return (
    <div className="space-y-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            disabled={disabled}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className={cn('w-full justify-between font-normal', invalid && 'border-destructive')}
          >
            <span className={cn('truncate', value.length === 0 && 'text-muted-foreground')}>
              {value.length === 0
                ? 'Select regions'
                : `${value.length} region${value.length === 1 ? '' : 's'} selected`}
            </span>
            <ChevronDown className="opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0">
          <div className="border-b p-2">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter or type a region…"
              aria-label="Filter regions"
              className="h-8"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto p-1" role="listbox" aria-multiselectable="true">
            {canAddCustom && (
              <li>
                <button
                  type="button"
                  className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    toggle(filter.trim());
                    setFilter('');
                  }}
                >
                  Add “{filter.trim()}”
                </button>
              </li>
            )}
            {options.map((region) => {
              const checked = value.includes(region);
              const optionId = `${id ?? 'region'}-${region}`;
              return (
                <li key={region} role="option" aria-selected={checked}>
                  <label
                    htmlFor={optionId}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <Checkbox id={optionId} checked={checked} onCheckedChange={() => toggle(region)} />
                    <span className="font-mono text-xs">{region}</span>
                  </label>
                </li>
              );
            })}
            {options.length === 0 && !canAddCustom && (
              <li className="px-2 py-3 text-center text-sm text-muted-foreground">No matching regions</li>
            )}
          </ul>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((region) => (
            <Badge key={region} variant="secondary" className="font-mono">
              {region}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${region}`}
                  onClick={() => toggle(region)}
                  className="rounded-sm hover:text-foreground"
                >
                  <X />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
