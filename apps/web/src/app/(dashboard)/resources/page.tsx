'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowDown, ArrowUp, Search, Server } from 'lucide-react';
import {
  RESOURCE_TYPES,
  RESOURCE_TYPE_LABELS,
  type CloudResource,
  type ResourceType,
} from '@cloudsentry/shared-types';
import { COMMON_AWS_REGIONS, RESOURCE_SORT_FIELDS } from '@cloudsentry/validators';
import { ResourceTypeBadge } from '@/components/common/badges';
import { AccountFilter, FilterSelect, useAccountAlias } from '@/components/common/filters';
import { PageHeader } from '@/components/common/page-header';
import { PaginationBar, useCursorPagination } from '@/components/common/pagination';
import { EmptyState, ErrorState, PageLoading, TableSkeleton } from '@/components/common/states';
import { UtilizationSummary } from '@/components/resources/utilization';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { formatCurrency, formatRelative } from '@/lib/format';
import { useResources } from '@/lib/queries';

const SORT_LABELS: Record<(typeof RESOURCE_SORT_FIELDS)[number], string> = {
  lastSeenAt: 'Last seen',
  name: 'Name',
  resourceType: 'Type',
  region: 'Region',
  activeFindingCount: 'Findings',
};

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The API may add a resource-level cost estimate; render it only when present. */
function estimatedCost(r: CloudResource): number | null {
  const v = (r as CloudResource & { estimatedMonthlyCost?: number | null }).estimatedMonthlyCost;
  return typeof v === 'number' ? v : null;
}

function TagsCell({ tags }: { tags: Record<string, string> }) {
  const entries = Object.entries(tags).filter(([k]) => k !== 'Name');
  if (entries.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Tooltip
      content={
        <ul className="space-y-0.5">
          {entries.slice(0, 12).map(([k, v]) => (
            <li key={k}>
              <span className="opacity-70">{k}:</span> {v}
            </li>
          ))}
        </ul>
      }
    >
      <Badge variant="outline" tabIndex={0}>
        {entries.length} tag{entries.length === 1 ? '' : 's'}
      </Badge>
    </Tooltip>
  );
}

