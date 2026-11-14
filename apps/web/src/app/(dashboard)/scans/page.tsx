'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { History } from 'lucide-react';
import { SCAN_STATUSES } from '@cloudsentry/shared-types';
import { AccountFilter, FilterSelect } from '@/components/common/filters';
import { PageHeader } from '@/components/common/page-header';
import { PaginationBar, useCursorPagination } from '@/components/common/pagination';
import { EmptyState, ErrorState, PageLoading, TableSkeleton } from '@/components/common/states';
import { ScanTable } from '@/components/scans/scan-table';
import { StartScanDialog } from '@/components/scans/start-scan-dialog';
import { Card } from '@/components/ui/card';
import { titleCase } from '@/lib/format';
import { usePermissions } from '@/lib/permissions';
import { useScans } from '@/lib/queries';

function ScansList() {
  const params = useSearchParams();
  const { canOperate } = usePermissions();
  const [accountId, setAccountId] = React.useState<string | undefined>(params.get('accountId') ?? undefined);
  const [status, setStatus] = React.useState<string | undefined>(params.get('status') ?? undefined);
  const filters = { accountId, status };
  const pager = useCursorPagination(JSON.stringify(filters));
  const scans = useScans({ ...filters, limit: 25, cursor: pager.cursor }, { poll: true });

  return (
    <>
      <PageHeader
        title="Scan History"
        description="Manual and scheduled scans. Each scan runs as an AWS Step Functions execution."
        actions={canOperate && <StartScanDialog />}
      />
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-2 border-b p-4 sm:flex-row">
          <AccountFilter value={accountId} onChange={setAccountId} />
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            allLabel="All statuses"
            options={SCAN_STATUSES.map((s) => ({ value: s, label: titleCase(s) }))}
          />
        </div>
        {scans.isPending ? (
          <TableSkeleton />
        ) : scans.isError ? (
          <ErrorState error={scans.error} onRetry={() => void scans.refetch()} className="m-4" />
        ) : scans.data.data.length === 0 ? (
          <EmptyState
            className="m-4"
            icon={History}
            title="No scans yet"
            description="Start a scan for a connected account."
          />
        ) : (
          <>
            <ScanTable scans={scans.data.data} />
            <PaginationBar
              page={pager.page}
              canPrev={pager.canPrev}
              nextCursor={scans.data.nextCursor}
              onPrev={pager.prev}
              onNext={pager.next}
              count={scans.data.data.length}
              loading={scans.isFetching}
            />
          </>
        )}
      </Card>
    </>
  );
}

export default function ScansPage() {
  return (
    <React.Suspense fallback={<PageLoading />}>
      <ScansList />
    </React.Suspense>
  );
}
