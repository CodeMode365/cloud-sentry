import type { CloudResource, MetricSeriesSummary, ResourceType } from '@cloudsentry/shared-types';
import { Badge } from '@/components/ui/badge';
import { formatBytes, formatNumber, formatPercent } from '@/lib/format';

export function formatMetricValue(value: number | null, unit: string | null): string {
  if (value === null) return '—';
  switch (unit) {
    case 'Percent':
      return formatPercent(value);
    case 'Bytes':
      return formatBytes(value);
    case 'Bytes/Second':
      return `${formatBytes(value)}/s`;
    default:
      return formatNumber(value);
  }
}

export function AvailabilityBadge({ summary }: { summary: MetricSeriesSummary }) {
  switch (summary.availability) {
    case 'AVAILABLE':
      return <Badge variant="success">Available</Badge>;
    case 'NO_DATA':
      return (
        <Badge
          variant="outline"
          title="CloudWatch returned no datapoints. This is not the same as zero utilization."
        >
          No data
        </Badge>
      );
    case 'NOT_COLLECTED':
      return <Badge variant="secondary">Not collected</Badge>;
    default:
      return (
        <Badge variant="destructive" title={summary.error}>
          Error
        </Badge>
      );
  }
}

/** Metric shown in inventory tables per resource type (keys follow the scanner metric catalog). */
const HEADLINE_METRIC: Partial<Record<ResourceType, { key: string; label: string }>> = {
  EC2_INSTANCE: { key: 'CPUUtilization:Average', label: 'CPU avg' },
  RDS_INSTANCE: { key: 'CPUUtilization:Average', label: 'CPU avg' },
  NAT_GATEWAY: { key: 'BytesOutToDestination:Sum', label: 'Bytes out total' },
  EBS_VOLUME: { key: 'VolumeReadOps:Sum', label: 'Read ops total' },
  LAMBDA_FUNCTION: { key: 'Invocations:Sum', label: 'Invocations' },
  EKS_CLUSTER: { key: 'node_cpu_utilization:Average', label: 'Node CPU avg' },
  ELASTICACHE_CLUSTER: { key: 'CPUUtilization:Average', label: 'CPU avg' },
  CLOUDFRONT_DISTRIBUTION: { key: 'Requests:Sum', label: 'Requests' },
  EFS_FILE_SYSTEM: { key: 'ClientConnections:Maximum', label: 'Max connections' },
  DYNAMODB_TABLE: { key: 'ConsumedReadCapacityUnits:Sum', label: 'Read units total' },
  REDSHIFT_CLUSTER: { key: 'CPUUtilization:Average', label: 'CPU avg' },
};

/** One-line utilization summary used in inventory tables. Unavailable data is shown explicitly, never as 0. */
export function UtilizationSummary({ resource }: { resource: CloudResource }) {
  const u = resource.utilization;
  if (!u) return <span className="text-xs text-muted-foreground">Not collected</span>;
  const headline = HEADLINE_METRIC[resource.resourceType];
  const key = headline?.key ?? null;
  const summary = key ? u.metrics[key] : undefined;
  if (!summary) return <span className="text-xs text-muted-foreground">—</span>;
  if (summary.availability !== 'AVAILABLE' || !summary.stats) {
    return <AvailabilityBadge summary={summary} />;
  }
  const label = headline?.label ?? summary.metricName;
  const value = summary.statistic === 'Sum' ? summary.stats.sum : summary.stats.average;
  return (
    <span className="text-xs">
      <span className="text-muted-foreground">{label}</span>{' '}
      <span className="font-medium tabular-nums">{formatMetricValue(value, summary.unit)}</span>
      <span className="text-muted-foreground"> · {u.lookbackDays}d</span>
    </span>
  );
}
