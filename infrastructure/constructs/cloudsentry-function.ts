import { join } from 'node:path';
import { Duration, type RemovalPolicy } from 'aws-cdk-lib';
import { Architecture, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, type RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import type { EnvironmentConfig } from '../environments';
import { functionName, handlerEntryPath, REPO_ROOT, type HandlerDefinition } from './handlers';

export interface SharedFunctionEnvironment {
  TABLE_NAME: string;
  ARTIFACTS_BUCKET: string;
  PLATFORM_ACCOUNT_ID: string;
}

export interface CloudSentryFunctionProps {
  definition: HandlerDefinition;
  config: EnvironmentConfig;
  shared: SharedFunctionEnvironment;
  /** Function-specific environment variables (merged over the shared base). */
  environment?: Record<string, string>;
}

/**
 * Standard CloudSentry Lambda: Node.js 22 on ARM64, esbuild bundle (minified, source maps), explicit log
 * group with retention, X-Ray tracing, and the base environment shared by every function.
 * The AWS SDK is bundled (not taken from the runtime) so the deployed SDK version matches the lockfile.
 */
export class CloudSentryFunction extends Construct {
  readonly fn: NodejsFunction;
  readonly logGroup: LogGroup;

  constructor(scope: Construct, id: string, props: CloudSentryFunctionProps) {
    super(scope, id);
    const { definition, config } = props;
    const name = functionName(config.stage, definition);

    this.logGroup = new LogGroup(this, 'Logs', {
      logGroupName: `/aws/lambda/${name}`,
      retention: config.logRetention as RetentionDays,
      removalPolicy: config.removalPolicy as RemovalPolicy,
    });

    this.fn = new NodejsFunction(this, 'Function', {
      functionName: name,
      description: definition.description,
      entry: handlerEntryPath(definition),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize:
        definition.memory === 'large' ? config.lambda.largeMemoryMb : config.lambda.standardMemoryMb,
      timeout: Duration.seconds(definition.timeoutSeconds),
      tracing: Tracing.ACTIVE,
      logGroup: this.logGroup,
      projectRoot: REPO_ROOT,
      depsLockFilePath: join(REPO_ROOT, 'pnpm-lock.yaml'),
      bundling: {
        minify: true,
        sourceMap: true,
        sourcesContent: false,
        target: 'node22',
        format: OutputFormat.CJS,
        externalModules: [],
      },
      environment: {
        STAGE: config.stage,
        LOG_LEVEL: config.lambda.logLevel,
        NODE_OPTIONS: '--enable-source-maps',
        TABLE_NAME: props.shared.TABLE_NAME,
        ARTIFACTS_BUCKET: props.shared.ARTIFACTS_BUCKET,
        PLATFORM_ACCOUNT_ID: props.shared.PLATFORM_ACCOUNT_ID,
        ...props.environment,
      },
    });
  }
}
