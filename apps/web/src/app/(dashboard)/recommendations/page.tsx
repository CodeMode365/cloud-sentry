'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Lightbulb } from 'lucide-react';
import {
  RECOMMENDATION_STATUSES,
  RESOURCE_TYPES,
  RESOURCE_TYPE_LABELS,
  type RecommendationRecord,
} from '@cloudsentry/shared-types';
import {
  LevelBadge,
  RecommendationStatusBadge,
  ResourceTypeBadge,
  SeverityBadge,
} from '@/components/common/badges';
import { AccountFilter, FilterSelect, useAccountAlias } from '@/components/common/filters';
import { PageHeader } from '@/components/common/page-header';
import { PaginationBar, useCursorPagination } from '@/components/common/pagination';
import { SavingsAmount } from '@/components/common/savings';
import { EmptyState, ErrorState, PageLoading, TableSkeleton } from '@/components/common/states';
import { RecommendationActions } from '@/components/recommendations/recommendation-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency, formatNumber, titleCase } from '@/lib/format';
import { ACTION_LABELS } from '@/lib/labels';
import { useRecommendations, useSavingsAnalytics } from '@/lib/queries';

function SavingsSummary({ accountId }: { accountId: string | undefined }) {
  const q = useSavingsAnalytics(accountId);
  if (q.isPending) return <Skeleton className="mb-4 h-20" />;
  if (q.isError) return null;
  const s = q.data;
  const items = [
    { label: 'Potential (open)', value: s.potential.monthly, count: s.potential.count },
    { label: 'Under review', value: s.underReview.monthly, count: s.underReview.count },
    { label: 'Accepted', value: s.accepted.monthly, count: s.accepted.count },
    { label: 'Realized (estimated)', value: s.realizedEstimate.monthly, count: s.realizedEstimate.count },
  ];
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((i) => (
        <Card key={i.label} className="gap-1 py-3">
          <CardContent className="px-4">
            <div className="text-xs text-muted-foreground">{i.label}</div>
            <div className="text-lg font-semibold tabular-nums">
              {formatCurrency(i.value)}
              <span className="text-xs font-normal text-muted-foreground">/mo est.</span>
            </div>
            <div className="text-xs text-muted-foreground">{formatNumber(i.count, 0)} recommendations</div>
          </CardContent>
        </Card>
      ))}
      {s.unpricedRecommendations > 0 && (
        <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">
          {s.unpricedRecommendations} recommendation{s.unpricedRecommendations === 1 ? ' has' : 's have'} no
          savings estimate because pricing data was unavailable; they are excluded from these totals.
        </p>
      )}
    </div>
  );
}

function RecommendationRow({ r, accountLabel }: { r: RecommendationRecord; accountLabel: string }) {
  return (
    <li className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <RecommendationStatusBadge status={r.status} />
          <SeverityBadge severity={r.severity} />
          <LevelBadge kind="confidence" level={r.confidence} />
          <LevelBadge kind="risk" level={r.riskLevel} />
        </div>
        <Link
          href={`/recommendations/detail/?id=${encodeURIComponent(r.recommendationId)}`}
          className="block font-medium hover:underline"
        >
          {r.title}
        </Link>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{ACTION_LABELS[r.suggestedAction.type]}:</span>{' '}
          {r.suggestedAction.summary}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <ResourceTypeBadge type={r.resourceType} />
          <Link
            href={`/resources/detail/?key=${encodeURIComponent(r.resourceKey)}`}
            className="hover:underline"
          >
            {r.resourceName ?? r.resourceId}
          </Link>
          <span>
            · {accountLabel} · {r.region}
          </span>
        </div>
        {r.evidence.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {r.evidence.slice(0, 3).map((e) => (
              <li key={e.key}>
                <span className="text-muted-foreground">{e.label}:</span>{' '}
                <span className="font-medium">
                  {e.value === null ? 'No data' : String(e.value)}
                  {e.value !== null && e.unit ? ` ${e.unit}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-3 lg:items-end">
        <div className="flex gap-6 lg:text-right">
          <SavingsAmount savings={r.savings} />
          <SavingsAmount
            savings={r.savings}
            period="annual"
            showLabel={false}
            className="text-muted-foreground"
          />
        </div>
        <RecommendationActions recommendation={r} />
      </div>
    </li>
  );
}

function RecommendationsList() {
  const params = useSearchParams();
  const alias = useAccountAlias();
  const [accountId, setAccountId] = React.useState<string | undefined>(params.get('accountId') ?? undefined);
  const [resourceType, setResourceType] = React.useState<string | undefined>();
  const [status, setStatus] = React.useState<string | undefined>(params.get('status') ?? 'OPEN,UNDER_REVIEW');
  const [sort, setSort] = React.useState<string | undefined>('savings');
  const [minSavings, setMinSavings] = React.useState('');

  const filters = {
    accountId,
    resourceType,
    status,
    sort,
    minMonthlySavings: minSavings && Number(minSavings) > 0 ? Number(minSavings) : undefined,
  };
  const pager = useCursorPagination(JSON.stringify(filters));
  const recs = useRecommendations({ ...filters, limit: 25, cursor: pager.cursor });

  return (
    <>
      <PageHeader
        title="Recommendations"
        description="Evidence-backed actions with estimated savings. CloudSentry never changes resources; you decide and act."
      />
      <SavingsSummary accountId={accountId} />
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:flex-wrap">
          <AccountFilter value={accountId} onChange={setAccountId} />
          <FilterSelect
            label="Resource type"
            value={resourceType}
            onChange={setResourceType}
            allLabel="All types"
            options={RESOURCE_TYPES.map((t) => ({ value: t, label: RESOURCE_TYPE_LABELS[t] }))}
          />
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            allLabel="All statuses"
            options={[
              { value: 'OPEN,UNDER_REVIEW', label: 'Open & under review' },
              ...RECOMMENDATION_STATUSES.map((s) => ({ value: s, label: titleCase(s) })),
            ]}
          />
          <FilterSelect
            label="Sort"
            value={sort}
            onChange={setSort}
            allLabel="Default order"
            options={[
              { value: 'savings', label: 'Highest savings' },
              { value: 'updatedAt', label: 'Recently updated' },
            ]}
          />
          <Input
            type="number"
            min={0}
            value={minSavings}
            onChange={(e) => setMinSavings(e.target.value)}
            placeholder="Min $/mo"
            aria-label="Minimum estimated monthly savings"
            className="w-full sm:w-32"
          />
        </div>
        {recs.isPending ? (
          <TableSkeleton />
        ) : recs.isError ? (
          <ErrorState error={recs.error} onRetry={() => void recs.refetch()} className="m-4" />
        ) : recs.data.data.length === 0 ? (
          <EmptyState
            className="m-4"
            icon={Lightbulb}
            title="No recommendations match"
            description="Recommendations are generated from findings after each scan."
          />
        ) : (
          <>
            <ul className="divide-y">
              {recs.data.data.map((r) => (
                <RecommendationRow key={r.recommendationId} r={r} accountLabel={alias(r.accountId)} />
              ))}
            </ul>
            <PaginationBar
              page={pager.page}
              canPrev={pager.canPrev}
              nextCursor={recs.data.nextCursor}
              onPrev={pager.prev}
              onNext={pager.next}
              count={recs.data.data.length}
              loading={recs.isFetching}
            />
          </>
        )}
      </Card>
    </>
  );
}

export default function RecommendationsPage() {
  return (
    <React.Suspense fallback={<PageLoading />}>
      <RecommendationsList />
    </React.Suspense>
  );
}
