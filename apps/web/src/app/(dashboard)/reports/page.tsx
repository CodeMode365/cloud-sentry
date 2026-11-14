'use client';

import * as React from 'react';
import { Download, FileText, LoaderCircle, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { REPORT_FORMATS, REPORT_TYPES, type ReportFormat, type ReportType } from '@cloudsentry/shared-types';
import { createReportRequestSchema } from '@cloudsentry/validators';
import { ReportStatusBadge } from '@/components/common/badges';
import { ALL, useAccountAlias } from '@/components/common/filters';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorMessage } from '@/lib/api';
import { formatBytes, formatDate, formatDateTime, titleCase } from '@/lib/format';
import { usePermissions } from '@/lib/permissions';
import { fetchReportDownloadUrl, useAccounts, useCreateReport, useReports } from '@/lib/queries';

function CreateReportDialog() {
  const accounts = useAccounts();
  const create = useCreateReport();
  const [open, setOpen] = React.useState(false);
  const [accountId, setAccountId] = React.useState<string>(ALL);
  const [type, setType] = React.useState<ReportType>('ON_DEMAND');
  const [format, setFormat] = React.useState<ReportFormat>('PDF');

  const submit = async () => {
    const parsed = createReportRequestSchema.safeParse({
      accountId: accountId === ALL ? null : accountId,
      type,
      format,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Invalid report request');
      return;
    }
    await create.mutateAsync(parsed.data);
    toast.success('Report requested. It will be ready shortly.');
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New report
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate report</DialogTitle>
          <DialogDescription>
            Includes account summary, inventory, cost breakdown, findings, optimization opportunities,
            estimated savings and scan metadata.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="report-account">Scope</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="report-account">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All accounts</SelectItem>
                {(accounts.data ?? []).map((a) => (
                  <SelectItem key={a.accountId} value={a.accountId}>
                    {a.alias} ({a.accountId})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="report-type">Period</Label>
              <Select value={type} onValueChange={(v) => setType(v as ReportType)}>
                <SelectTrigger id="report-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t === 'ON_DEMAND' ? 'Current snapshot' : titleCase(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="report-format">Format</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as ReportFormat)}>
                <SelectTrigger id="report-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_FORMATS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending && <LoaderCircle className="animate-spin" />} Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ReportsPage() {
  const reports = useReports();
  const alias = useAccountAlias();
  const { canOperate } = usePermissions();
  const [downloading, setDownloading] = React.useState<string | null>(null);

  const download = async (reportId: string) => {
    setDownloading(reportId);
    try {
      const { url } = await fetchReportDownloadUrl(reportId);
      window.location.assign(url);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Reports"
        description="Downloadable summaries of inventory, spend, findings and estimated savings. Download links expire after a few minutes."
        actions={canOperate && <CreateReportDialog />}
      />
      <Card className="py-0">
        {reports.isPending ? (
          <TableSkeleton />
        ) : reports.isError ? (
          <ErrorState error={reports.error} onRetry={() => void reports.refetch()} className="m-4" />
        ) : reports.data.data.length === 0 ? (
          <EmptyState
            className="m-4"
            icon={FileText}
            title="No reports yet"
            description="Generate a report to share an optimization summary."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Report</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead className="text-right">Download</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.data.data.map((r) => (
                <TableRow key={r.reportId}>
                  <TableCell>
                    <div className="font-medium">{r.title}</div>
                    <div className="font-mono text-xs text-muted-foreground">{r.reportId}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.accountId ? alias(r.accountId) : 'All accounts'}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {formatDate(r.periodStart)} – {formatDate(r.periodEnd)}
                  </TableCell>
                  <TableCell>{r.format}</TableCell>
                  <TableCell>
                    <ReportStatusBadge status={r.status} />
                    {r.error && <div className="mt-1 max-w-56 text-xs text-destructive">{r.error}</div>}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{formatDateTime(r.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    {r.status === 'READY' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void download(r.reportId)}
                        disabled={downloading === r.reportId}
                      >
                        {downloading === r.reportId ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <Download />
                        )}
                        {r.sizeBytes ? formatBytes(r.sizeBytes) : 'Download'}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
