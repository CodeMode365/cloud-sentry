'use client';

import { ShieldCheck } from 'lucide-react';
import { KeyValue } from '@/components/common/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSession } from '@/lib/auth-store';
import { formatDateTime, titleCase } from '@/lib/format';

const ROLE_DESCRIPTIONS = {
  OWNER: 'Full access, including account, schedule and settings management.',
  ADMIN: 'Manage accounts, schedules and settings; operate scans and recommendations.',
  MEMBER: 'Run scans, update findings and recommendations, generate reports.',
  VIEWER: 'Read-only access.',
} as const;

export function ProfileTab() {
  const user = useSession((s) => s.user);
  const tenant = useSession((s) => s.tenant);
  if (!user || !tenant) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Your profile</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <KeyValue label="Name">{user.name}</KeyValue>
            <KeyValue label="Email">{user.email}</KeyValue>
            <KeyValue label="Role">
              {titleCase(user.role)}
              <div className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[user.role]}</div>
            </KeyValue>
            <KeyValue label="Last sign-in">{formatDateTime(user.lastLoginAt)}</KeyValue>
            <KeyValue label="User ID" className="sm:col-span-2">
              <code className="text-xs">{user.userId}</code>
            </KeyValue>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-4 sm:grid-cols-2">
            <KeyValue label="Organization">{tenant.name}</KeyValue>
            <KeyValue label="Created">{formatDateTime(tenant.createdAt)}</KeyValue>
            <KeyValue label="Workspace ID" className="sm:col-span-2">
              <code className="text-xs">{tenant.tenantId}</code>
            </KeyValue>
          </dl>
          <Alert variant="info">
            <ShieldCheck />
            <AlertTitle>Read-only platform</AlertTitle>
            <AlertDescription>
              CloudSentry only reads from your AWS accounts through temporary STS credentials. It never stores
              access keys and cannot modify or delete resources.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
