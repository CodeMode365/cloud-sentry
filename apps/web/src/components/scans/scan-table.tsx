'use client';

import Link from 'next/link';
import type { ScanExecution } from '@cloudsentry/shared-types';
import { ScanStatusBadge } from '@/components/common/badges';
import { useAccountAlias } from '@/components/common/filters';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatDuration, formatNumber, titleCase } from '@/lib/format';

export function scanDuration(scan: ScanExecution): number | null {
  if (scan.durationMs !== null) return scan.durationMs;
  if (scan.startedAt) return Date.now() - new Date(scan.startedAt).getTime();
  return null;
}

export function ScanTable({ scans, compact = false }: { scans: ScanExecution[]; compact?: boolean }) {
  const alias = useAccountAlias();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Scan</TableHead>
          <TableHead>Account</TableHead>
          {!compact && <TableHead>Trigger</TableHead>}
          <TableHead>Started</TableHead>
          {!compact && <TableHead>Duration</TableHead>}
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Resources</TableHead>
          <TableHead className="text-right">Findings</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {scans.map((scan) => (
          <TableRow key={scan.scanId}>
            <TableCell>
              <Link
                href={`/scans/detail/?id=${encodeURIComponent(scan.scanId)}`}
                className="font-mono text-xs text-primary hover:underline"
              >
                {scan.scanId}
              </Link>
            </TableCell>
            <TableCell>
              <div className="text-sm">{alias(scan.accountId)}</div>
              <div className="font-mono text-xs text-muted-foreground">{scan.accountId}</div>
            </TableCell>
            {!compact && (
              <TableCell>
                <Badge variant="outline">{titleCase(scan.trigger)}</Badge>
              </TableCell>
            )}
            <TableCell className="whitespace-nowrap">
              {formatDateTime(scan.startedAt ?? scan.requestedAt)}
            </TableCell>
            {!compact && <TableCell className="tabular-nums">{formatDuration(scanDuration(scan))}</TableCell>}
            <TableCell>
              <ScanStatusBadge status={scan.status} />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatNumber(scan.summary?.resourcesDiscovered ?? null, 0)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatNumber(scan.summary?.findingsDetected ?? null, 0)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
