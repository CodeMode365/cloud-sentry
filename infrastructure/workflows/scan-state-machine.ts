import { Duration, type RemovalPolicy } from 'aws-cdk-lib';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, type RetentionDays } from 'aws-cdk-lib/aws-logs';
import {
  Chain,
  DefinitionBody,
  Errors,
  Fail,
  JitterType,
  JsonPath,
  LogLevel,
  Parallel,
  Pass,
  StateMachine,
  StateMachineType,
  Succeed,
  TaskInput,
} from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

/**
 * CDK drops literal nulls from Pass parameters, but the workflow contracts declare `artifactKey: string | null`.
 * States.StringToJson('null') yields a real JSON null at runtime.
 */
const JSON_NULL = JsonPath.stringToJson('null');

/** Lambda service errors that are always safe to retry. */
export const LAMBDA_SERVICE_ERRORS = [
  'Lambda.ServiceException',
  'Lambda.AWSLambdaException',
  'Lambda.SdkClientException',
  'Lambda.TooManyRequestsException',
];

export interface DiscoveryBranch {
  /** State name inside the Parallel, e.g. EC2Discovery. */
  stateName: string;
  /** ResourceType value reported when the branch fails. */
  resourceType: string;
  fn: IFunction;
}

export interface ScanStateMachineProps {
  stateMachineName: string;
  logRetention: RetentionDays;
  removalPolicy: RemovalPolicy;
  functions: {
    validateAccount: IFunction;
    assumeRole: IFunction;
    resolveRegions: IFunction;
    collectMetrics: IFunction;
    analyzeCosts: IFunction;
    normalizeResources: IFunction;
    executeDetectionRules: IFunction;
    generateRecommendations: IFunction;
    estimateSavings: IFunction;
    persistResults: IFunction;
    generateSummary: IFunction;
    sendNotifications: IFunction;
    markScanFailed: IFunction;
  };
  discovery: DiscoveryBranch[];
}

/**
 * The CloudSentry scan workflow (Step Functions Standard). See docs/architecture/overview.md section 4.
 *
 * State stays small: each Lambda receives the workflow state (tenantId, accountId, scanId, trigger plus
 * prior step summaries) and writes bulky output to S3. Credentials never enter workflow state.
 * Step-level failures that should not fail the scan (one discovery branch, metrics, costs, notifications)
 * are caught and converted into explicit FAILED results; anything else goes to MarkScanFailed.
 */
export class ScanStateMachine extends Construct {
  readonly stateMachine: StateMachine;
  readonly logGroup: LogGroup;

