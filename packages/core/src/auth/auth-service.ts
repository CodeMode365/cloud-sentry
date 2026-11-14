import type { AuthContext, LoginResponse, MeResponse, Tenant, UserProfile } from '@cloudsentry/shared-types';
import type { ConfirmRegistrationRequest, LoginRequest, RegisterRequest } from '@cloudsentry/validators';
import { ConflictError, ForbiddenError, UnauthorizedError, newId } from '@cloudsentry/utilities';
import type { ServiceContext } from '../context';
import type { IdentityProvider } from './identity-provider';

export interface LoginResult extends LoginResponse {
  /** Opaque value for the httpOnly refresh cookie. Never returned in a response body. */
  refreshCookieValue: string;
}

const PROFILE_CACHE_MS = 60_000;

export function encodeRefreshCookie(userSub: string, refreshToken: string): string {
  return `${userSub}.${refreshToken}`;
}

export function decodeRefreshCookie(
  value: string | undefined,
): { userSub: string; refreshToken: string } | null {
  if (!value) return null;
  const idx = value.indexOf('.');
  if (idx <= 0) return null;
  const userSub = value.slice(0, idx);
  const refreshToken = value.slice(idx + 1);
  if (!/^[\w-]{8,64}$/.test(userSub) || refreshToken.length < 20) return null;
  return { userSub, refreshToken };
}

export class AuthService {
  private readonly profileCache = new Map<string, { profile: UserProfile; at: number }>();

  constructor(
    private readonly ctx: ServiceContext,
    private readonly idp: IdentityProvider,
  ) {}

  async register(input: RegisterRequest): Promise<{ userConfirmed: boolean }> {
    const result = await this.idp.signUp({ email: input.email, password: input.password, name: input.name });
    await this.ctx.repos.tenants.savePendingRegistration(
      {
        email: input.email,
        name: input.name,
        organizationName: input.organizationName,
        createdAt: this.ctx.clock.now().toISOString(),
      },
      7,
    );
    this.ctx.logger.audit('user.registered', { email: input.email });
    return { userConfirmed: result.confirmed };
  }

  async confirm(input: ConfirmRegistrationRequest): Promise<void> {
    await this.idp.confirmSignUp(input.email, input.code);
    this.ctx.logger.audit('user.confirmed', { email: input.email });
  }

  resendCode(email: string): Promise<void> {
    return this.idp.resendConfirmationCode(email);
  }

  async login(input: LoginRequest): Promise<LoginResult> {
    const tokens = await this.idp.login(input.email, input.password);
    const { user, tenant } = await this.ensureProvisioned(tokens.userSub, input.email);
    const now = this.ctx.clock.now().toISOString();
    await this.ctx.repos.tenants.recordLogin(user.userId, now);
    this.ctx.logger.audit('user.login', { userId: user.userId, tenantId: user.tenantId });
    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      tokenType: 'Bearer',
      user: { ...user, lastLoginAt: now },
      tenant,
      refreshCookieValue: encodeRefreshCookie(tokens.userSub, tokens.refreshToken),
    };
  }

  /** Creates the tenant + owner profile on first successful login (from the pending registration). */
  private async ensureProvisioned(
    userSub: string,
    email: string,
  ): Promise<{ user: UserProfile; tenant: Tenant }> {
    const repos = this.ctx.repos.tenants;
    let profile = await repos.getUserProfile(userSub);
    if (!profile) {
      const pending = await repos.getPendingRegistration(email);
      const now = this.ctx.clock.now().toISOString();
      const tenant: Tenant = {
        tenantId: newId.tenant(),
        name: pending?.organizationName ?? `${email.split('@')[0] ?? 'My'} organization`,
        createdAt: now,
        updatedAt: now,
      };
      const owner: UserProfile = {
        userId: userSub,
        tenantId: tenant.tenantId,
        email,
        name: pending?.name ?? email,
        role: 'OWNER',
        createdAt: now,
        lastLoginAt: null,
      };
      try {
        await repos.provisionTenant(tenant, owner);
        this.ctx.logger.audit('tenant.provisioned', { tenantId: tenant.tenantId, userId: userSub });
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
      }
      if (pending) await repos.deletePendingRegistration(email);
      profile = await repos.getUserProfile(userSub);
      if (!profile) throw new Error('User provisioning failed');
    }
    const tenant = await repos.getTenant(profile.tenantId);
    if (!tenant) throw new ForbiddenError('Tenant not found for user');
    return { user: profile, tenant };
  }

  async refresh(cookie: {
    userSub: string;
    refreshToken: string;
  }): Promise<{ accessToken: string; expiresIn: number; tokenType: 'Bearer' }> {
    const out = await this.idp.refresh(cookie.refreshToken, cookie.userSub);
    return { ...out, tokenType: 'Bearer' };
  }

  async logout(cookie: { userSub: string; refreshToken: string } | null): Promise<void> {
    if (!cookie) return;
    await this.idp.revoke(cookie.refreshToken);
    this.ctx.logger.audit('user.logout', { userId: cookie.userSub });
  }

  /** Verifies a bearer token and resolves the caller's tenant from the server-side profile. */
  async authenticate(authorizationHeader: string | undefined): Promise<AuthContext> {
    const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/.exec(authorizationHeader ?? '');
    if (!match) throw new UnauthorizedError();
    const verified = await this.idp.verifyAccessToken(match[1] as string);
    const profile = await this.getProfileCached(verified.userSub);
    if (!profile) throw new UnauthorizedError('User is not provisioned; sign in again');
    return { userId: profile.userId, tenantId: profile.tenantId, role: profile.role, email: profile.email };
  }

  private async getProfileCached(userId: string): Promise<UserProfile | null> {
    const cached = this.profileCache.get(userId);
    if (cached && Date.now() - cached.at < PROFILE_CACHE_MS) return cached.profile;
    const profile = await this.ctx.repos.tenants.getUserProfile(userId);
    if (profile) this.profileCache.set(userId, { profile, at: Date.now() });
    return profile;
  }

  async me(auth: AuthContext): Promise<MeResponse> {
    const [user, tenant] = await Promise.all([
      this.ctx.repos.tenants.getUserProfile(auth.userId),
      this.ctx.repos.tenants.getTenant(auth.tenantId),
    ]);
    if (!user || !tenant) throw new UnauthorizedError();
    return { user, tenant };
  }
}
