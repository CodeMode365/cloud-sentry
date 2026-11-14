'use client';

import * as React from 'react';
import { CalendarClock, LoaderCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { SCHEDULE_FREQUENCIES, type ScanSchedule, type ScheduleFrequency } from '@cloudsentry/shared-types';
import { createScheduleRequestSchema, updateScheduleRequestSchema } from '@cloudsentry/validators';
import { useAccountAlias } from '@/components/common/filters';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, titleCase } from '@/lib/format';
import { DAY_OF_WEEK_LABELS, FREQUENCY_LABELS } from '@/lib/labels';
import { usePermissions } from '@/lib/permissions';
import {
  useAccounts,
  useCreateSchedule,
  useDeleteSchedule,
  useSchedules,
  useUpdateSchedule,
} from '@/lib/queries';

interface FormState {
  accountId: string;
  frequency: ScheduleFrequency;
  hour: number;
  minute: number;
  dayOfWeek: number;
  timezone: string;
  cronExpression: string;
  enabled: boolean;
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function timezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf ? ['UTC', ...intl.supportedValuesOf('timeZone')] : ['UTC'];
  } catch {
    return ['UTC'];
  }
}

/** Parses hour/minute/day back out of the stored expression where possible (for editing presets). */
function formFromSchedule(s: ScanSchedule): FormState {
  const m = /^cron\((\d+) (\d+) \S+ \S+ (\S+) \S+\)$/.exec(s.expression);
  const dow = m?.[3] && /^\d$/.test(m[3]) ? Number(m[3]) : 2;
  return {
    accountId: s.accountId,
    frequency: s.frequency,
    minute: m ? Number(m[1]) : 0,
    hour: m ? Number(m[2]) : 2,
    dayOfWeek: dow,
    timezone: s.timezone,
    cronExpression: s.frequency === 'CUSTOM' ? s.expression : '',
    enabled: s.enabled,
  };
}

