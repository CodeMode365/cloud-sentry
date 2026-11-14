import type {
  FindingRecord,
  NotificationEventType,
  NotificationPreferences,
  PersistOutcome,
  RecommendationRecord,
  ScanExecution,
} from '@cloudsentry/shared-types';
import { NOTIFICATION_EVENT_TYPES, SEVERITY_ORDER } from '@cloudsentry/shared-types';
import { errorMessage, newId } from '@cloudsentry/utilities';
import type { ServiceContext } from '../context';
import type { NotificationGateway } from './notification-gateway';

export function defaultNotificationPreferences(tenantId: string, now: string): NotificationPreferences {
  return {
    tenantId,
    enabled: false,
    emails: [],
    events: Object.fromEntries(NOTIFICATION_EVENT_TYPES.map((t) => [t, true])) as Record<
      NotificationEventType,
      boolean
    >,
    highValueSavingsThreshold: 100,
    minimumFindingSeverity: 'HIGH',
    subscriptions: [],
    updatedAt: now,
    version: 0,
  };
}

interface PendingMessage {
  type: NotificationEventType;
  dedupeKey: string;
  subject: string;
  message: string;
}

export interface NotifyResult {
  sent: number;
  suppressed: number;
  failed: number;
}

/**
 * Sends scan-related notifications. Alerts are deduplicated with conditional "dedupe key" writes, so an
 * unchanged finding never alerts twice and a retried workflow step never re-sends.
 */
