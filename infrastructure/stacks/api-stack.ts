import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import { AccessLogFormat } from 'aws-cdk-lib/aws-apigateway';
import {
  HttpApi,
  HttpMethod,
  HttpStage,
  LogGroupLogDestination,
  type IHttpRouteAuthorizer,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import type { ITableV2 } from 'aws-cdk-lib/aws-dynamodb';
import type { IRole } from 'aws-cdk-lib/aws-iam';
import type { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import type { IBucket } from 'aws-cdk-lib/aws-s3';
import type { ScheduleGroup } from 'aws-cdk-lib/aws-scheduler';
import type { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import type { ITopic } from 'aws-cdk-lib/aws-sns';
import type { IStateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import type { Construct } from 'constructs';
import { CloudSentryFunction, type SharedFunctionEnvironment } from '../constructs/cloudsentry-function';
import {
  grantArtifactsRead,
  grantArtifactsReadWrite,
  grantTableRead,
  grantTableReadWrite,
} from '../constructs/grants';
import { HANDLERS, type HandlerKey } from '../constructs/handlers';
import { resourcePrefix, type EnvironmentConfig } from '../environments';
import {
  customerAssumeRoleStatement,
  notificationSubscriptionStatement,
  passSchedulerRoleStatement,
  scanExecutionControlStatement,
  schedulerDeleteStatement,
  schedulerManageStatement,
} from '../policies/statements';

export interface ApiStackProps extends StackProps {
  config: EnvironmentConfig;
  table: ITableV2;
  artifactsBucket: IBucket;
  userPool: UserPool;
  userPoolClient: UserPoolClient;
  clientSecret: ISecret;
  stateMachine: IStateMachine;
  stateMachineName: string;
  notificationsTopic: ITopic;
  scheduleGroup: ScheduleGroup;
  schedulerRole: IRole;
  scheduledScanFunction: NodejsFunction;
}

type ApiHandlerKey = Extract<
  HandlerKey,
  | 'apiAuth'
  | 'apiAccounts'
  | 'apiScans'
  | 'apiInventory'
  | 'apiAnalytics'
  | 'apiSchedules'
  | 'apiReports'
  | 'apiSettings'
>;

const API_BASE = '/api/v1';

/**
 * API layer: HTTP API with one Lambda per domain, plus the asynchronous report generator.
 *
 * Authentication is enforced twice:
 *  1. At the gateway by a Cognito JWT authorizer on every non-/auth route (signature, issuer, expiry, and
 *     client_id - HTTP API JWT authorizers validate `client_id` when a token has no `aud`, which is the
 *     case for Cognito access tokens). Unauthenticated traffic never reaches a Lambda.
 *  2. In each Lambda with aws-jwt-verify (tokenUse=access), which additionally rejects ID tokens and
 *     resolves the caller's tenant server-side. See docs/security/iam.md.
 */
export class ApiStack extends Stack {
  readonly httpApi: HttpApi;
  readonly stage: HttpStage;
  readonly functions: Record<ApiHandlerKey, NodejsFunction>;
  readonly reportFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { config, table, artifactsBucket } = props;
    const prefix = resourcePrefix(config);

    const shared: SharedFunctionEnvironment = {
      TABLE_NAME: table.tableName,
      ARTIFACTS_BUCKET: artifactsBucket.bucketName,
      PLATFORM_ACCOUNT_ID: this.account,
    };

    // ---- Report generator (invoked asynchronously by api-reports) ----
    this.reportFunction = new CloudSentryFunction(this, 'generateReport', {
      definition: HANDLERS.generateReport,
      config,
      shared,
    }).fn;
    grantTableReadWrite(this.reportFunction, table);
    grantArtifactsReadWrite(this.reportFunction, artifactsBucket);

    // Configuration values are not secrets; every API function receives the same set so request handling
    // code can be composed uniformly. Permissions (below) are what differ per function.
    const apiEnvironment: Record<string, string> = {
      AUTH_MODE: 'cognito',
      USER_POOL_ID: props.userPool.userPoolId,
      USER_POOL_CLIENT_ID: props.userPoolClient.userPoolClientId,
      USER_POOL_CLIENT_SECRET_ARN: props.clientSecret.secretArn,
      STATE_MACHINE_ARN: props.stateMachine.stateMachineArn,
      SCHEDULER_GROUP_NAME: props.scheduleGroup.scheduleGroupName,
      SCHEDULER_ROLE_ARN: props.schedulerRole.roleArn,
      SCHEDULED_SCAN_FUNCTION_ARN: props.scheduledScanFunction.functionArn,
      NOTIFICATIONS_TOPIC_ARN: props.notificationsTopic.topicArn,
      REPORT_FUNCTION_NAME: this.reportFunction.functionName,
      COOKIE_SECURE: 'true',
    };

    const fns = {} as Record<ApiHandlerKey, NodejsFunction>;
    const keys: ApiHandlerKey[] = [
      'apiAuth',
      'apiAccounts',
      'apiScans',
      'apiInventory',
      'apiAnalytics',
      'apiSchedules',
      'apiReports',
      'apiSettings',
    ];
    for (const key of keys) {
      fns[key] = new CloudSentryFunction(this, key, {
        definition: HANDLERS[key],
        config,
        shared,
        environment: apiEnvironment,
      }).fn;
    }
    this.functions = fns;

    // ---- Per-domain permissions ----
    grantTableReadWrite(fns.apiAuth, table); // tenant provisioning on first login
    props.clientSecret.grantRead(fns.apiAuth);

    grantTableReadWrite(fns.apiAccounts, table);
    fns.apiAccounts.addToRolePolicy(customerAssumeRoleStatement()); // connection verification
    fns.apiAccounts.addToRolePolicy(schedulerDeleteStatement(this, props.scheduleGroup.scheduleGroupName));

    grantTableReadWrite(fns.apiScans, table);
    grantArtifactsRead(fns.apiScans, artifactsBucket); // scan result artifacts
    props.stateMachine.grantStartExecution(fns.apiScans);
    fns.apiScans.addToRolePolicy(scanExecutionControlStatement(this, props.stateMachineName));

    grantTableReadWrite(fns.apiInventory, table); // finding/recommendation status updates

    grantTableRead(fns.apiAnalytics, table);

    grantTableReadWrite(fns.apiSchedules, table);
    fns.apiSchedules.addToRolePolicy(schedulerManageStatement(this, props.scheduleGroup.scheduleGroupName));
    fns.apiSchedules.addToRolePolicy(passSchedulerRoleStatement(props.schedulerRole.roleArn));

    grantTableReadWrite(fns.apiReports, table);
    grantArtifactsRead(fns.apiReports, artifactsBucket); // pre-signed download URLs
    this.reportFunction.grantInvoke(fns.apiReports);

    grantTableReadWrite(fns.apiSettings, table);
    fns.apiSettings.addToRolePolicy(notificationSubscriptionStatement(props.notificationsTopic.topicArn));

    // ---- HTTP API ----
    this.httpApi = new HttpApi(this, 'HttpApi', {
      apiName: `${prefix}-api`,
      description: 'CloudSentry REST API (/api/v1)',
      createDefaultStage: false,
    });

    const accessLogs = new LogGroup(this, 'AccessLogs', {
      logGroupName: `/aws/apigateway/${prefix}-api`,
      retention: config.logRetention,
      removalPolicy: config.removalPolicy,
    });
    this.stage = new HttpStage(this, 'DefaultStage', {
      httpApi: this.httpApi,
      stageName: '$default',
      autoDeploy: true,
      throttle: { rateLimit: config.api.throttleRateLimit, burstLimit: config.api.throttleBurstLimit },
      accessLogSettings: {
        destination: new LogGroupLogDestination(accessLogs),
        format: AccessLogFormat.custom(
          JSON.stringify({
            requestId: '$context.requestId',
            ip: '$context.identity.sourceIp',
            requestTime: '$context.requestTime',
            httpMethod: '$context.httpMethod',
            routeKey: '$context.routeKey',
            status: '$context.status',
            protocol: '$context.protocol',
            responseLength: '$context.responseLength',
            integrationLatency: '$context.integrationLatency',
            responseLatency: '$context.responseLatency',
            integrationError: '$context.integrationErrorMessage',
            authorizerError: '$context.authorizer.error',
            userAgent: '$context.identity.userAgent',
          }),
        ),
      },
    });

    const authorizer = new HttpUserPoolAuthorizer('CognitoAccessToken', props.userPool, {
      userPoolClients: [props.userPoolClient],
      identitySource: ['$request.header.Authorization'],
    });

    const integrations = new Map<NodejsFunction, HttpLambdaIntegration>();
    const integrationFor = (fn: NodejsFunction): HttpLambdaIntegration => {
      let integration = integrations.get(fn);
      if (!integration) {
        integration = new HttpLambdaIntegration(`${fn.node.scope?.node.id ?? fn.node.id}Integration`, fn);
        integrations.set(fn, integration);
      }
      return integration;
    };

    const route = (
      path: string,
      methods: HttpMethod[],
      fn: NodejsFunction,
      routeAuthorizer: IHttpRouteAuthorizer | undefined,
    ): void => {
      this.httpApi.addRoutes({
        path: `${API_BASE}${path}`,
        methods,
        integration: integrationFor(fn),
        ...(routeAuthorizer ? { authorizer: routeAuthorizer } : {}),
      });
    };
    const ANY = [HttpMethod.ANY];

    // Public: register/confirm/login/refresh/logout. GET /auth/me verifies the token in-handler.
    route('/auth/{proxy+}', ANY, fns.apiAuth, undefined);

    route('/accounts', ANY, fns.apiAccounts, authorizer);
    route('/accounts/{proxy+}', ANY, fns.apiAccounts, authorizer);
    // More specific than /accounts/{proxy+}, so HTTP API routes manual scan starts to the scans domain.
    route('/accounts/{accountId}/scans', [HttpMethod.POST], fns.apiScans, authorizer);
    route('/scans', ANY, fns.apiScans, authorizer);
    route('/scans/{proxy+}', ANY, fns.apiScans, authorizer);

    for (const base of ['/resources', '/findings', '/recommendations']) {
      route(base, ANY, fns.apiInventory, authorizer);
      route(`${base}/{proxy+}`, ANY, fns.apiInventory, authorizer);
    }

    route('/analytics/{proxy+}', ANY, fns.apiAnalytics, authorizer);
    route('/schedules', ANY, fns.apiSchedules, authorizer);
    route('/schedules/{proxy+}', ANY, fns.apiSchedules, authorizer);
    route('/reports', ANY, fns.apiReports, authorizer);
    route('/reports/{proxy+}', ANY, fns.apiReports, authorizer);
    route('/settings/{proxy+}', ANY, fns.apiSettings, authorizer);
    route('/rules', [HttpMethod.GET], fns.apiSettings, authorizer);

    new CfnOutput(this, 'ApiUrl', {
      value: this.stage.url,
      description: 'HTTP API invoke URL (prefer the CloudFront URL)',
    });
    new CfnOutput(this, 'ApiId', { value: this.httpApi.apiId });
  }

  /** Domain name of the HTTP API endpoint, e.g. abc123.execute-api.us-east-1.amazonaws.com. */
  get apiDomainName(): string {
    return `${this.httpApi.apiId}.execute-api.${this.region}.${this.urlSuffix}`;
  }
}