function ResourcesList() {
  const params = useSearchParams();
  const alias = useAccountAlias();
  const [accountId, setAccountId] = React.useState<string | undefined>(params.get('accountId') ?? undefined);
  const [resourceType, setResourceType] = React.useState<string | undefined>(
    params.get('resourceType') ?? undefined,
  );
  const [region, setRegion] = React.useState<string | undefined>();
  const [state, setState] = React.useState('');
  const [hasFindings, setHasFindings] = React.useState<string | undefined>(
    params.get('hasFindings') ?? undefined,
  );
  const [includeNotFound, setIncludeNotFound] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [sort, setSort] = React.useState<string | undefined>();
  const [order, setOrder] = React.useState<'asc' | 'desc'>('desc');
  const debouncedSearch = useDebounced(search);
  const debouncedState = useDebounced(state);

  const filters = {
    accountId,
    resourceType,
    region,
    state: debouncedState || undefined,
    search: debouncedSearch || undefined,
    hasFindings,
    includeNotFound: includeNotFound ? 'true' : undefined,
    sort,
    order: sort ? order : undefined,
  };
  const pager = useCursorPagination(JSON.stringify(filters));
  const resources = useResources({ ...filters, limit: 25, cursor: pager.cursor });

  return (
    <>
      <PageHeader
        title="Resources"
        description="Inventory of AWS resources discovered across connected accounts and regions."
      />
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-2 border-b p-4 lg:flex-row lg:flex-wrap lg:items-center">
          <div className="relative w-full lg:w-64">
            <Search
              className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ID, name or tag…"
              aria-label="Search resources"
              className="pl-8"
            />
          </div>
          <AccountFilter value={accountId} onChange={setAccountId} />
          <FilterSelect
            label="Resource type"
            value={resourceType}
            onChange={setResourceType}
            allLabel="All types"
            options={RESOURCE_TYPES.map((t) => ({ value: t, label: RESOURCE_TYPE_LABELS[t] }))}
          />
          <FilterSelect
            label="Region"
            value={region}
            onChange={setRegion}
            allLabel="All regions"
            options={COMMON_AWS_REGIONS.map((r) => ({ value: r, label: r }))}
          />
          <Input
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="State (e.g. running)"
            aria-label="Filter by state"
            className="w-full sm:w-40"
          />
          <FilterSelect
            label="Findings"
            value={hasFindings}
            onChange={setHasFindings}
            allLabel="Any findings"
            options={[
              { value: 'true', label: 'With findings' },
              { value: 'false', label: 'Without findings' },
            ]}
          />
          <div className="flex items-center gap-2">
            <FilterSelect
              label="Sort by"
              value={sort}
              onChange={setSort}
              allLabel="Default order"
              className="w-full sm:w-40"
              options={RESOURCE_SORT_FIELDS.map((f) => ({ value: f, label: `Sort: ${SORT_LABELS[f]}` }))}
            />
            <Button
              variant="outline"
              size="icon"
              disabled={!sort}
              onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
              aria-label={`Sort ${order === 'asc' ? 'descending' : 'ascending'}`}
            >
              {order === 'asc' ? <ArrowUp /> : <ArrowDown />}
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch
              checked={includeNotFound}
              onCheckedChange={setIncludeNotFound}
              aria-label="Include resources no longer found"
            />
            Include removed
          </label>
        </div>
        {resources.isPending ? (
          <TableSkeleton />
        ) : resources.isError ? (
          <ErrorState error={resources.error} onRetry={() => void resources.refetch()} className="m-4" />
        ) : resources.data.data.length === 0 ? (
          <EmptyState
            className="m-4"
            icon={Server}
            title="No resources found"
            description="Adjust the filters, or run a scan to discover resources in your connected accounts."
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Resource</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Utilization</TableHead>
                  <TableHead className="text-right">Est. monthly cost</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead className="text-right">Findings</TableHead>
                  <TableHead>Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resources.data.data.map((r) => {
                  const cost = estimatedCost(r);
                  return (
                    <TableRow
                      key={r.resourceKey}
                      className={r.lifecycleStatus === 'NOT_FOUND' ? 'opacity-60' : undefined}
                    >
                      <TableCell className="max-w-64">
                        <Link
                          href={`/resources/detail/?key=${encodeURIComponent(r.resourceKey)}`}
                          className="block truncate font-medium text-primary hover:underline"
                        >
                          {r.name ?? r.resourceId}
                        </Link>
                        {r.name && (
                          <div className="truncate font-mono text-xs text-muted-foreground">
                            {r.resourceId}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <ResourceTypeBadge type={r.resourceType as ResourceType} />
                      </TableCell>
                      <TableCell className="text-sm">{alias(r.accountId)}</TableCell>
                      <TableCell className="font-mono text-xs">{r.region}</TableCell>
                      <TableCell>
                        <span className="text-sm">{r.state}</span>
                        {r.lifecycleStatus === 'NOT_FOUND' && (
                          <Badge variant="outline" className="ml-1">
                            Not found
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <UtilizationSummary resource={r} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {cost === null ? (
                          <Tooltip content="No resource-level cost estimate available for this resource.">
                            <span className="text-xs text-muted-foreground" tabIndex={0}>
                              —
                            </span>
                          </Tooltip>
                        ) : (
                          <span>
                            {formatCurrency(cost)} <span className="text-xs text-muted-foreground">est.</span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <TagsCell tags={r.tags} />
                      </TableCell>
                      <TableCell className="text-right">
                        {r.activeFindingCount > 0 ? (
                          <Badge variant="warning">{r.activeFindingCount}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                        {formatRelative(r.lastSeenAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <PaginationBar
              page={pager.page}
              canPrev={pager.canPrev}
              nextCursor={resources.data.nextCursor}
              onPrev={pager.prev}
              onNext={pager.next}
              count={resources.data.data.length}
              loading={resources.isFetching}
            />
          </>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">
        States are AWS-native values (running, available, in-use…). Utilization shows CloudWatch data for the
        lookback window; “No data” means CloudWatch returned no datapoints, not zero usage.
      </p>
    </>
  );
}

export default function ResourcesPage() {
  return (
    <React.Suspense fallback={<PageLoading />}>
      <ResourcesList />
    </React.Suspense>
  );
}