  constructor(scope: Construct, id: string, props: ScanStateMachineProps) {
    super(scope, id);
    const f = props.functions;

    const invoke = (
      stateName: string,
      fn: IFunction,
      resultPath: string,
      payload?: TaskInput,
    ): LambdaInvoke => {
      const task = new LambdaInvoke(this, stateName, {
        stateName,
        lambdaFunction: fn,
        payloadResponseOnly: true,
        retryOnServiceExceptions: false,
        resultPath,
        ...(payload ? { payload } : {}),
      });
      task.addRetry({
        errors: LAMBDA_SERVICE_ERRORS,
        interval: Duration.seconds(2),
        backoffRate: 2,
        maxAttempts: 4,
        jitterStrategy: JitterType.FULL,
      });
      return task;
    };

    // ---- Global failure path ----
    const scanFailed = new Fail(this, 'ScanFailed', {
      stateName: 'ScanFailed',
      error: 'ScanFailed',
      cause: 'The scan workflow failed; see the scan record for details',
    });
    const markScanFailed = invoke('MarkScanFailed', f.markScanFailed, '$.markFailed');
    markScanFailed.addCatch(scanFailed, { errors: [Errors.ALL], resultPath: '$.markFailedError' });
    markScanFailed.next(scanFailed);

    const withGlobalCatch = <T extends LambdaInvoke | Parallel>(state: T): T => {
      state.addCatch(markScanFailed, { errors: [Errors.ALL], resultPath: '$.error' });
      return state;
    };

    // ---- Main chain ----
    const validateAccount = withGlobalCatch(invoke('ValidateAccount', f.validateAccount, '$.validation'));
    const assumeRole = withGlobalCatch(invoke('AssumeCustomerRole', f.assumeRole, '$.role'));
    const resolveRegions = withGlobalCatch(
      invoke('DiscoverResources', f.resolveRegions, '$.regionsResolved'),
    );

    const discoveryPayload = TaskInput.fromObject({
      tenantId: JsonPath.stringAt('$.tenantId'),
      accountId: JsonPath.stringAt('$.accountId'),
      scanId: JsonPath.stringAt('$.scanId'),
      trigger: JsonPath.stringAt('$.trigger'),
      regions: JsonPath.listAt('$.regionsResolved.regions'),
      artifactsPrefix: JsonPath.stringAt('$.validation.artifactsPrefix'),
    });

    const parallelDiscovery = new Parallel(this, 'ParallelResourceDiscovery', {
      stateName: 'ParallelResourceDiscovery',
      resultPath: '$.discovery',
    });
    for (const branch of props.discovery) {
      const task = invoke(branch.stateName, branch.fn, '$', discoveryPayload);
      const failed = new Pass(this, `${branch.stateName}Failed`, {
        stateName: `${branch.stateName}Failed`,
        parameters: {
          resourceType: branch.resourceType,
          status: 'FAILED',
          resourceCount: 0,
          regionsSucceeded: [],
          regionsFailed: [],
          artifactKey: JSON_NULL,
          durationMs: 0,
          errorMessage: JsonPath.format('Discovery worker failed: {}', JsonPath.stringAt('$.error.Error')),
        },
      });
      task.addCatch(failed, { errors: [Errors.ALL], resultPath: '$.error' });
      parallelDiscovery.branch(task);
    }
    withGlobalCatch(parallelDiscovery);

    /** A step whose failure is recorded as `{ status: 'FAILED' }` and the workflow continues. */
    const tolerantStep = (stateName: string, fn: IFunction, resultPath: string) => {
      const task = invoke(stateName, fn, resultPath);
      const failed = new Pass(this, `${stateName}Failed`, {
        stateName: `${stateName}Failed`,
        parameters: {
          status: 'FAILED',
          artifactKey: JSON_NULL,
          message: JsonPath.format(`${stateName} failed: {}`, JsonPath.stringAt(`${resultPath}.Error`)),
        },
        resultPath,
      });
      task.addCatch(failed, { errors: [Errors.ALL], resultPath });
      return { task, failed };
    };

    const collectMetrics = tolerantStep('CollectCloudWatchMetrics', f.collectMetrics, '$.metrics');
    const analyzeCosts = tolerantStep('AnalyzeAWSCosts', f.analyzeCosts, '$.costs');

    const normalize = withGlobalCatch(invoke('NormalizeResourceData', f.normalizeResources, '$.normalized'));
    const detect = withGlobalCatch(invoke('ExecuteDetectionRules', f.executeDetectionRules, '$.detection'));
    const recommend = withGlobalCatch(
      invoke('GenerateRecommendations', f.generateRecommendations, '$.recommendations'),
    );
    const savings = withGlobalCatch(invoke('EstimateSavings', f.estimateSavings, '$.savings'));
    const persist = withGlobalCatch(invoke('PersistResults', f.persistResults, '$.persisted'));
    const summary = withGlobalCatch(invoke('GenerateScanSummary', f.generateSummary, '$.summary'));

    // Notification failures never fail a completed scan.
    const complete = new Succeed(this, 'COMPLETE', { stateName: 'COMPLETE' });
    const notify = invoke('SendNotifications', f.sendNotifications, '$.notifications');
    const notifyFailed = new Pass(this, 'SendNotificationsFailed', {
      stateName: 'SendNotificationsFailed',
      parameters: {
        status: 'FAILED',
        artifactKey: JSON_NULL,
        message: JsonPath.format('SendNotifications failed: {}', JsonPath.stringAt('$.notifications.Error')),
      },
      resultPath: '$.notifications',
    });
    notify.addCatch(notifyFailed, { errors: [Errors.ALL], resultPath: '$.notifications' });
    notifyFailed.next(complete);

    collectMetrics.failed.next(analyzeCosts.task);
    analyzeCosts.failed.next(normalize);

    const definition = Chain.start(validateAccount)
      .next(assumeRole)
      .next(resolveRegions)
      .next(parallelDiscovery)
      .next(collectMetrics.task)
      .next(analyzeCosts.task)
      .next(normalize)
      .next(detect)
      .next(recommend)
      .next(savings)
      .next(persist)
      .next(summary)
      .next(notify);
    notify.next(complete);

    this.logGroup = new LogGroup(this, 'Logs', {
      logGroupName: `/aws/vendedlogs/states/${props.stateMachineName}`,
      retention: props.logRetention,
      removalPolicy: props.removalPolicy,
    });

    this.stateMachine = new StateMachine(this, 'StateMachine', {
      stateMachineName: props.stateMachineName,
      stateMachineType: StateMachineType.STANDARD,
      definitionBody: DefinitionBody.fromChainable(definition),
      timeout: Duration.hours(1),
      tracingEnabled: true,
      logs: { destination: this.logGroup, level: LogLevel.ERROR, includeExecutionData: false },
    });
  }
}
