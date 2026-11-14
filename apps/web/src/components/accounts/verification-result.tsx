import { CircleCheck, CircleDashed, CircleX, TriangleAlert } from 'lucide-react';
import type { AccountVerificationResult, PermissionCheckResult } from '@cloudsentry/shared-types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatDateTime } from '@/lib/format';

function CheckIcon({ status }: { status: PermissionCheckResult['status'] }) {
  switch (status) {
    case 'ALLOWED':
      return <CircleCheck className="size-4 text-success" aria-label="Allowed" />;
    case 'DENIED':
      return <CircleX className="size-4 text-destructive" aria-label="Denied" />;
    case 'ERROR':
      return (
        <TriangleAlert className="size-4 text-warning-foreground dark:text-warning" aria-label="Error" />
      );
    default:
      return <CircleDashed className="size-4 text-muted-foreground" aria-label="Not checked" />;
  }
}

/** Permissions added when Lambda, EKS, ElastiCache, CloudFront, EFS, DynamoDB, Redshift and AWS Backup scanning shipped. */
const EXTENDED_SERVICE_PROBES = new Set([
  'lambda:ListFunctions',
  'eks:ListClusters',
  'elasticache:DescribeCacheClusters',
  'cloudfront:ListDistributions',
  'elasticfilesystem:DescribeFileSystems',
  'dynamodb:ListTables',
  'redshift:DescribeClusters',
  'backup:ListBackupPlans',
  'tag:GetResources',
]);

export function VerificationResultView({ result }: { result: AccountVerificationResult }) {
  const deniedExtended = result.permissionChecks.filter(
    (c) => c.status === 'DENIED' && EXTENDED_SERVICE_PROBES.has(c.action),
  );
  return (
    <div className="space-y-4">
      {result.success ? (
        <Alert variant="success">
          <CircleCheck />
          <AlertTitle>Connection verified</AlertTitle>
          <AlertDescription>
            CloudSentry assumed the role in account {result.callerAccountId} at{' '}
            {formatDateTime(result.verifiedAt)}.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <CircleX />
          <AlertTitle>Verification failed{result.errorCode ? ` (${result.errorCode})` : ''}</AlertTitle>
          <AlertDescription className="text-destructive/90">
            {result.errorMessage ?? 'CloudSentry could not verify this account.'}
          </AlertDescription>
        </Alert>
      )}
      {result.success && deniedExtended.length > 0 && (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>Role template is out of date</AlertTitle>
          <AlertDescription>
            {deniedExtended.length} permission{deniedExtended.length === 1 ? ' is' : 's are'} missing, so some
            services (Lambda, EKS, ElastiCache, CloudFront, EFS, DynamoDB, Redshift, AWS Backup) will be
            reported as failed in scans. Update the CloudFormation stack with the current template from
            Continue setup / onboarding, then verify again.
          </AlertDescription>
        </Alert>
      )}
      {result.permissionChecks.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium">Permission checks</h4>
          <ul className="divide-y rounded-md border">
            {result.permissionChecks.map((check) => (
              <li key={check.action} className="flex items-start gap-3 px-3 py-2">
                <CheckIcon status={check.status} />
                <div className="min-w-0">
                  <div className="font-mono text-xs">{check.action}</div>
                  {check.message && <div className="text-xs text-muted-foreground">{check.message}</div>}
                </div>
                <span className="ml-auto text-xs text-muted-foreground">
                  {check.status.replace('_', ' ').toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.enabledRegions.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Enabled regions reported by AWS:{' '}
          <span className="font-mono">{result.enabledRegions.join(', ')}</span>
        </p>
      )}
    </div>
  );
}
