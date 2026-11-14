'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ResourceTypeBadge } from '@/components/common/badges';
import { useAccountAlias } from '@/components/common/filters';
import { CopyButton } from '@/components/common/copy-button';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, KeyValue, PageLoading } from '@/components/common/states';
import { FindingTable } from '@/components/findings/finding-table';
import { RecommendationMiniList } from '@/components/recommendations/recommendation-list';
import { AvailabilityBadge, formatMetricValue } from '@/components/resources/utilization';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes, formatDateTime, formatPercent, titleCase } from '@/lib/format';
import { useResource } from '@/lib/queries';

/** Nested structures (node groups, backup summaries) get a full-width row. */
function isComplex(value: unknown): boolean {
  return (
    (Array.isArray(value) && value.some((v) => typeof v === 'object' && v !== null)) ||
    (typeof value === 'object' && value !== null && !Array.isArray(value))
  );
}

function renderAttribute(value: unknown, key = ''): React.ReactNode {
  if (typeof value === 'number' && /bytes/i.test(key))
    return `${formatBytes(value)} (${value.toLocaleString()} bytes)`;
  if (value === null || value === undefined || value === '')
    return <span className="text-muted-foreground">—</span>;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">None</span>;
    if (value.every((v) => typeof v !== 'object')) return value.join(', ');
    return <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>;
  }
  if (typeof value === 'object')
    return <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>;
  return String(value);
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/Gi B/, 'GiB');
}

function ResourceDetail({ resourceKey }: { resourceKey: string }) {
  const q = useResource(resourceKey);
  const alias = useAccountAlias();
  if (q.isPending) return <PageLoading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { resource: r, findings, recommendations } = q.data;
  const metrics = r.utilization ? Object.values(r.utilization.metrics) : [];

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link href="/resources/">
          <ArrowLeft /> Resources
        </Link>
      </Button>
      <PageHeader
        eyebrow={<ResourceTypeBadge type={r.resourceType} />}
        title={r.name ?? r.resourceId}
        description={
          <span className="flex items-center gap-2 font-mono text-xs">
            {r.resourceId} <CopyButton value={r.resourceId} iconOnly label="Copy resource ID" />
          </span>
        }
        actions={
          r.lifecycleStatus === 'NOT_FOUND' ? (
            <Badge variant="outline">Not found in latest scan</Badge>
          ) : (
            <Badge variant="success">Active</Badge>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-3">
              <KeyValue label="Account">
                {alias(r.accountId)}{' '}
                <span className="font-mono text-xs text-muted-foreground">({r.accountId})</span>
              </KeyValue>
              <KeyValue label="Region">
                <span className="font-mono">{r.region}</span>
              </KeyValue>
              <KeyValue label="State">{r.state}</KeyValue>
              <KeyValue label="Created">{formatDateTime(r.createdAt)}</KeyValue>
              <KeyValue label="First seen">{formatDateTime(r.firstSeenAt)}</KeyValue>
              <KeyValue label="Last seen">{formatDateTime(r.lastSeenAt)}</KeyValue>
              {r.arn && (
                <KeyValue label="ARN" className="sm:col-span-3">
                  <code className="text-xs break-all">{r.arn}</code>
                </KeyValue>
              )}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Tags</CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(r.tags).length === 0 ? (
              <p className="text-sm text-muted-foreground">No tags</p>
            ) : (
              <dl className="space-y-2">
                {Object.entries(r.tags).map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-3 text-sm">
                    <dt className="font-mono text-xs text-muted-foreground">{k}</dt>
                    <dd className="text-right break-all">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Attributes</CardTitle>
            <CardDescription>Configuration reported by the AWS API during the last scan.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(r.attributes as unknown as Record<string, unknown>).map(([k, v]) => (
                <KeyValue
                  key={k}
                  label={humanizeKey(k)}
                  className={isComplex(v) ? 'sm:col-span-2 lg:col-span-4' : undefined}
                >
                  {renderAttribute(v, k)}
                </KeyValue>
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card className="lg:col-span-3 gap-2">
          <CardHeader>
            <CardTitle>Utilization (CloudWatch)</CardTitle>
            <CardDescription>
              {r.utilization
                ? `${r.utilization.lookbackDays}-day lookback (${formatDateTime(r.utilization.periodStart)} – ${formatDateTime(r.utilization.periodEnd)}), collected ${formatDateTime(r.utilization.collectedAt)}. Percentiles are computed over hourly datapoints.`
                : 'Metrics are not collected for this resource type or have not been collected yet.'}
            </CardDescription>
          </CardHeader>
          {metrics.length > 0 && (
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Metric</TableHead>
                    <TableHead>Statistic</TableHead>
                    <TableHead>Availability</TableHead>
                    <TableHead className="text-right">Average</TableHead>
                    <TableHead className="text-right">Min</TableHead>
                    <TableHead className="text-right">Max</TableHead>
                    <TableHead className="text-right">p95</TableHead>
                    <TableHead className="text-right">Sum</TableHead>
                    <TableHead className="text-right">Coverage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.map((m) => (
                    <TableRow key={`${m.metricName}:${m.statistic}`}>
                      <TableCell className="font-mono text-xs">{m.metricName}</TableCell>
                      <TableCell>{m.statistic}</TableCell>
                      <TableCell>
                        <AvailabilityBadge summary={m} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMetricValue(m.stats?.average ?? null, m.unit)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMetricValue(m.stats?.minimum ?? null, m.unit)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMetricValue(m.stats?.maximum ?? null, m.unit)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMetricValue(m.stats?.p95 ?? null, m.unit)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.statistic === 'Sum' ? formatMetricValue(m.stats?.sum ?? null, m.unit) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.stats
                          ? `${formatPercent(m.stats.coverage * 100, 0)} (${m.stats.datapoints}/${m.stats.expectedDatapoints})`
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Findings</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {findings.length === 0 ? (
              <div className="px-5">
                <EmptyState title="No findings" description="No detection rule flagged this resource." />
              </div>
            ) : (
              <FindingTable findings={findings} showResource={false} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recommendations</CardTitle>
          </CardHeader>
          <CardContent>
            {recommendations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recommendations for this resource.</p>
            ) : (
              <RecommendationMiniList recommendations={recommendations} />
            )}
          </CardContent>
        </Card>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Lifecycle: {titleCase(r.lifecycleStatus)} · last scan {r.lastSeenScanId}
      </p>
    </>
  );
}

function Inner() {
  const key = useSearchParams().get('key');
  if (!key)
    return <EmptyState title="No resource selected" description="Choose a resource from the inventory." />;
  return <ResourceDetail resourceKey={key} />;
}

export default function ResourceDetailPage() {
  return (
    <React.Suspense fallback={<PageLoading />}>
      <Inner />
    </React.Suspense>
  );
}
