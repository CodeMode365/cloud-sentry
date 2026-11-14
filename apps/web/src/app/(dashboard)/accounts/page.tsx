'use client';

import Link from 'next/link';
import { Cloud, Plus } from 'lucide-react';
import { RenameAccountDialog } from '@/components/accounts/rename-account-dialog';
import { AccountStatusBadge, SyntheticBadge } from '@/components/common/badges';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { formatDateTime, formatRelative, truncateMiddle } from '@/lib/format';
import { usePermissions } from '@/lib/permissions';
import { useAccounts } from '@/lib/queries';
import type { CloudAccount } from '@cloudsentry/shared-types';

function Health({ account }: { account: CloudAccount }) {
  const v = account.lastVerification;
  if (!v) return <span className="text-xs text-muted-foreground">Never verified</span>;
  const denied = v.permissionChecks.filter((c) => c.status === 'DENIED').length;
  return (
    <div className="space-y-0.5 text-xs">
      <div className={v.success ? 'text-success' : 'text-destructive'}>
        {v.success
          ? denied > 0
            ? `Connected · ${denied} permission${denied === 1 ? '' : 's'} missing`
            : 'Healthy'
          : (v.errorCode ?? 'Failed')}
      </div>
      <div className="text-muted-foreground">Verified {formatRelative(v.verifiedAt)}</div>
    </div>
  );
}

export default function AccountsPage() {
  const accounts = useAccounts();
  const { canManage } = usePermissions();

  return (
    <>
      <PageHeader
        title="Cloud Accounts"
        description="AWS accounts connected through a read-only cross-account IAM role."
        actions={
          canManage && (
            <Button asChild>
              <Link href="/accounts/connect/">
                <Plus /> Connect account
              </Link>
            </Button>
          )
        }
      />
      <Card className="py-0">
        {accounts.isPending ? (
          <TableSkeleton />
        ) : accounts.isError ? (
          <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} className="m-4" />
        ) : accounts.data.length === 0 ? (
          <EmptyState
            className="m-4"
            icon={Cloud}
            title="No accounts connected"
            description="Connect an AWS account to start discovering resources and optimization opportunities."
            action={
              canManage && (
                <Button asChild>
                  <Link href="/accounts/connect/">Connect AWS account</Link>
                </Button>
              )
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>IAM role</TableHead>
                <TableHead>Regions</TableHead>
                <TableHead>Last successful scan</TableHead>
                <TableHead>Connection health</TableHead>
                {canManage && (
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.data.map((a) => (
                <TableRow key={a.accountId}>
                  <TableCell>
                    <Link
                      href={`/accounts/detail/?id=${a.accountId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {a.alias}
                    </Link>
                    <div className="font-mono text-xs text-muted-foreground">{a.accountId}</div>
                    {a.dataSource === 'SYNTHETIC' && <SyntheticBadge />}
                  </TableCell>
                  <TableCell>
                    <AccountStatusBadge status={a.status} />
                  </TableCell>
                  <TableCell>
                    <Tooltip content={a.roleArn}>
                      <span className="font-mono text-xs">{truncateMiddle(a.roleArn, 36)}</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-56 flex-wrap gap-1">
                      {a.regions.slice(0, 3).map((r) => (
                        <Badge key={r} variant="secondary" className="font-mono">
                          {r}
                        </Badge>
                      ))}
                      {a.regions.length > 3 && <Badge variant="outline">+{a.regions.length - 3}</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(a.lastSuccessfulScanAt)}
                  </TableCell>
                  <TableCell>
                    <Health account={a} />
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <RenameAccountDialog account={a} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
