import type {
  AuthContext,
  DetectionSettings,
  NotificationEventType,
  NotificationPreferences,
  RuleDefinitionSummary,
} from '@cloudsentry/shared-types';
import {
  DEFAULT_IGNORE_TAG_KEY,
  DEFAULT_LOOKBACK_DAYS,
  NOTIFICATION_EVENT_TYPES,
} from '@cloudsentry/shared-types';
import type { DetectionSettingsRequest, NotificationPreferencesRequest } from '@cloudsentry/validators';
import { ValidationError } from '@cloudsentry/utilities';
import { requireRole } from '../auth/authorization';
import type { ServiceContext } from '../context';
import type { NotificationGateway } from '../notifications/notification-gateway';
import { defaultNotificationPreferences } from '../notifications/notification-service';

export function defaultDetectionSettings(
  tenantId: string,
  catalog: RuleDefinitionSummary[],
  now: string,
): DetectionSettings {
  return {
    tenantId,
    lookbackDays: DEFAULT_LOOKBACK_DAYS,
    ignoreTagKey: DEFAULT_IGNORE_TAG_KEY,
    rules: Object.fromEntries(
      catalog.map((r) => [r.ruleId, { enabled: true, thresholds: { ...r.defaultThresholds } }]),
    ),
    updatedAt: now,
    version: 0,
  };
}

export class SettingsService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly ruleCatalog: RuleDefinitionSummary[],
    private readonly notifications: NotificationGateway,
  ) {}

  rules(): RuleDefinitionSummary[] {
    return this.ruleCatalog;
  }

  async getDetection(auth: AuthContext): Promise<DetectionSettings> {
    const now = this.ctx.clock.now().toISOString();
    const stored = await this.ctx.repos.settings.getDetectionSettings(auth.tenantId);
    const defaults = defaultDetectionSettings(auth.tenantId, this.ruleCatalog, now);
    if (!stored) return defaults;
    // Merge so newly added rules/thresholds appear with their defaults.
    const rules = { ...defaults.rules };
    for (const [id, r] of Object.entries(stored.rules)) {
      const base = rules[id];
      if (base) rules[id] = { enabled: r.enabled, thresholds: { ...base.thresholds, ...r.thresholds } };
    }
    return { ...stored, rules };
  }

  async putDetection(auth: AuthContext, input: DetectionSettingsRequest): Promise<DetectionSettings> {
    requireRole(auth, 'ADMIN');
    const catalog = new Map(this.ruleCatalog.map((r) => [r.ruleId, r]));
    for (const [ruleId, r] of Object.entries(input.rules)) {
      const def = catalog.get(ruleId);
      if (!def) throw new ValidationError(`Unknown rule '${ruleId}'`);
      for (const [key, value] of Object.entries(r.thresholds)) {
        if (!(key in def.defaultThresholds))
          throw new ValidationError(`Unknown threshold '${key}' for rule '${ruleId}'`);
        if (value < 0) throw new ValidationError(`Threshold '${key}' for rule '${ruleId}' must be >= 0`);
      }
    }
    const existing = await this.ctx.repos.settings.getDetectionSettings(auth.tenantId);
    const settings: DetectionSettings = {
      tenantId: auth.tenantId,
      lookbackDays: input.lookbackDays,
      ignoreTagKey: input.ignoreTagKey,
      rules: input.rules,
      updatedAt: this.ctx.clock.now().toISOString(),
      version: (existing?.version ?? 0) + 1,
    };
    await this.ctx.repos.settings.putDetectionSettings(settings, existing ? existing.version : null);
    this.ctx.logger.audit('settings.detection_updated', { tenantId: auth.tenantId, userId: auth.userId });
    return this.getDetection(auth);
  }

  async getNotifications(auth: AuthContext): Promise<NotificationPreferences> {
    const prefs =
      (await this.ctx.repos.settings.getNotificationPreferences(auth.tenantId)) ??
      defaultNotificationPreferences(auth.tenantId, this.ctx.clock.now().toISOString());
    const subscriptions = await Promise.all(
      prefs.subscriptions.map(async (s) =>
        s.status === 'PENDING' && s.subscriptionArn
          ? {
              ...s,
              status: (await this.notifications.isConfirmed(s.subscriptionArn))
                ? ('CONFIRMED' as const)
                : s.status,
            }
          : s,
      ),
    );
    return { ...prefs, subscriptions };
  }

  async putNotifications(
    auth: AuthContext,
    input: NotificationPreferencesRequest,
  ): Promise<NotificationPreferences> {
    requireRole(auth, 'ADMIN');
    const existing = await this.ctx.repos.settings.getNotificationPreferences(auth.tenantId);
    const prior = existing?.subscriptions ?? [];
    const emails = [...new Set(input.emails)];
    const eventTypes = NOTIFICATION_EVENT_TYPES.filter((t) => input.events[t]) as NotificationEventType[];
    const subscriptions: NotificationPreferences['subscriptions'] = [];
    // Unsubscribe removed emails.
    for (const s of prior.filter((p) => !emails.includes(p.email))) {
      if (s.subscriptionArn) await this.notifications.unsubscribe(s.subscriptionArn).catch(() => undefined);
    }
    for (const email of emails) {
      const current = prior.find((p) => p.email === email);
      try {
        if (current?.subscriptionArn)
          await this.notifications.unsubscribe(current.subscriptionArn).catch(() => undefined);
        const arn = input.enabled
          ? await this.notifications.subscribeEmail(auth.tenantId, email, eventTypes)
          : null;
        const confirmed = arn ? await this.notifications.isConfirmed(arn) : false;
        subscriptions.push({
          email,
          subscriptionArn: arn,
          status: arn ? (confirmed ? 'CONFIRMED' : 'PENDING') : 'ERROR',
        });
      } catch (error) {
        this.ctx.logger.error('Email subscription failed', { error });
        subscriptions.push({ email, subscriptionArn: null, status: 'ERROR' });
      }
    }
    const prefs: NotificationPreferences = {
      tenantId: auth.tenantId,
      enabled: input.enabled,
      emails,
      events: input.events,
      highValueSavingsThreshold: input.highValueSavingsThreshold,
      minimumFindingSeverity: input.minimumFindingSeverity,
      subscriptions,
      updatedAt: this.ctx.clock.now().toISOString(),
      version: (existing?.version ?? 0) + 1,
    };
    await this.ctx.repos.settings.putNotificationPreferences(prefs, existing ? existing.version : null);
    this.ctx.logger.audit('settings.notifications_updated', {
      tenantId: auth.tenantId,
      userId: auth.userId,
      emails: emails.length,
    });
    return prefs;
  }
}