function ScheduleDialog({
  open,
  onOpenChange,
  editing,
  availableAccounts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: ScanSchedule | null;
  availableAccounts: { accountId: string; alias: string }[];
}) {
  const create = useCreateSchedule();
  const update = useUpdateSchedule();
  const tzList = React.useMemo(timezones, []);
  const [form, setForm] = React.useState<FormState>(() => ({
    accountId: '',
    frequency: 'DAILY',
    hour: 2,
    minute: 0,
    dayOfWeek: 2,
    timezone: browserTimezone(),
    cronExpression: '',
    enabled: true,
  }));
  const [error, setError] = React.useState<string | null>(null);
  const availableRef = React.useRef(availableAccounts);
  availableRef.current = availableAccounts;

  // Reset the form only when the dialog opens (not on every parent re-render).
  React.useEffect(() => {
    if (!open) return;
    setError(null);
    if (editing) setForm(formFromSchedule(editing));
    else
      setForm((f) => ({
        ...f,
        accountId: availableRef.current[0]?.accountId ?? '',
        frequency: 'DAILY',
        cronExpression: '',
        enabled: true,
      }));
  }, [open, editing]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const pending = create.isPending || update.isPending;

  const submit = async () => {
    setError(null);
    const common = {
      frequency: form.frequency,
      hour: form.hour,
      minute: form.minute,
      dayOfWeek: form.dayOfWeek,
      timezone: form.timezone,
      enabled: form.enabled,
      ...(form.frequency === 'CUSTOM' ? { cronExpression: form.cronExpression } : {}),
    };
    if (editing) {
      const parsed = updateScheduleRequestSchema.safeParse(common);
      if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Invalid schedule');
      await update.mutateAsync({ scheduleId: editing.scheduleId, ...parsed.data });
      toast.success('Schedule updated');
    } else {
      const parsed = createScheduleRequestSchema.safeParse({ ...common, accountId: form.accountId });
      if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Invalid schedule');
      await create.mutateAsync(parsed.data);
      toast.success('Schedule created');
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit schedule' : 'Create schedule'}</DialogTitle>
          <DialogDescription>
            Scheduled scans run through EventBridge Scheduler using the same workflow as manual scans.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {!editing && (
            <div className="grid gap-1.5">
              <Label htmlFor="sch-account">Account</Label>
              <Select value={form.accountId} onValueChange={(v) => set('accountId', v)}>
                <SelectTrigger id="sch-account">
                  <SelectValue placeholder="Select an account" />
                </SelectTrigger>
                <SelectContent>
                  {availableAccounts.map((a) => (
                    <SelectItem key={a.accountId} value={a.accountId}>
                      {a.alias} ({a.accountId})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Each account can have one schedule.</p>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="sch-frequency">Frequency</Label>
            <Select value={form.frequency} onValueChange={(v) => set('frequency', v as ScheduleFrequency)}>
              <SelectTrigger id="sch-frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCHEDULE_FREQUENCIES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {FREQUENCY_LABELS[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(form.frequency === 'DAILY' || form.frequency === 'WEEKLY') && (
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="sch-hour">Hour (0–23)</Label>
                <Input
                  id="sch-hour"
                  type="number"
                  min={0}
                  max={23}
                  value={form.hour}
                  onChange={(e) => set('hour', Number(e.target.value))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sch-minute">Minute (0–59)</Label>
                <Input
                  id="sch-minute"
                  type="number"
                  min={0}
                  max={59}
                  value={form.minute}
                  onChange={(e) => set('minute', Number(e.target.value))}
                />
              </div>
            </div>
          )}
          {form.frequency === 'EVERY_6_HOURS' && (
            <div className="grid gap-1.5">
              <Label htmlFor="sch-minute6">Minute past the hour (0–59)</Label>
              <Input
                id="sch-minute6"
                type="number"
                min={0}
                max={59}
                value={form.minute}
                onChange={(e) => set('minute', Number(e.target.value))}
              />
            </div>
          )}
          {form.frequency === 'WEEKLY' && (
            <div className="grid gap-1.5">
              <Label htmlFor="sch-dow">Day of week</Label>
              <Select value={String(form.dayOfWeek)} onValueChange={(v) => set('dayOfWeek', Number(v))}>
                <SelectTrigger id="sch-dow">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DAY_OF_WEEK_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {form.frequency === 'CUSTOM' && (
            <div className="grid gap-1.5">
              <Label htmlFor="sch-cron">EventBridge cron expression</Label>
              <Input
                id="sch-cron"
                className="font-mono"
                placeholder="cron(0 3 ? * MON-FRI *)"
                value={form.cronExpression}
                onChange={(e) => set('cronExpression', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Six fields: minutes hours day-of-month month day-of-week year. One of day-of-month/day-of-week
                must be “?”.
              </p>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="sch-tz">Timezone</Label>
            <Input
              id="sch-tz"
              list="sch-tz-list"
              value={form.timezone}
              onChange={(e) => set('timezone', e.target.value)}
            />
            <datalist id="sch-tz-list">
              {tzList.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} />
            Enabled
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || (!editing && !form.accountId)}>
            {pending && <LoaderCircle className="animate-spin" />}
            {editing ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SchedulesTab() {
  const schedules = useSchedules();
  const accounts = useAccounts();
  const update = useUpdateSchedule();
  const del = useDeleteSchedule();
  const alias = useAccountAlias();
  const { canManage } = usePermissions();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ScanSchedule | null>(null);

  const scheduled = new Set((schedules.data ?? []).map((s) => s.accountId));
  const available = (accounts.data ?? []).filter((a) => !scheduled.has(a.accountId));

  return (
    <Card className="py-0 pt-5">
      <CardHeader>
        <CardTitle>Scan schedules</CardTitle>
        <CardDescription>
          Automatic scans per account. Times are evaluated in the schedule&apos;s timezone.
        </CardDescription>
        {canManage && (
          <CardAction>
            <Button
              size="sm"
              disabled={available.length === 0}
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus /> New schedule
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="px-0">
        {schedules.isPending ? (
          <TableSkeleton rows={3} />
        ) : schedules.isError ? (
          <ErrorState error={schedules.error} onRetry={() => void schedules.refetch()} className="m-4" />
        ) : schedules.data.length === 0 ? (
          <EmptyState
            className="m-4"
            icon={CalendarClock}
            title="No schedules"
            description="Create a schedule to scan accounts automatically."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead>Expression</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Next run</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>Enabled</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.data.map((s) => (
                <TableRow key={s.scheduleId}>
                  <TableCell>
                    <div>{alias(s.accountId)}</div>
                    <div className="font-mono text-xs text-muted-foreground">{s.accountId}</div>
                  </TableCell>
                  <TableCell>{FREQUENCY_LABELS[s.frequency]}</TableCell>
                  <TableCell>
                    <code className="text-xs">{s.expression}</code>
                    <div className="text-xs text-muted-foreground">{s.timezone}</div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        s.status === 'ACTIVE' ? 'success' : s.status === 'ERROR' ? 'destructive' : 'outline'
                      }
                    >
                      {titleCase(s.status)}
                    </Badge>
                    {s.lastError && (
                      <div className="mt-1 max-w-48 text-xs text-destructive">{s.lastError}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {s.enabled ? formatDateTime(s.nextExecutionAt) : '—'}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {formatDateTime(s.lastExecutionAt)}
                    {s.lastExecutionStatus && (
                      <div className="text-muted-foreground">{titleCase(s.lastExecutionStatus)}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={s.enabled}
                      disabled={!canManage || update.isPending}
                      aria-label={`${s.enabled ? 'Disable' : 'Enable'} schedule for ${alias(s.accountId)}`}
                      onCheckedChange={(enabled) =>
                        void update
                          .mutateAsync({ scheduleId: s.scheduleId, enabled })
                          .then(() => toast.success(enabled ? 'Schedule enabled' : 'Schedule disabled'))
                      }
                    />
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Edit schedule"
                          onClick={() => {
                            setEditing(s);
                            setOpen(true);
                          }}
                        >
                          <Pencil />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Delete schedule"
                              className="text-destructive"
                            >
                              <Trash2 />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete schedule?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Scheduled scans for {alias(s.accountId)} will stop. Manual scans remain
                                available.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                destructive
                                onClick={() =>
                                  void del
                                    .mutateAsync(s.scheduleId)
                                    .then(() => toast.success('Schedule deleted'))
                                }
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <ScheduleDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        availableAccounts={available.map((a) => ({ accountId: a.accountId, alias: a.alias }))}
      />
    </Card>
  );
}
