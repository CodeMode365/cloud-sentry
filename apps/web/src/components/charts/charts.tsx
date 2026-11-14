'use client';

import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency, formatNumber } from '@/lib/format';

export const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
];

const tooltipStyle: React.CSSProperties = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--popover-foreground)',
  fontSize: 12,
  boxShadow: '0 4px 12px rgb(0 0 0 / 0.08)',
};

function currencyTick(value: number): string {
  return formatCurrency(value, { compact: true });
}

function currencyTooltip(value: unknown): string {
  return typeof value === 'number' ? formatCurrency(value) : String(value);
}

export function ChartFrame({
  height = 260,
  children,
  label,
}: {
  height?: number;
  children: React.ReactElement;
  label: string;
}) {
  return (
    <div role="img" aria-label={label} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

export interface SeriesPoint {
  label: string;
  value: number;
  /** Marks unfinalized Cost Explorer values. */
  unfinalized?: boolean;
}

export function CostAreaChart({
  data,
  label,
  height,
}: {
  data: SeriesPoint[];
  label: string;
  height?: number;
}) {
  return (
    <ChartFrame label={label} {...(height ? { height } : {})}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tickFormatter={currencyTick} tickLine={false} axisLine={false} width={64} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, _name, item) => {
            const point = item.payload as SeriesPoint | undefined;
            return [`${currencyTooltip(value)}${point?.unfinalized ? ' (unfinalized)' : ''}`, 'Billed cost'];
          }}
        />
        <Area type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={2} fill="url(#costFill)" />
      </AreaChart>
    </ChartFrame>
  );
}

export function CostBarChart({
  data,
  label,
  height,
  color = 'var(--chart-1)',
}: {
  data: SeriesPoint[];
  label: string;
  height?: number;
  color?: string;
}) {
  return (
    <ChartFrame label={label} {...(height ? { height } : {})}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={8} />
        <YAxis tickFormatter={currencyTick} tickLine={false} axisLine={false} width={64} />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: 'var(--muted)' }}
          formatter={(value, _name, item) => {
            const point = item.payload as SeriesPoint | undefined;
            return [`${currencyTooltip(value)}${point?.unfinalized ? ' (unfinalized)' : ''}`, 'Billed cost'];
          }}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} fill={color} />
      </BarChart>
    </ChartFrame>
  );
}

/** Horizontal ranked bars, e.g. cost by service. */
export function RankedBarChart({
  data,
  label,
  valueFormat = 'currency',
  height,
}: {
  data: { label: string; value: number }[];
  label: string;
  valueFormat?: 'currency' | 'number';
  height?: number;
}) {
  const h = height ?? Math.max(160, data.length * 32 + 24);
  const fmt = valueFormat === 'currency' ? currencyTick : (v: number) => formatNumber(v, 0);
  return (
    <ChartFrame label={label} height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" tickFormatter={fmt} tickLine={false} axisLine={false} />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={150}
          tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: 'var(--muted)' }}
          formatter={(value) => [
            valueFormat === 'currency' ? currencyTooltip(value) : formatNumber(Number(value), 0),
            valueFormat === 'currency' ? 'Cost' : 'Count',
          ]}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

export function DonutChart({
  data,
  label,
  valueFormat = 'number',
  height = 240,
}: {
  data: { label: string; value: number }[];
  label: string;
  valueFormat?: 'currency' | 'number';
  height?: number;
}) {
  return (
    <ChartFrame label={label} height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          innerRadius="55%"
          outerRadius="85%"
          paddingAngle={2}
          stroke="var(--card)"
        >
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name) => [
            valueFormat === 'currency' ? currencyTooltip(value) : formatNumber(Number(value), 0),
            String(name),
          ]}
        />
        <Legend verticalAlign="bottom" iconType="circle" iconSize={8} />
      </PieChart>
    </ChartFrame>
  );
}

export function ComparisonLineChart({
  data,
  label,
  seriesA,
  seriesB,
  height,
}: {
  data: { label: string; a: number | null; b: number | null }[];
  label: string;
  seriesA: string;
  seriesB: string;
  height?: number;
}) {
  return (
    <ChartFrame label={label} {...(height ? { height } : {})}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={8} />
        <YAxis tickFormatter={currencyTick} tickLine={false} axisLine={false} width={64} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name) => [currencyTooltip(value), String(name)]}
        />
        <Legend iconType="plainline" />
        <Line
          type="monotone"
          dataKey="a"
          name={seriesA}
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="b"
          name={seriesB}
          stroke="var(--chart-muted)"
          strokeWidth={2}
          strokeDasharray="4 4"
          dot={false}
          connectNulls={false}
        />
      </LineChart>
    </ChartFrame>
  );
}
