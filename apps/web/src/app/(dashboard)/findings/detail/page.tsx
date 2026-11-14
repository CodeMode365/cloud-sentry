'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { FindingStatusBadge, LevelBadge, ResourceTypeBadge, SeverityBadge } from '@/components/common/badges';
import { EvidenceTable, ThresholdList } from '@/components/common/evidence-table';
import { useAccountAlias } from '@/components/common/filters';
import { PageHeader } from '@/components/common/page-header';
import { SimpleSavings } from '@/components/common/savings';
import { EmptyState, ErrorState, KeyValue, PageLoading } from '@/components/common/states';
import { FindingActions } from '@/components/findings/finding-actions';
import { RecommendationMiniList } from '@/components/recommendations/recommendation-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime, formatNumber, titleCase } from '@/lib/format';
import { CATEGORY_LABELS } from '@/lib/labels';
import { useFinding, useResource } from '@/lib/queries';

function FindingDetail({ findingId }: { findingId: string }) {
  const q = useFinding(findingId);
  const resource = useResource(q.data?.resourceKey ?? null);
  const alias = useAccountAlias();
  if (q.isPending) return <PageLoading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const f = q.data;
  const related = (resource.data?.recommendations ?? []).filter((r) => r.findingId === f.findingId);

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link href="/findings/">
          <ArrowLeft /> Findings
        </Link>
      </Button>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5">
            <SeverityBadge severity={f.severity} />
            <FindingStatusBadge status={f.status} />
            <Badge variant="outline">{CATEGORY_LABELS[f.category]}</Badge>
            <LevelBadge kind="confidence" level={f.confidence} />
          </span>
        }
        title={f.title}
        description={f.description}
        actions={<FindingActions finding={f} />}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Detection evidence</CardTitle>
            <CardDescription>
              Rule <span className="font-mono">{f.ruleId}</span> v{f.ruleVersion} · {f.ruleName}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <EvidenceTable evidence={f.evidence} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Resource</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3">
              <KeyValue label="Resource">
                <Link
                  href={`/resources/detail/?key=${encodeURIComponent(f.resourceKey)}`}
                  className="text-primary hover:underline"
                >
                  {f.resourceName ?? f.resourceId}
                </Link>
                {f.resourceName && (
                  <div className="font-mono text-xs text-muted-foreground">{f.resourceId}</div>
                )}
              </KeyValue>
              <KeyValue label="Type">
                <ResourceTypeBadge type={f.resourceType} />
              </KeyValue>
              <KeyValue label="Account">
                {alias(f.accountId)}{' '}
                <span className="font-mono text-xs text-muted-foreground">({f.accountId})</span>
              </KeyValue>
              <KeyValue label="Region">
                <span className="font-mono">{f.region}</span>
              </KeyValue>
              <KeyValue label="Estimated monthly savings">
                <SimpleSavings monthly={f.estimatedMonthlySavings} estimateType={f.savingsEstimateType} />
              </KeyValue>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Lifecycle</CardTitle>
            <CardDescription>
              Findings are deduplicated: the same issue is tracked across scans.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2">
              <KeyValue label="First detected">{formatDateTime(f.firstDetectedAt)}</KeyValue>
              <KeyValue label="Last detected">{formatDateTime(f.lastDetectedAt)}</KeyValue>
              <KeyValue label="Last evaluated">{formatDateTime(f.lastEvaluatedAt)}</KeyValue>
              <KeyValue label="Occurrences">{formatNumber(f.occurrenceCount, 0)} scans</KeyValue>
              <KeyValue label="Reopened">{formatNumber(f.reopenCount, 0)} times</KeyValue>
              <KeyValue label="Resolved">
                {f.resolvedAt
                  ? `${formatDateTime(f.resolvedAt)}${f.resolutionReason ? ` · ${titleCase(f.resolutionReason)}` : ''}`
                  : '—'}
              </KeyValue>
              <KeyValue label="Last scan" className="sm:col-span-2">
                <Link
                  href={`/scans/detail/?id=${encodeURIComponent(f.lastScanId)}`}
                  className="font-mono text-xs text-primary hover:underline"
                >
                  {f.lastScanId}
                </Link>
              </KeyValue>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Thresholds applied</CardTitle>
          </CardHeader>
          <CardContent>
            <ThresholdList thresholds={f.thresholds} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3">
              <KeyValue label="Current status">
                <FindingStatusBadge status={f.status} />
              </KeyValue>
              <KeyValue label="Updated">{formatDateTime(f.statusUpdatedAt)}</KeyValue>
              <KeyValue label="Note">
                {f.statusNote ?? <span className="text-muted-foreground">—</span>}
              </KeyValue>
            </dl>
          </CardContent>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Recommendation</CardTitle>
          </CardHeader>
          <CardContent>
            {resource.isPending ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : related.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recommendation is linked to this finding.</p>
            ) : (
              <RecommendationMiniList recommendations={related} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Inner() {
  const id = useSearchParams().get('id');
  if (!id) return <EmptyState title="No finding selected" description="Choose a finding from the list." />;
  return <FindingDetail findingId={id} />;
}

export default function FindingDetailPage() {
  return (
    <React.Suspense fallback={<PageLoading />}>
      <Inner />
    </React.Suspense>
  );
}
