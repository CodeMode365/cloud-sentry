import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import {
  Alarm,
  ComparisonOperator,
  Dashboard,
  GraphWidget,
  MathExpression,
  Metric,
  TextWidget,
  TreatMissingData,
  type IMetric,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';
import { functionName, HANDLERS } from '../constructs/handlers';
import { resourcePrefix, type EnvironmentConfig } from '../environments';

export interface ObservabilityStackProps extends StackProps {
  config: EnvironmentConfig;
  stateMachineArn: string;
  httpApiId: string;
}

/** Namespace for custom metrics emitted by CloudSentry code (EMF or PutMetricData). */
export const CUSTOM_METRIC_NAMESPACE = 'CloudSentry';
export const CUSTOM_METRICS = [
  'DiscoveryFailures',
  'CostAnalysisFailures',
  'NotificationFailures',
  'ScanDurationMs',
] as const;

/**
 * Operational alarms and the CloudSentry dashboard. Function metrics are addressed by their deterministic
 * physical names (cloudsentry-<stage>-<id>) so no cross-stack exports are needed per function.
 */
export class ObservabilityStack extends Stack {
  readonly opsTopic: Topic;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);
    const { config } = props;
    const prefix = resourcePrefix(config);
    const fiveMinutes = Duration.minutes(5);

    // Alarm notifications contain only alarm metadata. CloudWatch cannot publish to topics encrypted with
    // the AWS-managed SNS key, so this topic uses SNS defaults with TLS enforced.
    this.opsTopic = new Topic(this, 'OpsAlarmsTopic', {
      topicName: `${prefix}-ops-alarms`,
      displayName: 'CloudSentry operations',
      enforceSSL: true,
    });
    if (config.alarmEmail) this.opsTopic.addSubscription(new EmailSubscription(config.alarmEmail));
    const action = new SnsAction(this.opsTopic);

    const alarm = (
      alarmId: string,
      metric: IMetric,
      threshold: number,
      description: string,
      periods = 1,
    ): Alarm => {
      const a = new Alarm(this, alarmId, {
        alarmName: `${prefix}-${alarmId}`,
        alarmDescription: description,
        metric,
        threshold,
        evaluationPeriods: periods,
        datapointsToAlarm: periods,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      });
      a.addAlarmAction(action);
      return a;
    };

    // ---- Step Functions ----
    const sfnMetric = (metricName: string, statistic = 'Sum') =>
      new Metric({
        namespace: 'AWS/States',
        metricName,
        dimensionsMap: { StateMachineArn: props.stateMachineArn },
        statistic,
        period: fiveMinutes,
      });
    alarm('scan-executions-failed', sfnMetric('ExecutionsFailed'), 1, 'A scan workflow execution failed');
    alarm(
      'scan-executions-timed-out',
      sfnMetric('ExecutionsTimedOut'),
      1,
      'A scan workflow execution timed out',
    );

    // ---- Lambda ----
    const lambdaMetric = (fnName: string, metricName: string, statistic = 'Sum') =>
      new Metric({
        namespace: 'AWS/Lambda',
        metricName,
        dimensionsMap: { FunctionName: fnName },
        statistic,
        period: fiveMinutes,
      });
    const allFunctions = Object.values(HANDLERS).map((h) => ({
      id: h.id,
      name: functionName(config.stage, h),
      group: h.group,
    }));
    if (config.alarms.perFunction) {
      for (const fn of allFunctions) {
        alarm(`${fn.id}-errors`, lambdaMetric(fn.name, 'Errors'), 1, `Lambda ${fn.name} reported errors`);
        alarm(`${fn.id}-throttles`, lambdaMetric(fn.name, 'Throttles'), 1, `Lambda ${fn.name} was throttled`);
      }
    }

    // ---- API ----
    const apiMetric = (metricName: string, statistic: string) =>
      new Metric({
        namespace: 'AWS/ApiGateway',
        metricName,
        dimensionsMap: { ApiId: props.httpApiId },
        statistic,
        period: fiveMinutes,
      });
    alarm('api-5xx', apiMetric('5xx', 'Sum'), 5, 'HTTP API returned 5xx responses');
    alarm(
      'api-latency-p95',
      apiMetric('Latency', 'p95'),
      config.api.latencyAlarmP95Ms,
      `HTTP API p95 latency above ${config.api.latencyAlarmP95Ms} ms`,
      3,
    );

    // ---- Custom CloudSentry metrics ----
    const customMetric = (
      metricName: (typeof CUSTOM_METRICS)[number],
      statistic = 'Sum',
      period = Duration.hours(1),
    ) =>
      new Metric({
        namespace: CUSTOM_METRIC_NAMESPACE,
        metricName,
        dimensionsMap: { Stage: config.stage },
        statistic,
        period,
      });
    alarm(
      'cost-analysis-failures',
      customMetric('CostAnalysisFailures'),
      1,
      'Cost Explorer analysis failed for at least one scan',
    );
    alarm(
      'notification-failures',
      customMetric('NotificationFailures'),
      1,
      'At least one notification failed to send',
    );
    alarm(
      'discovery-failures',
      customMetric('DiscoveryFailures'),
      10,
      'Ten or more regional discovery failures in an hour',
    );

    // ---- Dashboard ----
    let expressionCounter = 0;
    const sumOf = (metrics: Metric[], label: string): MathExpression => {
      const idPrefix = `e${expressionCounter++}m`;
      return new MathExpression({
        expression: metrics.map((_, i) => `${idPrefix}${i}`).join('+') || '0',
        usingMetrics: Object.fromEntries(metrics.map((m, i) => [`${idPrefix}${i}`, m])),
        label,
        period: fiveMinutes,
      });
    };
    const workflowFns = allFunctions.filter((f) => f.group !== 'api');
    const apiFns = allFunctions.filter((f) => f.group === 'api');

    const dashboard = new Dashboard(this, 'Dashboard', { dashboardName: `${prefix}-operations` });
    dashboard.addWidgets(
      new TextWidget({
        markdown: `# CloudSentry ${config.stage}\nScan workflow, API and custom application metrics.`,
        width: 24,
        height: 2,
      }),
    );
    dashboard.addWidgets(
      new GraphWidget({
        title: 'Scan duration (Step Functions ExecutionTime)',
        left: [sfnMetric('ExecutionTime', 'Average'), sfnMetric('ExecutionTime', 'Maximum')],
        width: 8,
      }),
      new GraphWidget({
        title: 'Scan executions',
        left: [
          sfnMetric('ExecutionsStarted'),
          sfnMetric('ExecutionsSucceeded'),
          sfnMetric('ExecutionsFailed'),
        ],
        width: 8,
      }),
      new GraphWidget({
        title: 'Scan duration (application, ms)',
        left: [
          customMetric('ScanDurationMs', 'Average', fiveMinutes),
          customMetric('ScanDurationMs', 'Maximum', fiveMinutes),
        ],
        width: 8,
      }),
    );
    dashboard.addWidgets(
      new GraphWidget({
        title: 'Workflow Lambda errors',
        left: [
          sumOf(
            workflowFns.map((f) => lambdaMetric(f.name, 'Errors')),
            'Errors',
          ),
        ],
        right: [
          sumOf(
            workflowFns.map((f) => lambdaMetric(f.name, 'Throttles')),
            'Throttles',
          ),
        ],
        width: 8,
      }),
      new GraphWidget({
        title: 'API Lambda errors',
        left: [
          sumOf(
            apiFns.map((f) => lambdaMetric(f.name, 'Errors')),
            'Errors',
          ),
        ],
        right: [
          sumOf(
            apiFns.map((f) => lambdaMetric(f.name, 'Throttles')),
            'Throttles',
          ),
        ],
        width: 8,
      }),
      new GraphWidget({
        title: 'Lambda invocations',
        left: [
          sumOf(
            allFunctions.map((f) => lambdaMetric(f.name, 'Invocations')),
            'Invocations',
          ),
        ],
        width: 8,
      }),
    );
    dashboard.addWidgets(
      new GraphWidget({
        title: 'API latency',
        left: [apiMetric('Latency', 'p50'), apiMetric('Latency', 'p95'), apiMetric('Latency', 'p99')],
        width: 8,
      }),
      new GraphWidget({
        title: 'API requests and errors',
        left: [apiMetric('Count', 'Sum')],
        right: [apiMetric('4xx', 'Sum'), apiMetric('5xx', 'Sum')],
        width: 8,
      }),
      new GraphWidget({
        title: 'Application failures',
        left: [
          customMetric('DiscoveryFailures', 'Sum', fiveMinutes),
          customMetric('CostAnalysisFailures', 'Sum', fiveMinutes),
          customMetric('NotificationFailures', 'Sum', fiveMinutes),
        ],
        width: 8,
      }),
    );

    new CfnOutput(this, 'OpsAlarmsTopicArn', { value: this.opsTopic.topicArn });
    new CfnOutput(this, 'DashboardName', { value: dashboard.dashboardName });
  }
}
