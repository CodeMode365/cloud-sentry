import {
  PublishCommand,
  SNSClient,
  SubscribeCommand,
  UnsubscribeCommand,
  GetSubscriptionAttributesCommand,
} from '@aws-sdk/client-sns';
import type { NotificationEventType } from '@cloudsentry/shared-types';
import type { Logger } from '@cloudsentry/utilities';

export interface PublishRequest {
  tenantId: string;
  eventType: NotificationEventType;
  subject: string;
  message: string;
}

/** Port over the notification channel (one SNS topic; subscriptions filtered by tenantId attribute). */
export interface NotificationGateway {
  publish(request: PublishRequest): Promise<{ messageId: string | null }>;
  subscribeEmail(
    tenantId: string,
    email: string,
    eventTypes: NotificationEventType[],
  ): Promise<string | null>;
  unsubscribe(subscriptionArn: string): Promise<void>;
  isConfirmed(subscriptionArn: string): Promise<boolean>;
}

export class SnsNotificationGateway implements NotificationGateway {
  constructor(
    private readonly topicArn: string,
    private readonly client = new SNSClient({ region: process.env.AWS_REGION, maxAttempts: 4 }),
  ) {}

  async publish(r: PublishRequest): Promise<{ messageId: string | null }> {
    const out = await this.client.send(
      new PublishCommand({
        TopicArn: this.topicArn,
        Subject: r.subject.replace(/[^\x20-\x7E]/g, '').slice(0, 99),
        Message: r.message,
        MessageAttributes: {
          tenantId: { DataType: 'String', StringValue: r.tenantId },
          eventType: { DataType: 'String', StringValue: r.eventType },
        },
      }),
    );
    return { messageId: out.MessageId ?? null };
  }

  async subscribeEmail(
    tenantId: string,
    email: string,
    eventTypes: NotificationEventType[],
  ): Promise<string | null> {
    const out = await this.client.send(
      new SubscribeCommand({
        TopicArn: this.topicArn,
        Protocol: 'email',
        Endpoint: email,
        ReturnSubscriptionArn: true,
        // Tenant isolation: a subscriber only receives messages published for its own tenant.
        Attributes: { FilterPolicy: JSON.stringify({ tenantId: [tenantId], eventType: eventTypes }) },
      }),
    );
    return out.SubscriptionArn ?? null;
  }

  async unsubscribe(subscriptionArn: string): Promise<void> {
    if (!subscriptionArn.startsWith('arn:')) return;
    await this.client.send(new UnsubscribeCommand({ SubscriptionArn: subscriptionArn }));
  }

  async isConfirmed(subscriptionArn: string): Promise<boolean> {
    if (!subscriptionArn.startsWith('arn:')) return false;
    try {
      const out = await this.client.send(
        new GetSubscriptionAttributesCommand({ SubscriptionArn: subscriptionArn }),
      );
      return out.Attributes?.PendingConfirmation === 'false';
    } catch {
      return false;
    }
  }
}

/** Local development: notifications are written to the log only. */
export class LogNotificationGateway implements NotificationGateway {
  constructor(private readonly logger: Logger) {}
  publish(r: PublishRequest): Promise<{ messageId: string | null }> {
    this.logger.info('LOCAL DEV: notification (not delivered)', { ...r });
    return Promise.resolve({ messageId: null });
  }
  subscribeEmail(): Promise<string | null> {
    return Promise.resolve(null);
  }
  unsubscribe(): Promise<void> {
    return Promise.resolve();
  }
  isConfirmed(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
