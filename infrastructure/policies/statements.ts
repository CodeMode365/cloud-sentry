import { ArnFormat, Stack } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

/**
 * Customer roles must be named CloudSentry* (enforced by API validation), so the platform can scope
 * sts:AssumeRole to exactly those roles in any account. Nothing else is granted on customer accounts:
 * all customer-side permissions come from the role the customer deploys.
 */
export const CUSTOMER_ROLE_ARN_PATTERN = 'arn:aws:iam::*:role/CloudSentry*';

export function customerAssumeRoleStatement(): PolicyStatement {
  return new PolicyStatement({
    sid: 'AssumeCustomerCloudSentryRoles',
    actions: ['sts:AssumeRole'],
    resources: [CUSTOMER_ROLE_ARN_PATTERN],
  });
}

/** AWS Price List API (GetProducts only). The API does not support resource-level permissions. */
export function pricingStatement(): PolicyStatement {
  return new PolicyStatement({
    sid: 'ReadAwsPriceList',
    actions: ['pricing:GetProducts'],
    resources: ['*'],
  });
}

export function scheduleArnPattern(scope: Construct, scheduleGroupName: string): string {
  return Stack.of(scope).formatArn({
    service: 'scheduler',
    resource: 'schedule',
    resourceName: `${scheduleGroupName}/*`,
    arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
  });
}

/** Full schedule lifecycle management, restricted to the CloudSentry schedule group. */
export function schedulerManageStatement(scope: Construct, scheduleGroupName: string): PolicyStatement {
  return new PolicyStatement({
    sid: 'ManageCloudSentrySchedules',
    actions: [
      'scheduler:CreateSchedule',
      'scheduler:UpdateSchedule',
      'scheduler:DeleteSchedule',
      'scheduler:GetSchedule',
    ],
    resources: [scheduleArnPattern(scope, scheduleGroupName)],
  });
}

/** Read/delete only: used when an account is removed and its schedule must be cleaned up. */
export function schedulerDeleteStatement(scope: Construct, scheduleGroupName: string): PolicyStatement {
  return new PolicyStatement({
    sid: 'DeleteCloudSentrySchedules',
    actions: ['scheduler:DeleteSchedule', 'scheduler:GetSchedule'],
    resources: [scheduleArnPattern(scope, scheduleGroupName)],
  });
}

/** Lets the API hand the scheduler execution role to EventBridge Scheduler, and nothing else. */
export function passSchedulerRoleStatement(schedulerRoleArn: string): PolicyStatement {
  return new PolicyStatement({
    sid: 'PassSchedulerExecutionRole',
    actions: ['iam:PassRole'],
    resources: [schedulerRoleArn],
    conditions: { StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' } },
  });
}

export function executionArnPattern(scope: Construct, stateMachineName: string): string {
  return Stack.of(scope).formatArn({
    service: 'states',
    resource: 'execution',
    resourceName: `${stateMachineName}:*`,
    arnFormat: ArnFormat.COLON_RESOURCE_NAME,
  });
}

/** Stop/describe executions of the scan state machine (scan cancellation and status). */
export function scanExecutionControlStatement(scope: Construct, stateMachineName: string): PolicyStatement {
  return new PolicyStatement({
    sid: 'ControlScanExecutions',
    actions: ['states:StopExecution', 'states:DescribeExecution'],
    resources: [executionArnPattern(scope, stateMachineName)],
  });
}

/** Email subscription management on the tenant-filtered notifications topic. */
export function notificationSubscriptionStatement(topicArn: string): PolicyStatement {
  return new PolicyStatement({
    sid: 'ManageNotificationSubscriptions',
    actions: [
      'sns:Subscribe',
      'sns:Unsubscribe',
      'sns:ListSubscriptionsByTopic',
      'sns:GetSubscriptionAttributes',
      'sns:SetSubscriptionAttributes',
    ],
    resources: [topicArn, `${topicArn}:*`],
  });
}
