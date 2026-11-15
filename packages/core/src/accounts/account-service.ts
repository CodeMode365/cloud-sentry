import type { RoleVerifier } from '@cloudsentry/aws-clients';
import type {
  AccountOnboardingInstructions,
  AuthContext,
  CloudAccount,
  CreateAccountResponse,
} from '@cloudsentry/shared-types';
import {
  parseRoleArn,
  roleArnMatchesAccount,
  CUSTOMER_ROLE_NAME_PATTERN,
  type CreateAccountRequest,
  type UpdateAccountRequest,
} from '@cloudsentry/validators';
import {
  ConflictError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
  generateExternalId,
} from '@cloudsentry/utilities';
import { requireRole } from '../auth/authorization';
import type { ServiceContext } from '../context';
import type { ScheduleService } from '../schedules/schedule-service';
import { buildOnboardingInstructions } from './onboarding';
import type { PlatformIdentity } from './platform-identity';

export class AccountService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly verifier: RoleVerifier,
    private readonly platform: PlatformIdentity,
    private readonly schedules: ScheduleService,
  ) {}

  async create(auth: AuthContext, input: CreateAccountRequest): Promise<CreateAccountResponse> {
    requireRole(auth, 'ADMIN');
    // Resolve the trusted platform account first so a failure never leaves a half-created account behind.
    const platformAccountId = await this.platform.getAccountId();
    const now = this.ctx.clock.now().toISOString();
    const account: CloudAccount = {
      tenantId: auth.tenantId,
      accountId: input.accountId,
      alias: input.alias,
      roleArn: `arn:aws:iam::${input.accountId}:role/${input.roleName}`,
      externalId: generateExternalId(),
      regions: [...new Set(input.regions)].sort(),
      status: 'PENDING_VERIFICATION',
      dataSource: 'AWS',
      connectionType: 'ROLE',
      organizationId: null,
      lastVerification: null,
      lastScanId: null,
      lastScanAt: null,
      lastSuccessfulScanAt: null,
      createdBy: auth.userId,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.ctx.repos.accounts.create(account);
    this.ctx.logger.audit('account.created', {
      tenantId: auth.tenantId,
      userId: auth.userId,
      accountId: input.accountId,
    });
    return { account, onboarding: await this.onboardingFor(account, platformAccountId) };
  }

  async onboarding(auth: AuthContext, accountId: string): Promise<AccountOnboardingInstructions> {
    return this.onboardingFor(await this.get(auth, accountId));
  }

  private async onboardingFor(
    account: CloudAccount,
    platformAccountId?: string,
  ): Promise<AccountOnboardingInstructions> {
    const parsed = parseRoleArn(account.roleArn);
    return buildOnboardingInstructions({
      platformAccountId: platformAccountId ?? (await this.platform.getAccountId()),
      customerAccountId: account.accountId,
      roleName: parsed?.roleName ?? 'CloudSentryReadOnlyRole',
      externalId: account.externalId,
    });
  }

  list(auth: AuthContext): Promise<CloudAccount[]> {
    return this.ctx.repos.accounts.list(auth.tenantId);
  }

  async get(auth: AuthContext, accountId: string): Promise<CloudAccount> {
    const account = await this.ctx.repos.accounts.get(auth.tenantId, accountId);
    if (!account) throw new NotFoundError('Account', accountId);
    return account;
  }

  async update(auth: AuthContext, accountId: string, input: UpdateAccountRequest): Promise<CloudAccount> {
    requireRole(auth, 'ADMIN');
    const existing = await this.get(auth, accountId);
    const updated = await this.ctx.repos.accounts.update(
      auth.tenantId,
      accountId,
      {
        ...(input.alias !== undefined ? { alias: input.alias } : {}),
        ...(input.regions !== undefined ? { regions: [...new Set(input.regions)].sort() } : {}),
      },
      existing.version,
    );
    this.ctx.logger.audit('account.updated', { tenantId: auth.tenantId, userId: auth.userId, accountId });
    return updated;
  }

  /**
   * Assumes the customer's role with the stored external ID, checks the caller account matches the
   * registered account, and probes permissions. Updates connection status.
   */
  async verify(auth: AuthContext, accountId: string, roleArn?: string): Promise<CloudAccount> {
    requireRole(auth, 'ADMIN');
    const account = await this.get(auth, accountId);
    if (account.dataSource === 'SYNTHETIC') {
      throw new PreconditionFailedError('Synthetic accounts cannot be verified against AWS');
    }
    const targetRoleArn = roleArn ?? account.roleArn;
    const parsed = parseRoleArn(targetRoleArn);
    if (!parsed) throw new ValidationError('Invalid IAM role ARN');
    if (!roleArnMatchesAccount(targetRoleArn, accountId)) {
      throw new ValidationError(`Role ARN must belong to account ${accountId}`);
    }
    if (!CUSTOMER_ROLE_NAME_PATTERN.test(parsed.roleName)) {
      throw new ValidationError('Role name must start with "CloudSentry"');
    }
    const probeRegion = account.regions[0] ?? 'us-east-1';
    const result = await this.verifier.verify({
      roleArn: targetRoleArn,
      externalId: account.externalId,
      expectedAccountId: accountId,
      probeRegion,
    });
    const { accountAliases, ...verification } = result;
    const updated = await this.ctx.repos.accounts.update(auth.tenantId, accountId, {
      roleArn: targetRoleArn,
      status: result.success ? 'CONNECTED' : 'ERROR',
      lastVerification: verification,
      ...(result.success && account.alias === accountId && accountAliases[0]
        ? { alias: accountAliases[0] }
        : {}),
    });
    this.ctx.logger.audit('account.verified', {
      tenantId: auth.tenantId,
      userId: auth.userId,
      accountId,
      success: result.success,
      errorCode: result.errorCode,
    });
    return updated;
  }

  /** Removes the account, its schedule, inventory, findings, recommendations and cost data. Scan history is kept. */
  async delete(auth: AuthContext, accountId: string): Promise<void> {
    requireRole(auth, 'ADMIN');
    await this.get(auth, accountId);
    const lock = await this.ctx.repos.scans.getLock(auth.tenantId, accountId, this.ctx.clock.now());
    if (lock)
      throw new ConflictError('A scan is running for this account; cancel it before deleting', {
        scanId: lock.scanId,
      });
    await this.schedules.deleteForAccount(auth, accountId);
    const repos = this.ctx.repos;
    const [resources, findings, recommendations] = await Promise.all([
      repos.resources.deleteByAccount(auth.tenantId, accountId),
      repos.findings.deleteByAccount(auth.tenantId, accountId),
      repos.recommendations.deleteByAccount(auth.tenantId, accountId),
      repos.costs.delete(auth.tenantId, accountId),
    ]);
    await repos.accounts.delete(auth.tenantId, accountId);
    this.ctx.logger.audit('account.deleted', {
      tenantId: auth.tenantId,
      userId: auth.userId,
      accountId,
      removed: { resources, findings, recommendations },
    });
  }
}
