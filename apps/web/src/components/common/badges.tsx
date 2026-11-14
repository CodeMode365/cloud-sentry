import * as React from 'react';
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  FlaskConical,
  LoaderCircle,
  OctagonX,
  TriangleAlert,
} from 'lucide-react';
import {
  RESOURCE_TYPE_LABELS,
  type AccountStatus,
  type ConfidenceLevel,
  type FindingStatus,
  type RecommendationStatus,
  type ReportStatus,
  type ResourceType,
  type RiskLevel,
  type ScanStatus,
  type Severity,
  type StepStatus,
} from '@cloudsentry/shared-types';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { titleCase } from '@/lib/format';

type Variant = NonNullable<BadgeProps['variant']>;

const SEVERITY_VARIANT: Record<Severity, Variant> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge variant={SEVERITY_VARIANT[severity]}>{titleCase(severity)}</Badge>;
}

const SCAN_VARIANT: Record<ScanStatus, Variant> = {
  PENDING: 'secondary',
  RUNNING: 'info',
  PARTIALLY_COMPLETED: 'warning',
  COMPLETED: 'success',
  FAILED: 'destructive',
  CANCELLED: 'outline',
};

export function ScanStatusBadge({ status }: { status: ScanStatus }) {
  const Icon =
    status === 'RUNNING'
      ? LoaderCircle
      : status === 'COMPLETED'
        ? CircleCheck
        : status === 'FAILED'
          ? CircleX
          : status === 'PARTIALLY_COMPLETED'
            ? TriangleAlert
            : status === 'CANCELLED'
              ? OctagonX
              : Clock;
  return (
    <Badge variant={SCAN_VARIANT[status]}>
      <Icon className={status === 'RUNNING' ? 'animate-spin' : undefined} aria-hidden />
      {status === 'PARTIALLY_COMPLETED' ? 'Partial' : titleCase(status)}
    </Badge>
  );
}

const STEP_VARIANT: Record<StepStatus, Variant> = {
  PENDING: 'secondary',
  RUNNING: 'info',
  SUCCEEDED: 'success',
  PARTIAL: 'warning',
  FAILED: 'destructive',
  SKIPPED: 'outline',
};

export function StepStatusBadge({ status }: { status: StepStatus }) {
  return <Badge variant={STEP_VARIANT[status]}>{titleCase(status)}</Badge>;
}

const ACCOUNT_VARIANT: Record<AccountStatus, Variant> = {
  PENDING_VERIFICATION: 'warning',
  CONNECTED: 'success',
  ERROR: 'destructive',
};

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const label = status === 'PENDING_VERIFICATION' ? 'Pending verification' : titleCase(status);
  return <Badge variant={ACCOUNT_VARIANT[status]}>{label}</Badge>;
}

const FINDING_VARIANT: Record<FindingStatus, Variant> = {
  OPEN: 'info',
  ACKNOWLEDGED: 'secondary',
  SUPPRESSED: 'outline',
  RESOLVED: 'success',
};

export function FindingStatusBadge({ status }: { status: FindingStatus }) {
  return <Badge variant={FINDING_VARIANT[status]}>{titleCase(status)}</Badge>;
}

const REC_VARIANT: Record<RecommendationStatus, Variant> = {
  OPEN: 'info',
  UNDER_REVIEW: 'warning',
  ACCEPTED: 'success',
  DISMISSED: 'outline',
  RESOLVED: 'secondary',
};

export function RecommendationStatusBadge({ status }: { status: RecommendationStatus }) {
  return <Badge variant={REC_VARIANT[status]}>{titleCase(status)}</Badge>;
}

const REPORT_VARIANT: Record<ReportStatus, Variant> = {
  PENDING: 'secondary',
  GENERATING: 'info',
  READY: 'success',
  FAILED: 'destructive',
};

export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  return (
    <Badge variant={REPORT_VARIANT[status]}>
      {status === 'GENERATING' && <LoaderCircle className="animate-spin" aria-hidden />}
      {titleCase(status)}
    </Badge>
  );
}

export function LevelBadge({
  level,
  kind,
}: {
  level: ConfidenceLevel | RiskLevel;
  kind: 'confidence' | 'risk';
}) {
  const variant: Variant =
    kind === 'confidence'
      ? level === 'HIGH'
        ? 'success'
        : level === 'MEDIUM'
          ? 'secondary'
          : 'outline'
      : level === 'HIGH'
        ? 'destructive'
        : level === 'MEDIUM'
          ? 'warning'
          : 'secondary';
  return (
    <Badge variant={variant}>
      {titleCase(level)} {kind}
    </Badge>
  );
}

export function ResourceTypeBadge({ type }: { type: ResourceType }) {
  return <Badge variant="secondary">{RESOURCE_TYPE_LABELS[type]}</Badge>;
}

export function SyntheticBadge() {
  return (
    <Badge variant="synthetic" title="Synthetic data generated for local development. Not real AWS data.">
      <FlaskConical aria-hidden /> Synthetic data
    </Badge>
  );
}

export function NotAvailable({ children = 'Not available' }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <CircleDashed className="size-3" aria-hidden />
      {children}
    </span>
  );
}
