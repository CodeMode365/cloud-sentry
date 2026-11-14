'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CircleDollarSign,
  Cloud,
  Lightbulb,
  OctagonAlert,
  PiggyBank,
  Server,
  TriangleAlert,
} from 'lucide-react';
import { RESOURCE_TYPE_LABELS, type ResourceType } from '@cloudsentry/shared-types';
import { DonutChart, CostAreaChart, RankedBarChart } from '@/components/charts/charts';
import { LevelBadge, ResourceTypeBadge, SeverityBadge } from '@/components/common/badges';
import { AccountFilter } from '@/components/common/filters';
import { KpiCard } from '@/components/common/kpi-card';
import { PageHeader } from '@/components/common/page-header';
import { SavingsAmount } from '@/components/common/savings';
import { EmptyState, ErrorState, PageLoading } from '@/components/common/states';
import { ScanTable } from '@/components/scans/scan-table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency, formatMonth, formatNumber } from '@/lib/format';
import { ACTION_LABELS } from '@/lib/labels';
import { usePermissions } from '@/lib/permissions';
import { useOverview } from '@/lib/queries';

export default function OverviewPage() {
  const [accountId, setAccountId] = React.useState<string | undefined>();
  const overview = useOverview(accountId);
  const { canManage } = usePermissions();

  if (overview.isPending) return <PageLoading />;
  if (overview.isError) return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  const o = overview.data;

  if (o.accounts.total === 0) {
    return (
      <>
        <PageHeader
          title="Overview"
          description="Find cloud waste. Understand the impact. Optimize with confidence."
        />
        <EmptyState
          icon={Cloud}
          title="Connect your first AWS account"
          description="CloudSentry uses a read-only IAM role in your account to discover resources, analyze utilization and spend, and recommend savings. No data is shown until an account is connected and scanned."
          action={
            canManage ? (
              <Button asChild>
                <Link href="/accounts/connect/">
                  Connect AWS account <ArrowRight />
                </Link>
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">Ask an administrator to connect an account.</p>
            )
          }
        />
      </>
    );
  }

  const currentPoint = o.costTrend[o.costTrend.length - 1];
  const trend = o.costTrend.map((p) => ({
    label: formatMonth(p.month),
    value: p.amount,
    unfinalized: p.unfinalized,
  }));
  const services = o.serviceCosts.slice(0, 8).map((s) => ({ label: s.key, value: s.amount }));
  const byType = (Object.entries(o.resources.byType) as [ResourceType, number][])
    .filter(([, n]) => n > 0)
    .map(([t, n]) => ({ label: RESOURCE_TYPE_LABELS[t], value: n }));
  const noCostData = o.spend.accountsWithCostData === 0;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Spend, utilization findings and estimated savings across your connected AWS accounts."
        actions={<AccountFilter value={accountId} onChange={setAccountId} className="w-full sm:w-64" />}
      />

      {o.spend.accountsWithoutCostData > 0 && (
        <Alert variant="info" className="mb-4">
          <CircleDollarSign />
          <AlertTitle>Cost data incomplete</AlertTitle>
          <AlertDescription>
            {o.spend.accountsWithoutCostData} account{o.spend.accountsWithoutCostData === 1 ? '' : 's'} have
            no Cost Explorer data yet (Cost Explorer may be disabled or not yet queried). Spend totals include
            only accounts with data. See{' '}
            <Link className="underline" href="/costs/">
              Cost Analytics
            </Link>{' '}
            for details.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label="Month-to-date spend"
          icon={CircleDollarSign}
          value={
            noCostData ? '—' : formatCurrency(o.spend.currentMonthToDate, { currency: o.spend.currency })
          }
          footnote={
            noCostData
              ? 'No Cost Explorer data available'
              : o.spend.syntheticCostIncluded
                ? 'Includes SYNTHETIC sample data (not real AWS billing)'
                : `Billed (AWS Cost Explorer)${currentPoint?.unfinalized ? ' · unfinalized' : ''}`
          }
          href="/costs/"
        />
        <KpiCard
          label="Potential monthly savings"
          icon={PiggyBank}
          tone="success"
          value={formatCurrency(o.potentialMonthlySavings)}
          footnote="Estimated · open, under review and accepted"
          href="/recommendations/"
        />
        <KpiCard
          label="Discovered resources"
          icon={Server}
          value={formatNumber(o.resources.total, 0)}
          footnote={`${o.accounts.connected} of ${o.accounts.total} accounts connected`}
          href="/resources/"
        />
        <KpiCard
          label="Active findings"
          icon={TriangleAlert}
          tone="warning"
          value={formatNumber(o.findings.active, 0)}
          footnote={`${o.findings.bySeverity.HIGH} high · ${o.findings.bySeverity.MEDIUM} medium · ${o.findings.bySeverity.LOW} low`}
          href="/findings/"
        />
        <KpiCard
          label="Critical findings"
          icon={OctagonAlert}
          tone="critical"
          value={formatNumber(o.findings.critical, 0)}
          footnote="Open or acknowledged"
          href="/findings/?severity=CRITICAL"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Monthly cost trend</CardTitle>
            <CardDescription>
              Billed cost from AWS Cost Explorer (current month is unfinalized).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {trend.length > 0 ? (
              <CostAreaChart data={trend} label="Monthly billed cost trend" />
            ) : (
              <EmptyState
                title="No cost data yet"
                description="Cost data appears after a scan retrieves Cost Explorer data."
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Resource distribution</CardTitle>
            <CardDescription>Active resources by type.</CardDescription>
          </CardHeader>
          <CardContent>
            {byType.length > 0 ? (
              <DonutChart data={byType} label="Resources by type" />
            ) : (
              <EmptyState title="No resources discovered" description="Run a scan to discover resources." />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Service cost distribution</CardTitle>
            <CardDescription>Current month, billed (top services).</CardDescription>
          </CardHeader>
          <CardContent>
            {services.length > 0 ? (
              <RankedBarChart data={services} label="Cost by AWS service" />
            ) : (
              <EmptyState
                title="No service breakdown"
                description="Available once Cost Explorer data is retrieved."
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top optimization opportunities</CardTitle>
            <CardDescription>Highest estimated monthly savings.</CardDescription>
            <CardAction>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/recommendations/">
                  View all <ArrowRight />
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {o.topOpportunities.length === 0 ? (
              <EmptyState
                icon={Lightbulb}
                title="No open recommendations"
                description="Recommendations appear after a scan detects optimization opportunities."
              />
            ) : (
              <ul className="divide-y">
                {o.topOpportunities.map((r) => (
                  <li
                    key={r.recommendationId}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 space-y-1">
                      <Link
                        href={`/recommendations/detail/?id=${encodeURIComponent(r.recommendationId)}`}
                        className="line-clamp-1 text-sm font-medium hover:underline"
                      >
                        {r.title}
                      </Link>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <ResourceTypeBadge type={r.resourceType} />
                        <SeverityBadge severity={r.severity} />
                        <LevelBadge kind="risk" level={r.riskLevel} />
                        <span className="text-xs text-muted-foreground">
                          {ACTION_LABELS[r.suggestedAction.type]}
                        </span>
                      </div>
                    </div>
                    <SavingsAmount savings={r.savings} className="shrink-0 text-right" />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Recent scans</CardTitle>
          <CardAction>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/scans/">
                Scan history <ArrowRight />
              </Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          {o.recentScans.length === 0 ? (
            <div className="px-5">
              <EmptyState title="No scans yet" description="Start a scan from the Cloud Accounts page." />
            </div>
          ) : (
            <ScanTable scans={o.recentScans} compact />
          )}
        </CardContent>
      </Card>
    </>
  );
}
