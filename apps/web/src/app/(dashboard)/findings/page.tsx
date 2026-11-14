'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import {
  FINDING_CATEGORIES,
  RESOURCE_TYPES,
  RESOURCE_TYPE_LABELS,
  SEVERITIES,
} from '@cloudsentry/shared-types';
import { AccountFilter, FilterSelect } from '@/components/common/filters';
import { PageHeader } from '@/components/common/page-header';
import { PaginationBar, useCursorPagination } from '@/components/common/pagination';
import { EmptyState, ErrorState, PageLoading, TableSkeleton } from '@/components/common/states';
import { FindingTable } from '@/components/findings/finding-table';
import { Card } from '@/components/ui/card';
import { titleCase } from '@/lib/format';
import { CATEGORY_LABELS } from '@/lib/labels';
import { useFindings } from '@/lib/queries';

const STATUS_OPTIONS = [
  { value: 'OPEN,ACKNOWLEDGED', label: 'Active' },
  { value: 'OPEN', label: 'Open' },
  { value: 'ACKNOWLEDGED', label: 'Acknowledged' },
  { value: 'SUPPRESSED', label: 'Suppressed' },
  { value: 'RESOLVED', label: 'Resolved' },
];

function FindingsList() {
  const params = useSearchParams();
  const [accountId, setAccountId] = React.useState<string | undefined>(params.get('accountId') ?? undefined);
  const [resourceType, setResourceType] = React.useState<string | undefined>(
    params.get('resourceType') ?? undefined,
  );
  const [severity, setSeverity] = React.useState<string | undefined>(params.get('severity') ?? undefined);
  const [category, setCategory] = React.useState<string | undefined>(params.get('category') ?? undefined);
  const [status, setStatus] = React.useState<string | undefined>(params.get('status') ?? 'OPEN,ACKNOWLEDGED');

  const filters = { accountId, resourceType, severity, category, status };
  const pager = useCursorPagination(JSON.stringify(filters));
  const findings = useFindings({ ...filters, limit: 25, cursor: pager.cursor });

  return (
    <>
      <PageHeader
        title="Findings"
        description="Resources flagged by deterministic detection rules, with the evidence behind each detection."
      />
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
            label="Severity"
            value={severity}
            onChange={setSeverity}
            allLabel="All severities"
            options={[...SEVERITIES].reverse().map((s) => ({ value: s, label: titleCase(s) }))}
          />
          <FilterSelect
            label="Category"
            value={category}
            onChange={setCategory}
            allLabel="All categories"
            options={FINDING_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
          />
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            allLabel="All statuses"
            options={STATUS_OPTIONS}
          />
        </div>
        {findings.isPending ? (
          <TableSkeleton />
        ) : findings.isError ? (
          <ErrorState error={findings.error} onRetry={() => void findings.refetch()} className="m-4" />
        ) : findings.data.data.length === 0 ? (
          <EmptyState
            className="m-4"
            icon={ShieldCheck}
            title="No findings match"
            description="Either nothing was detected for these filters, or no scan has run yet."
          />
        ) : (
          <>
            <FindingTable findings={findings.data.data} />
            <PaginationBar
              page={pager.page}
              canPrev={pager.canPrev}
              nextCursor={findings.data.nextCursor}
              onPrev={pager.prev}
              onNext={pager.next}
              count={findings.data.data.length}
              loading={findings.isFetching}
            />
          </>
        )}
      </Card>
    </>
  );
}

export default function FindingsPage() {
  return (
    <React.Suspense fallback={<PageLoading />}>
      <FindingsList />
    </React.Suspense>
  );
}
