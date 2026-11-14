'use client';

import * as React from 'react';
import { LoaderCircle, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  NOTIFICATION_EVENT_TYPES,
  SEVERITIES,
  type NotificationEventType,
  type NotificationPreferences,
  type Severity,
} from '@cloudsentry/shared-types';
import {
  emailSchema,
  notificationPreferencesRequestSchema,
  type NotificationPreferencesRequest,
} from '@cloudsentry/validators';
import { ErrorState, PageLoading } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { titleCase } from '@/lib/format';
import { EVENT_LABELS } from '@/lib/labels';
import { usePermissions } from '@/lib/permissions';
import { useNotificationSettings, useUpdateNotificationSettings } from '@/lib/queries';

function toRequest(p: NotificationPreferences | null): NotificationPreferencesRequest {
  const defaults = Object.fromEntries(NOTIFICATION_EVENT_TYPES.map((t) => [t, true])) as Record<
    NotificationEventType,
    boolean
  >;
  return {
    enabled: p?.enabled ?? false,
    emails: p?.emails ?? [],
    events: { ...defaults, ...(p?.events ?? {}) },
    highValueSavingsThreshold: p?.highValueSavingsThreshold ?? 100,
    minimumFindingSeverity: p?.minimumFindingSeverity ?? 'HIGH',
  };
}

function NotificationsForm({ prefs }: { prefs: NotificationPreferences | null }) {
  const { canManage } = usePermissions();
  const save = useUpdateNotificationSettings();
  const [form, setForm] = React.useState<NotificationPreferencesRequest>(() => toRequest(prefs));
  const [emailInput, setEmailInput] = React.useState('');
  const [emailError, setEmailError] = React.useState<string | null>(null);

  const addEmail = () => {
    const parsed = emailSchema.safeParse(emailInput);
    if (!parsed.success) return setEmailError('Enter a valid email address');
    if (form.emails.includes(parsed.data)) return setEmailError('Already added');
    if (form.emails.length >= 10) return setEmailError('Up to 10 recipients');
    setForm((f) => ({ ...f, emails: [...f.emails, parsed.data] }));
    setEmailInput('');
    setEmailError(null);
  };

  const submit = async () => {
    const parsed = notificationPreferencesRequestSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Invalid preferences');
      return;
    }
    await save.mutateAsync(parsed.data);
    toast.success('Notification preferences saved');
  };

  const subs = prefs?.subscriptions ?? [];
  const disabled = !canManage;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Alerts are delivered by Amazon SNS email. Recipients must confirm the subscription email from AWS.
          Unchanged findings never trigger repeat alerts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <label className="flex items-center gap-3 text-sm font-medium">
          <Switch
            checked={form.enabled}
            disabled={disabled}
            onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
          />
          Send notifications
        </label>

        <div className="space-y-2">
          <Label htmlFor="notify-email">Recipients</Label>
          <div className="flex gap-2">
            <Input
              id="notify-email"
              type="email"
              value={emailInput}
              disabled={disabled}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addEmail();
                }
              }}
              placeholder="finops@example.com"
              aria-invalid={emailError ? true : undefined}
            />
            <Button variant="outline" onClick={addEmail} disabled={disabled}>
              Add
            </Button>
          </div>
          {emailError && <p className="text-xs text-destructive">{emailError}</p>}
          <ul className="flex flex-wrap gap-2">
            {form.emails.map((email) => {
              const sub = subs.find((s) => s.email === email);
              return (
                <li key={email}>
                  <Badge variant="secondary" className="gap-2 py-1">
                    {email}
                    <span className="text-[10px] text-muted-foreground uppercase">
                      {sub
                        ? sub.status === 'PENDING'
                          ? 'pending confirmation'
                          : sub.status.toLowerCase()
                        : 'not saved'}
                    </span>
                    {!disabled && (
                      <button
                        type="button"
                        aria-label={`Remove ${email}`}
                        onClick={() =>
                          setForm((f) => ({ ...f, emails: f.emails.filter((e) => e !== email) }))
                        }
                      >
                        <X />
                      </button>
                    )}
                  </Badge>
                </li>
              );
            })}
            {form.emails.length === 0 && <li className="text-sm text-muted-foreground">No recipients.</li>}
          </ul>
        </div>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-medium">Events</legend>
          {NOTIFICATION_EVENT_TYPES.map((t) => (
            <label key={t} className="flex items-start gap-3">
              <Switch
                className="mt-0.5"
                checked={form.events[t]}
                disabled={disabled}
                onCheckedChange={(v) => setForm((f) => ({ ...f, events: { ...f.events, [t]: v } }))}
              />
              <span>
                <span className="block text-sm">{EVENT_LABELS[t].title}</span>
                <span className="block text-xs text-muted-foreground">{EVENT_LABELS[t].description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="notify-threshold">High-value savings threshold (USD / month, estimated)</Label>
            <Input
              id="notify-threshold"
              type="number"
              min={0}
              disabled={disabled}
              value={form.highValueSavingsThreshold}
              onChange={(e) => setForm((f) => ({ ...f, highValueSavingsThreshold: Number(e.target.value) }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="notify-severity">Minimum finding severity</Label>
            <Select
              value={form.minimumFindingSeverity}
              disabled={disabled}
              onValueChange={(v) => setForm((f) => ({ ...f, minimumFindingSeverity: v as Severity }))}
            >
              <SelectTrigger id="notify-severity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {titleCase(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
      {canManage && (
        <CardFooter className="justify-end">
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? <LoaderCircle className="animate-spin" /> : <Save />} Save preferences
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

export function NotificationsTab() {
  const q = useNotificationSettings();
  if (q.isPending) return <PageLoading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <NotificationsForm key={q.data?.version ?? 0} prefs={q.data} />;
}
