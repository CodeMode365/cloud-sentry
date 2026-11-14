import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import {
  AccountRecovery,
  ClientAttributes,
  FeaturePlan,
  UserPool,
  type UserPoolClient,
  UserPoolEmail,
  VerificationEmailStyle,
} from 'aws-cdk-lib/aws-cognito';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import { resourcePrefix, type EnvironmentConfig } from '../environments';

export interface AuthStackProps extends StackProps {
  config: EnvironmentConfig;
}

/**
 * Cognito user pool for dashboard users. Login is backend-mediated (POST /api/v1/auth/login calls
 * InitiateAuth with USER_PASSWORD_AUTH), so the app client is confidential: its secret is stored in
 * Secrets Manager and read only by the auth Lambda. No OAuth / hosted UI flows are enabled.
 */
export class AuthStack extends Stack {
  readonly userPool: UserPool;
  readonly userPoolClient: UserPoolClient;
  readonly clientSecret: Secret;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    const { config } = props;
    const prefix = resourcePrefix(config);

    this.userPool = new UserPool(this, 'UserPool', {
      userPoolName: `${prefix}-users`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      keepOriginal: { email: true },
      userVerification: {
        emailStyle: VerificationEmailStyle.CODE,
        emailSubject: 'Your CloudSentry verification code',
        emailBody: 'Your CloudSentry verification code is {####}',
      },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      // Cognito's default sender is limited to a small daily quota; configure SES for production volume.
      email: UserPoolEmail.withCognito(),
      featurePlan: FeaturePlan.ESSENTIALS,
      deletionProtection: config.deletionProtection,
      removalPolicy: config.removalPolicy,
    });

    const attributes = new ClientAttributes().withStandardAttributes({ email: true, fullname: true });
    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: `${prefix}-web`,
      generateSecret: true,
      authFlows: { userPassword: true, userSrp: false, custom: false, adminUserPassword: false },
      disableOAuth: true,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      readAttributes: new ClientAttributes().withStandardAttributes({
        email: true,
        emailVerified: true,
        fullname: true,
      }),
      writeAttributes: attributes,
    });

    // The secret value is resolved at deploy time from a DescribeUserPoolClient custom resource; it never
    // appears in the synthesized template. The secret string is the raw client secret.
    this.clientSecret = new Secret(this, 'WebClientSecret', {
      secretName: `${prefix}/cognito/web-client-secret`,
      description: 'Cognito app client secret for the CloudSentry auth API',
      secretStringValue: this.userPoolClient.userPoolClientSecret,
      removalPolicy: config.removalPolicy,
    });

    new CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: `${prefix}-user-pool-id`,
    });
    new CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      exportName: `${prefix}-user-pool-client-id`,
    });
    new CfnOutput(this, 'UserPoolClientSecretArn', { value: this.clientSecret.secretArn });
  }
}
