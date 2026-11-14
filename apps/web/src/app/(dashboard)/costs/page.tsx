'use client';

import * as React from 'react';
import { CircleDollarSign, Info, PiggyBank, TrendingDown, TrendingUp } from 'lucide-react';
import { ComparisonLineChart, CostAreaChart, CostBarChart, RankedBarChart } from '@/components/charts/charts';
import { AccountFilter, FilterSelect, useAccountAlias } from '@/components/common/filters';
import { KpiCard } from '@/components/common/kpi-card';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, PageLoading } from '@/components/common/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency, formatDate, formatDateTime, formatMonth, formatPercent } from '@/lib/format';
import { useCostAnalytics } from '@/lib/queries';

export default function CostAnalyticsPage() {
  const [accountId, setAccountId] = React.useState<string | undefined>();
  const [months, setMonths] = React.useState('6');
  const alias = useAccountAlias();
  const q = useCostAnalytics({ accountId, months: Number(months) });

  const header = (
    <PageHeader
      title="Cost Analytics"
      description="Actual AWS spend reported by AWS Cost Explorer. Savings figures are CloudSentry estimates."
      actions={
        <>
          <AccountFilter value={accountId} onChange={setAccountId} className="w-full sm:w-64" />
          <FilterSelect
            label="Period"
            value={months}
            onChange={(v) => setMonths(v ?? '6')}
            allLabel="6 months"
            className="w-full sm:w-36"
            options={[
              { value: '3', label: '3 months' },
              { value: '6', label: '6 months' },
              { value: '12', label: '12 months' },
            ]}
          />
        </>
      }
    />
  );

  if (q.isPending)
    return (
      <>
        {header}
        <PageLoading />
      </>
    );
  if (q.isError)
    return (
      <>
        {header}
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </>
    );
  const c = q.data;
  const cur = c.currency;
  const mom = c.monthOverMonth;

  const unavailable = c.unavailableAccounts.length > 0 && (
    <Alert variant={c.availability === 'UNAVAILABLE' ? 'warning' : 'info'} className="mb-4">
      <Info />
      <AlertTitle>
        {c.availability === 'UNAVAILABLE'
          ? 'Cost data unavailable'
          : 'Cost data unavailable for some accounts'}
      </AlertTitle>
      <AlertDescription>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {c.unavailableAccounts.map((a) => (
            <li key={a.accountId}>
              <span className="font-medium">{alias(a.accountId)}</span> ({a.accountId}):{' '}
              {a.reason ??
                'Cost Explorer has not returned data yet. Run a scan, and ensure Cost Explorer is enabled.'}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );

  if (c.availability === 'UNAVAILABLE') {
    return (
      <>
        {header}
        {unavailable}
        <EmptyState
          icon={CircleDollarSign}
          title="No cost data"
          description="Cost data appears after a scan retrieves it from AWS Cost Explorer. Cost Explorer must be enabled in the account (or its payer account) and the CloudSentry role needs ce:GetCostAndUsage."
        />
      </>
    );
  }

  const trend = c.monthlyTrend.map((p) => ({
    label: formatMonth(p.month),
    value: p.amount,
    unfinalized: p.unfinalized,
  }));
  const dayMap = new Map<number, { a: number | null; b: number | null }>();
  for (const d of c.daily)
    dayMap.set(Number(d.date.slice(8, 10)), {
      a: d.amount,
      b: dayMap.get(Number(d.date.slice(8, 10)))?.b ?? null,
    });
  for (const d of c.previousMonthDaily) {
    const day = Number(d.date.slice(8, 10));
    dayMap.set(day, { a: dayMap.get(day)?.a ?? null, b: d.amount });
  }
  const comparison = Array.from(dayMap.entries())
    .sort((x, y) => x[0] - y[0])
    .map(([day, v]) => ({ label: String(day), a: v.a, b: v.b }));
  const daily = c.daily.map((d) => ({ label: d.date.slice(5), value: d.amount, unfinalized: d.unfinalized }));
  const unfinalized = c.daily.some((d) => d.unfinalized) || c.monthlyTrend.some((m) => m.unfinalized);
  const increase = (mom.changeAmount ?? 0) > 0;

  return (
    <>
      {header}
      {unavailable}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Month to date"
          icon={CircleDollarSign}
          value={formatCurrency(mom.currentMonthToDate, { currency: cur })}
          footnote={
            c.syntheticCostIncluded
              ? 'Includes SYNTHETIC sample data (not real AWS billing)'
              : `Billed (AWS Cost Explorer)${unfinalized ? ' · unfinalized' : ''}`
          }
        />
        <KpiCard
          label="Previous month (same period)"
          icon={CircleDollarSign}
          value={formatCurrency(mom.previousMonthToDate, { currency: cur })}
          footnote={`Full previous month: ${formatCurrency(mom.previousMonthTotal, { currency: cur })}`}
        />
        <KpiCard
          label="Month-over-month"
          icon={increase ? TrendingUp : TrendingDown}
          tone={increase ? 'warning' : 'success'}
          value={
            mom.changeAmount === null
              ? '—'
              : `${increase ? '+' : ''}${formatCurrency(mom.changeAmount, { currency: cur })}`
          }
          footnote={
            mom.changePercent === null
              ? 'Not enough data'
              : `${increase ? '+' : ''}${formatPercent(mom.changePercent)} vs same days last month`
          }
        />
        <KpiCard
          label="Potential savings"
          icon={PiggyBank}
          tone="success"
          value={formatCurrency(c.estimatedSavings.potentialMonthly)}
          footnote={`Estimated · ${formatCurrency(c.estimatedSavings.potentialAnnual)}/yr`}
          href="/recommendations/"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Monthly cost trend</CardTitle>
            <CardDescription>Billed cost per month.</CardDescription>
          </CardHeader>
          <CardContent>
            {trend.length ? (
              <CostAreaChart data={trend} label="Monthly cost trend" />
            ) : (
              <EmptyState title="No monthly data" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Daily spend: this month vs last month</CardTitle>
            <CardDescription>By day of month.</CardDescription>
          </CardHeader>
          <CardContent>
            {comparison.length ? (
              <ComparisonLineChart
                data={comparison}
                label="Daily cost comparison"
                seriesA="This month"
                seriesB="Previous month"
              />
            ) : (
              <EmptyState title="No daily data" />
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Daily spending</CardTitle>
            <CardDescription>
              Current month, billed per day{unfinalized ? ' (recent days are unfinalized)' : ''}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {daily.length ? (
              <CostBarChart data={daily} label="Daily spending" height={220} />
            ) : (
              <EmptyState title="No daily data" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cost by service</CardTitle>
            <CardDescription>Current month.</CardDescription>
          </CardHeader>
          <CardContent>
            {c.services.length ? (
              <RankedBarChart
                data={c.services.slice(0, 10).map((s) => ({ label: s.key, value: s.amount }))}
                label="Cost by service"
              />
            ) : (
              <EmptyState title="No service breakdown" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cost by region</CardTitle>
            <CardDescription>
              Current month. Global services report as “global” or “NoRegion”.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {c.regions.length ? (
              <RankedBarChart
                data={c.regions.slice(0, 10).map((s) => ({ label: s.key, value: s.amount }))}
                label="Cost by region"
              />
            ) : (
              <EmptyState title="No regional breakdown" />
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Cost anomalies</CardTitle>
            <CardDescription>
              Days whose spend deviates significantly from the trailing baseline.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {c.anomalies.length === 0 ? (
              <p className="px-5 text-sm text-muted-foreground">No anomalies detected in this period.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">Baseline</TableHead>
                    <TableHead className="text-right">Deviation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {c.anomalies.map((a) => (
                    <TableRow key={a.date}>
                      <TableCell>{formatDate(a.date)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(a.amount, { currency: cur })}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(a.baseline, { currency: cur })}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={a.deviationPercent > 0 ? 'warning' : 'info'}>
                          {a.deviationPercent > 0 ? '+' : ''}
                          {formatPercent(a.deviationPercent)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {c.syntheticCostIncluded && <strong>Includes SYNTHETIC local-development sample data. </strong>}
        Source: AWS Cost Explorer{c.retrievedAt ? `, retrieved ${formatDateTime(c.retrievedAt)}` : ''}. Costs
        for open billing periods are unfinalized and may change. Savings are estimates from AWS list prices
        and are not guaranteed.
      </p>
    </>
  );
}
