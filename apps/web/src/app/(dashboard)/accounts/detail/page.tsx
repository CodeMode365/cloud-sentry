'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, LoaderCircle, Pencil, Play, Save, ShieldCheck, Trash2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { RenameAccountDialog } from '@/components/accounts/rename-account-dialog';
import { VerificationResultView } from '@/components/accounts/verification-result';
import { AccountStatusBadge, SyntheticBadge } from '@/components/common/badges';
import { CopyButton } from '@/components/common/copy-button';
import { PageHeader } from '@/components/common/page-header';
import { RegionMultiSelect } from '@/components/common/region-multi-select';
import { EmptyState, ErrorState, KeyValue, PageLoading, TableSkeleton } from '@/components/common/states';
import { ScanTable } from '@/components/scans/scan-table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatDateTime, titleCase } from '@/lib/format';
import { usePermissions } from '@/lib/permissions';
import {
  useAccount,
  useDeleteAccount,
  useScans,
  useStartScan,
  useUpdateAccount,
  useVerifyAccount,
} from '@/lib/queries';
import type { CloudAccount } from '@cloudsentry/shared-types';

function SettingsCard({ account, canManage }: { account: CloudAccount; canManage: boolean }) {
  const update = useUpdateAccount(account.accountId);
  const [editing, setEditing] = React.useState(false);
  const [alias, setAlias] = React.useState(account.alias);
  const [regions, setRegions] = React.useState(account.regions);
  React.useEffect(() => {
    if (!editing) {
      setAlias(account.alias);
      setRegions(account.regions);
    }
  }, [account, editing]);
  const save = async () => {
    if (regions.length === 0) {
      toast.error('Select at least one region');
      return;
    }
    try {
      await update.mutateAsync({ alias: alias.trim(), regions });
      toast.success('Account updated');
      setEditing(false);
    } catch {
      // The global mutation error handler shows the API error; stay in edit mode so the user can retry.
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Scan configuration</CardTitle>
        <CardDescription>Display name and the regions included in scans.</CardDescription>
        {canManage && !editing && (
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {editing ? (
          <>
            <div className="grid gap-1.5">
              <label htmlFor="alias" className="text-sm font-medium">
                Display name
              </label>
              <Input id="alias" value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={64} />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="regions" className="text-sm font-medium">
                Regions
              </label>
              <RegionMultiSelect id="regions" value={regions} onChange={setRegions} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button onClick={save} disabled={update.isPending || alias.trim() === ''}>
                {update.isPending ? <LoaderCircle className="animate-spin" /> : <Save />} Save
              </Button>
            </div>
          </>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2">
            <KeyValue label="Display name">{account.alias}</KeyValue>
            <KeyValue label="Regions">
              <span className="font-mono text-xs">{account.regions.join(', ')}</span>
            </KeyValue>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function AccountDetail({ accountId }: { accountId: string }) {
  const router = useRouter();
  const account = useAccount(accountId);
  const scans = useScans({ accountId, limit: 5 }, { poll: true });
  const startScan = useStartScan();
  const verify = useVerifyAccount(accountId);
  const del = useDeleteAccount();
  const { canManage, canOperate } = usePermissions();

  if (account.isPending) return <PageLoading />;
  if (account.isError) return <ErrorState error={account.error} onRetry={() => void account.refetch()} />;
  const a = account.data;

  const runScan = async () => {
    const s = await startScan.mutateAsync({ accountId });
    toast.success('Scan started');
    router.push(`/scans/detail/?id=${encodeURIComponent(s.scanId)}`);
  };
  const runVerify = async () => {
    await verify.mutateAsync({});
    toast.message('Verification finished');
  };
  const remove = async () => {
    await del.mutateAsync(accountId);
    toast.success('Account removed');
    router.replace('/accounts/');
  };

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link href="/accounts/">
          <ArrowLeft /> Cloud Accounts
        </Link>
      </Button>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {a.alias}
            {canManage && <RenameAccountDialog account={a} />}
            <AccountStatusBadge status={a.status} />
            {a.dataSource === 'SYNTHETIC' && <SyntheticBadge />}
          </span>
        }
        description={<span className="font-mono">{a.accountId}</span>}
        actions={
          <>
            {a.status === 'PENDING_VERIFICATION' && canManage && (
              <Button variant="outline" asChild>
                <Link href={`/accounts/connect/?id=${a.accountId}`}>
                  <Wrench /> Continue setup
                </Link>
              </Button>
            )}
            {canManage && (
              <Button variant="outline" onClick={runVerify} disabled={verify.isPending}>
                {verify.isPending ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />} Verify
              </Button>
            )}
            {canOperate && (
              <Button onClick={runScan} disabled={startScan.isPending || a.status !== 'CONNECTED'}>
                {startScan.isPending ? <LoaderCircle className="animate-spin" /> : <Play />} Scan now
              </Button>
            )}
            {canManage && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" aria-label="Remove account" className="text-destructive">
                    <Trash2 />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove {a.alias}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      CloudSentry stops scanning this account and deletes its schedule, inventory, findings
                      and recommendations. Scan history is retained. The IAM role in your AWS account is not
                      deleted — remove the CloudFormation stack yourself to revoke access.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction destructive onClick={() => void remove()}>
                      Remove account
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Connection</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <KeyValue label="IAM role ARN" className="sm:col-span-2">
                <span className="flex items-center gap-2">
                  <code className="truncate text-xs">{a.roleArn}</code>
                  <CopyButton value={a.roleArn} iconOnly label="Copy role ARN" />
                </span>
              </KeyValue>
              <KeyValue label="External ID" className="sm:col-span-2">
                <span className="flex items-center gap-2">
                  <code className="truncate text-xs">{a.externalId}</code>
                  <CopyButton value={a.externalId} iconOnly label="Copy external ID" />
                </span>
              </KeyValue>
              <KeyValue label="Connection type">{titleCase(a.connectionType)}</KeyValue>
              <KeyValue label="Data source">
                {a.dataSource === 'SYNTHETIC' ? 'Synthetic (local only)' : 'AWS'}
              </KeyValue>
              <KeyValue label="Last scan">{formatDateTime(a.lastScanAt)}</KeyValue>
              <KeyValue label="Last successful scan">{formatDateTime(a.lastSuccessfulScanAt)}</KeyValue>
              <KeyValue label="Connected">{formatDateTime(a.createdAt)}</KeyValue>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Connection health</CardTitle>
            <CardDescription>Result of the most recent role verification.</CardDescription>
          </CardHeader>
          <CardContent>
            {a.lastVerification ? (
              <VerificationResultView result={a.lastVerification} />
            ) : (
              <EmptyState
                title="Not verified yet"
                description="Verify the connection after creating the IAM role."
              />
            )}
          </CardContent>
        </Card>
        <SettingsCard account={a} canManage={canManage} />
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent scans</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/scans/?accountId=${a.accountId}`}>All scans</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="px-0">
            {scans.isPending ? (
              <TableSkeleton rows={3} />
            ) : scans.isError ? (
              <ErrorState error={scans.error} className="mx-5" />
            ) : scans.data.data.length === 0 ? (
              <div className="px-5">
                <EmptyState title="No scans yet" description="Run a scan once the account is connected." />
              </div>
            ) : (
              <ScanTable scans={scans.data.data} compact />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Inner() {
  const id = useSearchParams().get('id');
  if (!id)
    return (
      <EmptyState title="No account selected" description="Choose an account from the Cloud Accounts page." />
    );
  return <AccountDetail accountId={id} />;
}

export default function AccountDetailPage() {
  return (
    <React.Suspense fallback={<PageLoading />}>
      <Inner />
    </React.Suspense>
  );
}
