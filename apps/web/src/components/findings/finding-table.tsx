'use client';

import Link from 'next/link';
import type { FindingRecord } from '@cloudsentry/shared-types';
import { FindingStatusBadge, ResourceTypeBadge, SeverityBadge } from '@/components/common/badges';
import { useAccountAlias } from '@/components/common/filters';
import { SimpleSavings } from '@/components/common/savings';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { CATEGORY_LABELS } from '@/lib/labels';

export function FindingTable({
  findings,
  showResource = true,
}: {
  findings: FindingRecord[];
  showResource?: boolean;
}) {
  const alias = useAccountAlias();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Finding</TableHead>
          {showResource && <TableHead>Resource</TableHead>}
          <TableHead>Severity</TableHead>
          <TableHead>Category</TableHead>
          <TableHead className="text-right">Est. savings</TableHead>
          <TableHead>Detected</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {findings.map((f) => (
          <TableRow key={f.findingId}>
            <TableCell className="max-w-80">
              <Link
                href={`/findings/detail/?id=${encodeURIComponent(f.findingId)}`}
                className="line-clamp-2 font-medium text-primary hover:underline"
              >
                {f.title}
              </Link>
              <div className="text-xs text-muted-foreground">{f.ruleName}</div>
            </TableCell>
            {showResource && (
              <TableCell className="max-w-56">
                <Link
                  href={`/resources/detail/?key=${encodeURIComponent(f.resourceKey)}`}
                  className="block truncate text-sm hover:underline"
                >
                  {f.resourceName ?? f.resourceId}
                </Link>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <ResourceTypeBadge type={f.resourceType} />
                  <span className="truncate">
                    {alias(f.accountId)} · {f.region}
                  </span>
                </div>
              </TableCell>
            )}
            <TableCell>
              <SeverityBadge severity={f.severity} />
            </TableCell>
            <TableCell>
              <Badge variant="outline">{CATEGORY_LABELS[f.category]}</Badge>
            </TableCell>
            <TableCell className="text-right text-sm">
              <SimpleSavings monthly={f.estimatedMonthlySavings} estimateType={f.savingsEstimateType} />
            </TableCell>
            <TableCell className="text-xs whitespace-nowrap">{formatDate(f.firstDetectedAt)}</TableCell>
            <TableCell>
              <FindingStatusBadge status={f.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
