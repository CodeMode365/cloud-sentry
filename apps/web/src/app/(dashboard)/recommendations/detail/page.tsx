'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Info } from 'lucide-react';
import {
  LevelBadge,
  RecommendationStatusBadge,
  ResourceTypeBadge,
  SeverityBadge,
} from '@/components/common/badges';
import { EvidenceTable } from '@/components/common/evidence-table';
import { useAccountAlias } from '@/components/common/filters';
import { PageHeader } from '@/components/common/page-header';
import { SavingsAmount } from '@/components/common/savings';
import { EmptyState, ErrorState, KeyValue, PageLoading } from '@/components/common/states';
import { RecommendationActions } from '@/components/recommendations/recommendation-actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency, formatDateTime, titleCase } from '@/lib/format';
import { ACTION_LABELS } from '@/lib/labels';
import { useRecommendation } from '@/lib/queries';

function RecommendationDetail({ id }: { id: string }) {
  const q = useRecommendation(id);
  const alias = useAccountAlias();
  if (q.isPending) return <PageLoading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  const s = r.savings;

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link href="/recommendations/">
          <ArrowLeft /> Recommendations
        </Link>
      </Button>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5">
            <RecommendationStatusBadge status={r.status} />
            <SeverityBadge severity={r.severity} />
            <LevelBadge kind="confidence" level={r.confidence} />
            <LevelBadge kind="risk" level={r.riskLevel} />
          </span>
        }
        title={r.title}
        description={r.description}
        actions={<RecommendationActions recommendation={r} size="default" />}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Suggested action: {ACTION_LABELS[r.suggestedAction.type]}</CardTitle>
            <CardDescription>{r.suggestedAction.summary}</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              {r.suggestedAction.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-muted-foreground">
              CloudSentry is read-only: these steps are performed by your team in AWS. Review dependencies,
              backups and owners before making changes.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Estimated savings</CardTitle>
            <CardDescription>Estimates are not guaranteed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-8">
              <SavingsAmount savings={s} className="text-lg" />
              <SavingsAmount savings={s} period="annual" className="text-lg" />
            </div>
            {s.status === 'ESTIMATED' && (
              <KeyValue label="Method">
                <code className="text-xs">{s.method}</code>
              </KeyValue>
            )}
            {s.status === 'UNAVAILABLE' && s.unavailableReason && (
              <Alert variant="info">
                <Info />
                <AlertTitle>Not estimated</AlertTitle>
                <AlertDescription>{s.unavailableReason}</AlertDescription>
              </Alert>
            )}
            {r.realizedMonthlySavingsEstimate !== null && (
              <KeyValue label="Realized savings (estimated)">
                {formatCurrency(r.realizedMonthlySavingsEstimate)}/mo · based on pre-change pricing
              </KeyValue>
            )}
            <KeyValue label="Calculated">{formatDateTime(s.calculatedAt)}</KeyValue>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Supporting evidence</CardTitle>
            <CardDescription>
              From finding{' '}
              <Link
                href={`/findings/detail/?id=${encodeURIComponent(r.findingId)}`}
                className="text-primary hover:underline"
              >
                {r.ruleId}
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <EvidenceTable evidence={r.evidence} />
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
                  href={`/resources/detail/?key=${encodeURIComponent(r.resourceKey)}`}
                  className="text-primary hover:underline"
                >
                  {r.resourceName ?? r.resourceId}
                </Link>
              </KeyValue>
              <KeyValue label="Type">
                <ResourceTypeBadge type={r.resourceType} />
              </KeyValue>
              <KeyValue label="Account">{alias(r.accountId)}</KeyValue>
              <KeyValue label="Region">
                <span className="font-mono">{r.region}</span>
              </KeyValue>
            </dl>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Assumptions</CardTitle>
          </CardHeader>
          <CardContent>
            {s.assumptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No assumptions recorded.</p>
            ) : (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {s.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Status history</CardTitle>
          </CardHeader>
          <CardContent>
            {r.statusHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No status changes yet.</p>
            ) : (
              <ol className="space-y-3">
                {r.statusHistory.map((h, i) => (
                  <li key={`${h.at}-${i}`} className="text-sm">
                    <div className="flex items-center gap-2">
                      <RecommendationStatusBadge status={h.status} />
                      <span className="text-xs text-muted-foreground">{formatDateTime(h.at)}</span>
                    </div>
                    {h.note && <p className="mt-1 text-xs text-muted-foreground">“{h.note}”</p>}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
        {s.pricingSources.length > 0 && (
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Pricing sources</CardTitle>
              <CardDescription>On-demand list prices from the AWS Price List API.</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Price</TableHead>
                    <TableHead>Query</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Effective</TableHead>
                    <TableHead>Retrieved</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.pricingSources.map((p, i) => (
                    <TableRow key={i}>
                      <TableCell className="tabular-nums whitespace-nowrap">
                        ${p.unitPriceUsd} / {p.unit}
                      </TableCell>
                      <TableCell className="text-xs">
                        {titleCase(p.query.kind)}
                        <div className="font-mono text-muted-foreground">
                          {Object.entries(p.query)
                            .filter(([k]) => k !== 'kind')
                            .map(([k, v]) => `${k}=${String(v)}`)
                            .join(' · ')}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{p.sku ?? '—'}</TableCell>
                      <TableCell className="text-xs">
                        {p.effectiveDate ? formatDateTime(p.effectiveDate) : '—'}
                      </TableCell>
                      <TableCell className="text-xs">{formatDateTime(p.retrievedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

function Inner() {
  const id = useSearchParams().get('id');
  if (!id)
    return (
      <EmptyState title="No recommendation selected" description="Choose a recommendation from the list." />
    );
  return <RecommendationDetail id={id} />;
}

export default function RecommendationDetailPage() {
  return (
    <React.Suspense fallback={<PageLoading />}>
      <Inner />
    </React.Suspense>
  );
}
