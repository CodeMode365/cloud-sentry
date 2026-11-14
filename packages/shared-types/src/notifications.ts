import type { NotificationEventType, Severity } from './enums';

export interface NotificationPreferences {
  tenantId: string;
  enabled: boolean;
  /** Email endpoints subscribed to the tenant-filtered SNS topic. */
  emails: string[];
  events: Record<NotificationEventType, boolean>;
  /** Minimum estimated monthly savings (USD) for HIGH_VALUE_SAVINGS alerts. */
  highValueSavingsThreshold: number;
  /** Minimum severity for new-finding alerts. */
  minimumFindingSeverity: Severity;
  /** SNS subscription ARNs per email (pending confirmation shows as "pending confirmation"). */
  subscriptions: {
    email: string;
    subscriptionArn: string | null;
    status: 'PENDING' | 'CONFIRMED' | 'ERROR';
  }[];
  updatedAt: string;
  version: number;
}

export interface NotificationRecord {
  notificationId: string;
  tenantId: string;
  type: NotificationEventType;
  subject: string;
  /** Used to suppress duplicate alerts for unchanged findings. */
  dedupeKey: string;
  scanId: string | null;
  accountId: string | null;
  status: 'SENT' | 'FAILED' | 'SUPPRESSED';
  channel: 'SNS';
  messageId: string | null;
  error: string | null;
  createdAt: string;
}
