'use client';

import * as React from 'react';
import { LoaderCircle, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import {
  DEFAULT_IGNORE_TAG_KEY,
  DEFAULT_LOOKBACK_DAYS,
  type DetectionSettings,
  type RuleDefinitionSummary,
} from '@cloudsentry/shared-types';
import { detectionSettingsRequestSchema, type DetectionSettingsRequest } from '@cloudsentry/validators';
import { ResourceTypeBadge, SeverityBadge } from '@/components/common/badges';
import { EmptyState, ErrorState, PageLoading } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { CATEGORY_LABELS } from '@/lib/labels';
import { usePermissions } from '@/lib/permissions';
import { useDetectionSettings, useRules, useUpdateDetectionSettings } from '@/lib/queries';

function initialForm(
  settings: DetectionSettings | null,
  rules: RuleDefinitionSummary[],
): DetectionSettingsRequest {
  return {
    lookbackDays: settings?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS,
    ignoreTagKey: settings?.ignoreTagKey ?? DEFAULT_IGNORE_TAG_KEY,
    rules: Object.fromEntries(
      rules.map((r) => [
        r.ruleId,
        {
          enabled: settings?.rules[r.ruleId]?.enabled ?? true,
          thresholds: { ...r.defaultThresholds, ...(settings?.rules[r.ruleId]?.thresholds ?? {}) },
        },
      ]),
    ),
  };
}

function DetectionForm({
  settings,
  rules,
}: {
  settings: DetectionSettings | null;
  rules: RuleDefinitionSummary[];
}) {
  const { canManage } = usePermissions();
  const save = useUpdateDetectionSettings();
  const [form, setForm] = React.useState(() => initialForm(settings, rules));
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const disabled = !canManage;

  const setThreshold = (ruleId: string, key: string, raw: string) => {
    setDraft((d) => ({ ...d, [`${ruleId}.${key}`]: raw }));
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(n)) {
      setForm((f) => {
        const rule = f.rules[ruleId] ?? { enabled: true, thresholds: {} };
        return {
          ...f,
          rules: { ...f.rules, [ruleId]: { ...rule, thresholds: { ...rule.thresholds, [key]: n } } },
        };
      });
    }
  };

  const resetRule = (rule: RuleDefinitionSummary) => {
    setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith(`${rule.ruleId}.`))));
    setForm((f) => ({
      ...f,
      rules: {
        ...f.rules,
        [rule.ruleId]: {
          enabled: f.rules[rule.ruleId]?.enabled ?? true,
          thresholds: { ...rule.defaultThresholds },
        },
      },
    }));
  };

  const submit = async () => {
    const invalid = Object.entries(draft).find(([, v]) => v.trim() === '' || !Number.isFinite(Number(v)));
    if (invalid) {
      toast.error(`Threshold ${invalid[0]} must be a number`);
      return;
    }
    const parsed = detectionSettingsRequestSchema.safeParse(form);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      toast.error(issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid settings');
      return;
    }
    await save.mutateAsync(parsed.data);
    setDraft({});
    toast.success('Detection settings saved. They apply from the next scan.');
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Analysis defaults</CardTitle>
          <CardDescription>Applied to every scan in this workspace.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="lookback">Metric lookback (days, 14–90)</Label>
            <Input
              id="lookback"
              type="number"
              min={14}
              max={90}
              disabled={disabled}
              value={form.lookbackDays}
              onChange={(e) => setForm((f) => ({ ...f, lookbackDays: Number(e.target.value) }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ignoreTag">Exclusion tag key</Label>
            <Input
              id="ignoreTag"
              disabled={disabled}
              value={form.ignoreTagKey}
              onChange={(e) => setForm((f) => ({ ...f, ignoreTagKey: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Resources tagged with this key set to “true” are skipped by all rules.
            </p>
          </div>
        </CardContent>
      </Card>

      {rules.map((rule) => {
        const state = form.rules[rule.ruleId] ?? { enabled: true, thresholds: rule.defaultThresholds };
        return (
          <Card key={rule.ruleId}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{rule.name}</CardTitle>
                <ResourceTypeBadge type={rule.resourceType} />
                <Badge variant="outline">{CATEGORY_LABELS[rule.category]}</Badge>
                <SeverityBadge severity={rule.defaultSeverity} />
                <span className="font-mono text-xs text-muted-foreground">
                  {rule.ruleId} v{rule.version}
                </span>
              </div>
              <CardDescription>{rule.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-center gap-3 text-sm">
                <Switch
                  checked={state.enabled}
                  disabled={disabled}
                  onCheckedChange={(enabled) =>
                    setForm((f) => ({ ...f, rules: { ...f.rules, [rule.ruleId]: { ...state, enabled } } }))
                  }
                />
                Rule enabled
              </label>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(rule.defaultThresholds).map(([key, def]) => {
                  const id = `${rule.ruleId}-${key}`;
                  const value = draft[`${rule.ruleId}.${key}`] ?? String(state.thresholds[key] ?? def);
                  return (
                    <div key={key} className="grid gap-1.5">
                      <Label htmlFor={id} className="font-mono text-xs">
                        {key}
                      </Label>
                      <Input
                        id={id}
                        type="number"
                        step="any"
                        disabled={disabled || !state.enabled}
                        value={value}
                        onChange={(e) => setThreshold(rule.ruleId, key, e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        {rule.thresholdDescriptions[key] ?? ''} Default: {def}.
                      </p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
            {canManage && (
              <CardFooter>
                <Button variant="ghost" size="sm" onClick={() => resetRule(rule)}>
                  <RotateCcw /> Reset thresholds to defaults
                </Button>
              </CardFooter>
            )}
          </Card>
        );
      })}
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? <LoaderCircle className="animate-spin" /> : <Save />} Save detection settings
          </Button>
        </div>
      )}
    </div>
  );
}

export function DetectionTab() {
  const settings = useDetectionSettings();
  const rules = useRules();
  if (settings.isPending || rules.isPending) return <PageLoading />;
  if (rules.isError) return <ErrorState error={rules.error} onRetry={() => void rules.refetch()} />;
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  if (rules.data.length === 0) return <EmptyState title="No detection rules available" />;
  return <DetectionForm key={settings.data?.version ?? 0} settings={settings.data} rules={rules.data} />;
}
