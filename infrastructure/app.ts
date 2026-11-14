import type { App } from 'aws-cdk-lib';
import { loadEnvironment, type EnvironmentConfig } from './environments';
import { ApiStack } from './stacks/api-stack';
import { AuthStack } from './stacks/auth-stack';
import { DataStack } from './stacks/data-stack';
import { ObservabilityStack } from './stacks/observability-stack';
import { WebStack } from './stacks/web-stack';
import { WorkflowStack } from './stacks/workflow-stack';

export interface CloudSentryStacks {
  config: EnvironmentConfig;
  data: DataStack;
  auth: AuthStack;
  workflow: WorkflowStack;
  api: ApiStack;
  web: WebStack;
  observability: ObservabilityStack;
}

/** Instantiates every CloudSentry stack for the stage selected on the app (`-c stage=<stage>`). */
export function buildCloudSentry(app: App, env: NodeJS.ProcessEnv = process.env): CloudSentryStacks {
  const config = loadEnvironment(app, env);
  const stackEnv = config.account
    ? { account: config.account, region: config.region }
    : { region: config.region };
  const name = (suffix: string) => `CloudSentry-${config.stage}-${suffix}`;
  const common = { env: stackEnv, config };

  const data = new DataStack(app, name('Data'), {
    ...common,
    description: 'CloudSentry data: DynamoDB table and artifacts bucket',
  });
  const auth = new AuthStack(app, name('Auth'), {
    ...common,
    description: 'CloudSentry authentication: Cognito user pool',
  });
  const workflow = new WorkflowStack(app, name('Workflow'), {
    ...common,
    description: 'CloudSentry scan workflow, scheduler and notifications',
    table: data.table,
    artifactsBucket: data.artifactsBucket,
  });
  const api = new ApiStack(app, name('Api'), {
    ...common,
    description: 'CloudSentry HTTP API and report generator',
    table: data.table,
    artifactsBucket: data.artifactsBucket,
    userPool: auth.userPool,
    userPoolClient: auth.userPoolClient,
    clientSecret: auth.clientSecret,
    stateMachine: workflow.stateMachine,
    stateMachineName: workflow.stateMachineName,
    notificationsTopic: workflow.notificationsTopic,
    scheduleGroup: workflow.scheduleGroup,
    schedulerRole: workflow.schedulerRole,
    scheduledScanFunction: workflow.functions.scheduledScanTrigger,
  });
  const web = new WebStack(app, name('Web'), {
    ...common,
    description: 'CloudSentry dashboard: S3 + CloudFront',
    apiDomainName: api.apiDomainName,
  });
  const observability = new ObservabilityStack(app, name('Observability'), {
    ...common,
    description: 'CloudSentry alarms and operations dashboard',
    stateMachineArn: workflow.stateMachine.stateMachineArn,
    httpApiId: api.httpApi.apiId,
  });
  observability.addStackDependency(api);

  return { config, data, auth, workflow, api, web, observability };
}
