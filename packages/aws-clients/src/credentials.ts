import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from '@aws-sdk/types';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { CUSTOMER_ROLE_SESSION_SECONDS } from '@cloudsentry/shared-types';

export interface CustomerRoleParams {
  roleArn: string;
  externalId: string;
  /** Appears in the customer's CloudTrail. Must match [\w+=,.@-]{2,64}. */
  sessionName: string;
  durationSeconds?: number;
  stsRegion?: string;
}

/** Sanitizes an arbitrary label into a valid STS RoleSessionName. */
export function toSessionName(label: string): string {
  const cleaned = `cloudsentry-${label}`.replace(/[^\w+=,.@-]/g, '-');
  return cleaned.slice(0, 64);
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Wraps a credential provider so concurrent callers share one set of credentials and refresh happens
 * once, five minutes before expiry. Prevents one AssumeRole call per regional client.
 */
export function memoizeCredentials(provider: AwsCredentialIdentityProvider): AwsCredentialIdentityProvider {
  let cached: AwsCredentialIdentity | undefined;
  let inflight: Promise<AwsCredentialIdentity> | undefined;
  return async () => {
    const now = Date.now();
    if (cached && (!cached.expiration || cached.expiration.getTime() - REFRESH_MARGIN_MS > now)) {
      return cached;
    }
    inflight ??= provider()
      .then((creds) => {
        cached = creds;
        return creds;
      })
      .finally(() => {
        inflight = undefined;
      });
    return inflight;
  };
}

/**
 * Temporary credentials for a customer's CloudSentry role. Credentials live only in memory for the
 * lifetime of the Lambda invocation; they are never persisted, logged, or passed between workflow states.
 */
export function customerRoleCredentials(params: CustomerRoleParams): AwsCredentialIdentityProvider {
  return memoizeCredentials(
    fromTemporaryCredentials({
      params: {
        RoleArn: params.roleArn,
        ExternalId: params.externalId,
        RoleSessionName: params.sessionName,
        DurationSeconds: params.durationSeconds ?? CUSTOMER_ROLE_SESSION_SECONDS,
      },
      clientConfig: { region: params.stsRegion ?? process.env.AWS_REGION ?? 'us-east-1' },
    }),
  );
}