export class NotificationService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly gateway: NotificationGateway,
    private readonly dashboardUrl?: string,
  ) {}

  async notifyScan(
    scan: ScanExecution,
    outcome: PersistOutcome | null,
    failed: boolean,
  ): Promise<NotifyResult> {
    const { repos } = this.ctx;
    const prefs =
      (await repos.settings.getNotificationPreferences(scan.tenantId)) ??
      defaultNotificationPreferences(scan.tenantId, this.ctx.clock.now().toISOString());
    const result: NotifyResult = { sent: 0, suppressed: 0, failed: 0 };
    if (!prefs.enabled || prefs.emails.length === 0) return result;

    const messages: PendingMessage[] = [];
    const link = (path: string) => (this.dashboardUrl ? `${this.dashboardUrl}${path}` : path);

    if (failed) {
      if (prefs.events.SCAN_FAILED) {
        messages.push({
          type: 'SCAN_FAILED',
          dedupeKey: `scan:${scan.scanId}:failed`,
          subject: `CloudSentry scan failed for account ${scan.accountId}`,
          message: `Scan ${scan.scanId} for AWS account ${scan.accountId} failed.\n\n${scan.errors
            .slice(-3)
            .map((e) => `- ${e.step}: ${e.message}`)
            .join('\n')}\n\nDetails: ${link(`/scans/detail/?id=${scan.scanId}`)}`,
        });
      }
    } else if (outcome) {
      const newIds = [...outcome.newFindingIds, ...outcome.reopenedFindingIds];
      const findings = newIds.length ? await repos.findings.getMany(scan.tenantId, newIds) : [];
      const severe = findings.filter(
        (f) => SEVERITY_ORDER[f.severity] >= SEVERITY_ORDER[prefs.minimumFindingSeverity],
      );
      if (prefs.events.CRITICAL_FINDING) {
        for (const f of severe) messages.push(this.findingMessage(f, link));
      }
      const recIds = [...outcome.newRecommendationIds, ...outcome.reopenedRecommendationIds];
      const recs = recIds.length ? await repos.recommendations.getMany(scan.tenantId, recIds) : [];
      if (prefs.events.HIGH_VALUE_SAVINGS) {
        for (const r of recs.filter(
          (x) => (x.estimatedMonthlySavings ?? 0) >= prefs.highValueSavingsThreshold,
        )) {
          messages.push(this.savingsMessage(r, link));
        }
      }
      const summaryType: NotificationEventType =
        scan.trigger === 'SCHEDULED' ? 'SCHEDULED_SCAN_SUMMARY' : 'SCAN_COMPLETED';
      if (prefs.events[summaryType]) {
        messages.push({
          type: summaryType,
          dedupeKey: `scan:${scan.scanId}:summary`,
          subject: `CloudSentry scan ${scan.status === 'PARTIALLY_COMPLETED' ? 'partially completed' : 'completed'} for ${scan.accountId}`,
          message: [
            `Account: ${scan.accountId}`,
            `Resources discovered: ${outcome.resourcesUpserted}`,
            `New findings: ${outcome.newFindingIds.length} (reopened: ${outcome.reopenedFindingIds.length}, resolved: ${outcome.resolvedFindingIds.length})`,
            `Open recommendations: ${outcome.openRecommendations}`,
            `Estimated potential monthly savings: USD ${outcome.potentialMonthlySavings.toFixed(2)} (estimate, not guaranteed)`,
            '',
            `Details: ${link(`/scans/detail/?id=${scan.scanId}`)}`,
          ].join('\n'),
        });
      }
    }

    for (const m of messages) {
      const claimed = await repos.notifications.claimDedupeKey(scan.tenantId, m.dedupeKey, 90);
      if (!claimed) {
        result.suppressed++;
        continue;
      }
      const base = {
        notificationId: newId.notification(),
        tenantId: scan.tenantId,
        type: m.type,
        subject: m.subject,
        dedupeKey: m.dedupeKey,
        scanId: scan.scanId,
        accountId: scan.accountId,
        channel: 'SNS' as const,
        createdAt: this.ctx.clock.now().toISOString(),
      };
      try {
        const { messageId } = await this.gateway.publish({
          tenantId: scan.tenantId,
          eventType: m.type,
          subject: m.subject,
          message: m.message,
        });
        await repos.notifications.record({ ...base, status: 'SENT', messageId, error: null });
        result.sent++;
      } catch (error) {
        result.failed++;
        // Release the key so a later scan can retry delivering this alert.
        await repos.notifications.releaseDedupeKey(scan.tenantId, m.dedupeKey);
        await repos.notifications.record({
          ...base,
          status: 'FAILED',
          messageId: null,
          error: errorMessage(error).slice(0, 500),
        });
        this.ctx.logger.error('Notification delivery failed', { error, type: m.type, scanId: scan.scanId });
      }
    }
    return result;
  }

  private findingMessage(f: FindingRecord, link: (p: string) => string): PendingMessage {
    return {
      type: 'CRITICAL_FINDING',
      dedupeKey: `finding:${f.findingId}:${f.reopenCount}`,
      subject: `CloudSentry ${f.severity} finding: ${f.title}`.slice(0, 99),
      message: [
        `${f.title}`,
        `Resource: ${f.resourceId} (${f.resourceType}) in ${f.region}, account ${f.accountId}`,
        `Severity: ${f.severity}, confidence: ${f.confidence}`,
        f.estimatedMonthlySavings !== null
          ? `Estimated monthly savings: USD ${f.estimatedMonthlySavings.toFixed(2)} (estimate)`
          : '',
        '',
        `Details: ${link(`/findings/detail/?id=${f.findingId}`)}`,
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  private savingsMessage(r: RecommendationRecord, link: (p: string) => string): PendingMessage {
    return {
      type: 'HIGH_VALUE_SAVINGS',
      dedupeKey: `recommendation:${r.recommendationId}:${r.createdAt}:${r.statusHistory.length}`,
      subject: `CloudSentry savings opportunity: USD ${(r.estimatedMonthlySavings ?? 0).toFixed(0)}/month`,
      message: [
        r.title,
        r.suggestedAction.summary,
        `Estimated monthly savings: USD ${(r.estimatedMonthlySavings ?? 0).toFixed(2)} (${r.savings.estimateType === 'UPPER_BOUND' ? 'upper bound, ' : ''}estimate, not guaranteed)`,
        `Confidence: ${r.confidence}, risk: ${r.riskLevel}`,
        '',
        `Details: ${link(`/recommendations/detail/?id=${r.recommendationId}`)}`,
      ].join('\n'),
    };
  }
}
