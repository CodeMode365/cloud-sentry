import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';

/** Resolves CloudSentry's own AWS account ID (the principal customers trust). */
export interface PlatformIdentity {
  getAccountId(): Promise<string>;
}

export class StaticPlatformIdentity implements PlatformIdentity {
  constructor(private readonly accountId: string) {}
  getAccountId(): Promise<string> {
    return Promise.resolve(this.accountId);
  }
}

/** Falls back to sts:GetCallerIdentity (used in local development where PLATFORM_ACCOUNT_ID may be unset). */
export class StsPlatformIdentity implements PlatformIdentity {
  private cached: Promise<string> | undefined;
  constructor(private readonly sts = new STSClient({ region: process.env.AWS_REGION ?? 'us-east-1' })) {}
  getAccountId(): Promise<string> {
    this.cached ??= this.sts.send(new GetCallerIdentityCommand({})).then((r) => {
      if (!r.Account) throw new Error('Unable to resolve platform account ID');
      return r.Account;
    });
    return this.cached;
  }
}
