'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, CircleStop, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { RESOURCE_TYPE_LABELS, SCAN_STEPS, type ScanExecution } from '@cloudsentry/shared-types';
import { ScanStatusBadge, StepStatusBadge } from '@/components/common/badges';
import { useAccountAlias } from '@/components/common/filters';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, KeyValue, PageLoading } from '@/components/common/states';
import { FindingTable } from '@/components/findings/finding-table';
import { scanDuration } from '@/components/scans/scan-table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency, formatDateTime, formatDuration, formatNumber, titleCase } from '@/lib/format';
import { STEP_LABELS } from '@/lib/labels';
import { usePermissions } from '@/lib/permissions';
import { isTerminalScan, useCancelScan, useScan, useScanResults } from '@/lib/queries';
import { cn } from '@/lib/utils';

function StepTimeline({ scan }: { scan: ScanExecution }) {
  const done = SCAN_STEPS.filter((s) => {
    const st = scan.steps[s]?.status;
    return st === 'SUCCEEDED' || st === 'PARTIAL' || st === 'SKIPPED' || st === 'FAILED';
  }).length;
  return (
    <div className="space-y-4">
      <Progress value={(done / SCAN_STEPS.length) * 100} aria-label="Scan progress" />
      <ol className="relative space-y-0">
        {SCAN_STEPS.map((step, i) => {
          const state = scan.steps[step];
          const status = state?.status ?? 'PENDING';
          const elapsed =
            state?.startedAt && state.completedAt
              ? new Date(state.completedAt).getTime() - new Date(state.startedAt).getTime()
              : null;
          return (
            <li key={step} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    'mt-1 size-2.5 rounded-full border-2',
                    status === 'SUCCEEDED' && 'border-success bg-success',
                    status === 'PARTIAL' && 'border-warning bg-warning',
                    status === 'FAILED' && 'border-destructive bg-destructive',
                    status === 'RUNNING' && 'animate-pulse border-info bg-info',
                    (status === 'PENDING' || status === 'SKIPPED') && 'border-muted-foreground/40',
                  )}
                />
                {i < SCAN_STEPS.length - 1 && <span className="w-px flex-1 bg-border" />}
              </div>
              <div className="min-w-0 flex-1 pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{STEP_LABELS[step]}</span>
                  <StepStatusBadge status={status} />
                  {elapsed !== null && (
                    <span className="text-xs text-muted-foreground">{formatDuration(elapsed)}</span>
                  )}
                </div>
                {state?.message && <p className="mt-0.5 text-xs text-muted-foreground">{state.message}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ScanDetail({ scanId }: { scanId: string }) {
  const q = useScan(scanId);
  const terminal = q.data ? isTerminalScan(q.data.status) : false;
  const results = useScanResults(scanId, terminal);
  const cancel = useCancelScan();
  const alias = useAccountAlias();
  const { canOperate } = usePermissions();
  if (q.isPending) return <PageLoading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;
  const sum = s.summary;

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link href="/scans/">
          <ArrowLeft /> Scan History
        </Link>
      </Button>
      <PageHeader
        eyebrow={<ScanStatusBadge status={s.status} />}
        title={<span className="font-mono text-xl">{s.scanId}</span>}
        description={
          <>
            {titleCase(s.trigger)} scan of{' '}
            <Link href={`/accounts/detail/?id=${s.accountId}`} className="text-primary hover:underline">
              {alias(s.accountId)}
            </Link>{' '}
            ({s.accountId}) · regions {s.regions.join(', ') || '—'}
          </>
        }
        actions={
          canOperate &&
          !terminal && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={s.cancelRequested || cancel.isPending}>
                  {cancel.isPending ? <LoaderCircle className="animate-spin" /> : <CircleStop />}
                  {s.cancelRequested ? 'Cancelling…' : 'Cancel scan'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this scan?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The Step Functions execution is stopped. Results already persisted remain; findings are
                    not resolved from a cancelled scan.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep running</AlertDialogCancel>
                  <AlertDialogAction
                    destructive
                    onClick={() =>
                      void cancel.mutateAsync(s.scanId).then(() => toast.success('Cancellation requested'))
                    }
                  >
                    Cancel scan
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Execution</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <KeyValue label="Requested">{formatDateTime(s.requestedAt)}</KeyValue>
              <KeyValue label="Started">{formatDateTime(s.startedAt)}</KeyValue>
              <KeyValue label="Completed">{formatDateTime(s.completedAt)}</KeyValue>
              <KeyValue label="Duration">{formatDuration(scanDuration(s))}</KeyValue>
              <KeyValue label="Triggered by">
                <span className="font-mono text-xs break-all">{s.triggeredBy}</span>
              </KeyValue>
              {s.executionArn && (
                <KeyValue label="Step Functions execution">
                  <span className="font-mono text-xs break-all">{s.executionArn}</span>
                </KeyValue>
              )}
            </dl>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Workflow steps</CardTitle>
            <CardDescription>
              {terminal ? 'Final state of each step.' : 'Updates every 5 seconds while running.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StepTimeline scan={s} />
          </CardContent>
        </Card>

        {sum && (
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <KeyValue label="Resources discovered">{formatNumber(sum.resourcesDiscovered, 0)}</KeyValue>
                <KeyValue label="Findings detected">{formatNumber(sum.findingsDetected, 0)}</KeyValue>
                <KeyValue label="New / reopened">
                  {formatNumber(sum.newFindings, 0)} / {formatNumber(sum.reopenedFindings, 0)}
                </KeyValue>
                <KeyValue label="Resolved">{formatNumber(sum.resolvedFindings, 0)}</KeyValue>
                <KeyValue label="Critical">{formatNumber(sum.criticalFindings, 0)}</KeyValue>
                <KeyValue label="Potential savings">
                  {formatCurrency(sum.potentialMonthlySavings)}/mo{' '}
                  <span className="text-xs text-muted-foreground">est.</span>
                </KeyValue>
                <KeyValue label="Metrics coverage">
                  {sum.metricsCoverage.resourcesWithMetrics} with ·{' '}
                  {sum.metricsCoverage.resourcesWithoutMetrics} without
                </KeyValue>
                <KeyValue label="Cost data">{sum.costDataAvailable ? 'Retrieved' : 'Unavailable'}</KeyValue>
                <KeyValue label="Open recommendations">{formatNumber(sum.openRecommendations, 0)}</KeyValue>
              </dl>
            </CardContent>
          </Card>
        )}

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Resource discovery</CardTitle>
            <CardDescription>
              Each resource type is discovered independently; a failed region does not fail the scan.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {s.discovery.length === 0 ? (
              <p className="px-5 text-sm text-muted-foreground">Discovery has not reported results yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Resource type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Resources</TableHead>
                    <TableHead>Regions succeeded</TableHead>
                    <TableHead>Region errors</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.discovery.map((d) => (
                    <TableRow key={d.resourceType}>
                      <TableCell>{RESOURCE_TYPE_LABELS[d.resourceType]}</TableCell>
                      <TableCell>
                        <StepStatusBadge status={d.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(d.resourceCount, 0)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {d.regionsSucceeded.join(', ') || '—'}
                      </TableCell>
                      <TableCell>
                        {d.regionsFailed.length === 0 && !d.errorMessage ? (
                          <span className="text-xs text-muted-foreground">None</span>
                        ) : (
                          <ul className="space-y-1 text-xs">
                            {d.errorMessage && <li className="text-destructive">{d.errorMessage}</li>}
                            {d.regionsFailed.map((f) => (
                              <li key={f.region}>
                                <Badge variant="destructive" className="font-mono">
                                  {f.region}
                                </Badge>{' '}
                                <span className="font-mono">{f.errorCode}</span>: {f.message}
                              </li>
                            ))}
                          </ul>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatDuration(d.durationMs)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {s.errors.length > 0 && (
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Errors</CardTitle>
              <CardDescription>
                Recorded failures. Partial failures still allow the rest of the scan to complete.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Step</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.errors.map((e, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm">
                        {e.step === 'Workflow' ? 'Workflow' : STEP_LABELS[e.step]}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{e.code}</TableCell>
                      <TableCell className="max-w-md text-xs">{e.message}</TableCell>
                      <TableCell className="text-xs">
                        {[e.resourceType ? RESOURCE_TYPE_LABELS[e.resourceType] : null, e.region]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{formatDateTime(e.at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Findings from this scan</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {!terminal ? (
              <p className="px-5 text-sm text-muted-foreground">Available when the scan finishes.</p>
            ) : results.isPending ? (
              <p className="px-5 text-sm text-muted-foreground">Loading results…</p>
            ) : results.isError ? (
              <ErrorState error={results.error} className="mx-5" />
            ) : results.data.findings.length === 0 ? (
              <div className="px-5">
                <EmptyState title="No findings" description="This scan did not detect any issues." />
              </div>
            ) : (
              <FindingTable findings={results.data.findings} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Inner() {
  const id = useSearchParams().get('id');
  if (!id) return <EmptyState title="No scan selected" description="Choose a scan from the history." />;
  return <ScanDetail scanId={id} />;
}

export default function ScanDetailPage() {
  return (
    <React.Suspense fallback={<PageLoading />}>
      <Inner />
    </React.Suspense>
  );
}
