'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bell, CalendarClock, ScanSearch, UserRound } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PageLoading } from '@/components/common/states';
import { DetectionTab } from '@/components/settings/detection-tab';
import { NotificationsTab } from '@/components/settings/notifications-tab';
import { ProfileTab } from '@/components/settings/profile-tab';
import { SchedulesTab } from '@/components/settings/schedules-tab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePermissions } from '@/lib/permissions';

const TABS = ['schedules', 'notifications', 'detection', 'profile'] as const;
type Tab = (typeof TABS)[number];

function SettingsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { canManage } = usePermissions();
  const requested = params.get('tab');
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : 'schedules';

  return (
    <>
      <PageHeader
        title="Settings"
        description={
          canManage
            ? 'Scan schedules, notifications and detection thresholds for your workspace.'
            : 'You have read-only access to workspace settings. Ask an administrator to make changes.'
        }
      />
      <Tabs value={tab} onValueChange={(v) => router.replace(`${pathname}?tab=${v}`)}>
        <TabsList>
          <TabsTrigger value="schedules">
            <CalendarClock /> Schedules
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell /> Notifications
          </TabsTrigger>
          <TabsTrigger value="detection">
            <ScanSearch /> Detection
          </TabsTrigger>
          <TabsTrigger value="profile">
            <UserRound /> Profile
          </TabsTrigger>
        </TabsList>
        <TabsContent value="schedules">
          <SchedulesTab />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationsTab />
        </TabsContent>
        <TabsContent value="detection">
          <DetectionTab />
        </TabsContent>
        <TabsContent value="profile">
          <ProfileTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

export default function SettingsPage() {
  return (
    <React.Suspense fallback={<PageLoading />}>
      <SettingsInner />
    </React.Suspense>
  );
}
