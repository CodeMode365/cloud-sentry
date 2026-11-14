import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FileSystemArtifactStore, type RoleVerifier } from '@cloudsentry/aws-clients';
import { Router, allRoutes, buildApiServices, type ApiServices, type HttpRequest } from '@cloudsentry/api';
import type { IdentityProvider } from '@cloudsentry/core';
import { keys, type Repositories } from '@cloudsentry/database';
import { UnauthorizedError, newId, silentLogger } from '@cloudsentry/utilities';
import { available, freshRepositories } from '../helpers/ddb';

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions inspect arbitrary response payloads */
type Loose = any;
interface TestResponse {
  statusCode: number;
  body: { data?: Loose; error?: Loose; nextCursor?: string | null };
  cookies?: string[];
}

/** In-memory identity provider for tests (stands in for Cognito). */
class FakeIdp implements IdentityProvider {
  users = new Map<string, { sub: string; password: string; confirmed: boolean }>();
  async signUp(i: { email: string; password: string }) {
    const sub = `sub-${this.users.size + 1}-0000000000`;
    this.users.set(i.email, { sub, password: i.password, confirmed: false });
    return { userSub: sub, confirmed: false };
  }
  async confirmSignUp(email: string) {
    const u = this.users.get(email);
    if (u) u.confirmed = true;
  }
  async resendConfirmationCode() {}
  async login(email: string, password: string) {
    const u = this.users.get(email);
    if (!u || u.password !== password)
      throw new UnauthorizedError('Incorrect email or password', 'INVALID_CREDENTIALS');
    return {
      accessToken: `tok.${u.sub}`,
      refreshToken: `refresh-token-for-${u.sub}`,
      expiresIn: 3600,
      userSub: u.sub,
    };
  }
  async refresh(refreshToken: string, sub: string) {
    if (refreshToken !== `refresh-token-for-${sub}`) throw new UnauthorizedError('Session expired');
    return { accessToken: `tok.${sub}`, expiresIn: 3600 };
  }
  async revoke() {}
  async verifyAccessToken(token: string) {
    if (!token.startsWith('tok.')) throw new UnauthorizedError('Invalid or expired access token');
    return { userSub: token.slice(4), expiresAt: 0 };
  }
}

const verifier: RoleVerifier = {
  verify: async (r) => ({
    verifiedAt: new Date().toISOString(),
    success: true,
    assumedRoleArn: `${r.roleArn}/session`,
    callerAccountId: r.expectedAccountId,
    enabledRegions: ['us-east-1'],
    permissionChecks: [],
    errorCode: null,
    errorMessage: null,
    accountAliases: [],
  }),
};

describe.skipIf(!available)('API authentication, authorization and validation', () => {
  let repos: Repositories;
  let services: ApiServices;
  let router: Router;
  const idp = new FakeIdp();

  async function call(
    method: string,
    path: string,
    opts: { token?: string; body?: unknown; headers?: Record<string, string>; cookie?: string } = {},
  ) {
    const [p, qs] = path.split('?');
    const req: HttpRequest = {
      method,
      path: p as string,
      pathParams: {},
      query: Object.fromEntries(new URLSearchParams(qs ?? '').entries()),
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.headers ?? {}),
      },
      cookies: opts.cookie ? { cs_refresh: opts.cookie } : {},
      body: opts.body !== undefined ? JSON.stringify(opts.body) : null,
      requestId: newId.request(),
      sourceIp: '127.0.0.1',
    };
    const res = await router.handle(req, {
      logger: silentLogger,
      authenticate: (h) => services.auth.authenticate(h),
    });
    return res as TestResponse;
  }

  async function signUpAndLogin(email: string, org: string) {
    const password = 'Correct-Horse-9-Battery';
    expect(
      (
        await call('POST', '/api/v1/auth/register', {
          body: { email, password, name: email, organizationName: org },
        })
      ).statusCode,
    ).toBe(201);
    await call('POST', '/api/v1/auth/confirm', { body: { email, code: '123456' } });
    const res = await call('POST', '/api/v1/auth/login', { body: { email, password } });
    expect(res.statusCode).toBe(200);
    return res;
  }

  let tokenA: string;
  let tokenB: string;
  let viewerToken: string;
  let loginCookie: string;

  beforeAll(async () => {
    repos = await freshRepositories('api');
    services = buildApiServices(
      {
        STAGE: 'test',
        TABLE_NAME: repos.table.tableName,
        PLATFORM_ACCOUNT_ID: '999999999999',
        COOKIE_SECURE: 'true',
      },
      {
        repos,
        identityProvider: idp,
        roleVerifier: verifier,
        logger: silentLogger,
        artifacts: new FileSystemArtifactStore(
          mkdtempSync(join(tmpdir(), 'cs-api-')),
          'secret',
          'http://localhost',
        ),
        starter: { start: async (i) => ({ executionArn: `test:${i.scanId}` }), stop: async () => undefined },
        reportTrigger: { trigger: async () => undefined },
      },
    );
    router = new Router(allRoutes(() => services));
    const a = await signUpAndLogin('alice@example.com', 'Alpha Org');
    tokenA = a.body.data.accessToken;
    loginCookie = decodeURIComponent((a.cookies?.[0] ?? '').split(';')[0]?.split('=')[1] ?? '');
    tokenB = (await signUpAndLogin('bob@example.com', 'Beta Org')).body.data.accessToken;
    // A VIEWER in Alpha Org.
    const tenantA = (await call('GET', '/api/v1/auth/me', { token: tokenA })).body.data.tenant
      .tenantId as string;
    await repos.table.put({
      ...keys.user('viewer-sub-0000000000'),
      entity: 'UserProfile',
      userId: 'viewer-sub-0000000000',
      tenantId: tenantA,
      email: 'viv@example.com',
      name: 'Viv',
      role: 'VIEWER',
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    });
    viewerToken = 'tok.viewer-sub-0000000000';
  });

  it('provisions a tenant on first login and sets an httpOnly, SameSite=Strict refresh cookie', async () => {
    const me = await call('GET', '/api/v1/auth/me', { token: tokenA });
    expect(me.body.data.tenant.name).toBe('Alpha Org');
    expect(me.body.data.user.role).toBe('OWNER');
    const login = await call('POST', '/api/v1/auth/login', {
      body: { email: 'alice@example.com', password: 'Correct-Horse-9-Battery' },
    });
    expect(login.cookies?.[0]).toMatch(/HttpOnly; Secure; SameSite=Strict; Path=\/api\/v1\/auth/);
    expect(JSON.stringify(login.body)).not.toContain('refresh-token-for');
  });

  it('rejects wrong passwords and missing/invalid tokens', async () => {
    expect(
      (await call('POST', '/api/v1/auth/login', { body: { email: 'alice@example.com', password: 'nope' } }))
        .statusCode,
    ).toBe(401);
    expect((await call('GET', '/api/v1/accounts')).statusCode).toBe(401);
    expect((await call('GET', '/api/v1/accounts', { token: 'forged' })).statusCode).toBe(401);
  });

  it('requires the CSRF header for cookie-authenticated refresh', async () => {
    expect((await call('POST', '/api/v1/auth/refresh', { cookie: loginCookie })).statusCode).toBe(403);
    const ok = await call('POST', '/api/v1/auth/refresh', {
      cookie: loginCookie,
      headers: { 'x-cloudsentry-client': 'web' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.data.accessToken).toBe(tokenA);
  });

  it('creates accounts with a server-generated external ID and onboarding instructions', async () => {
    const res = await call('POST', '/api/v1/accounts', {
      token: tokenA,
      body: { accountId: '123456789012', alias: 'prod', externalId: 'attacker-chosen' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.account.externalId).toMatch(/^cs-/);
    expect(res.body.data.onboarding.trustedPrincipalArn).toBe('arn:aws:iam::999999999999:root');
    expect(
      (
        await call('POST', '/api/v1/accounts', {
          token: tokenA,
          body: { accountId: '123456789012', alias: 'dup' },
        })
      ).statusCode,
    ).toBe(409);
  });

  it('renames an account (and rejects stale or empty updates)', async () => {
    const renamed = await call('PATCH', '/api/v1/accounts/123456789012', {
      token: tokenA,
      body: { alias: 'Production (main)' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.body.data.alias).toBe('Production (main)');
    expect((await call('GET', '/api/v1/accounts/123456789012', { token: tokenA })).body.data.alias).toBe(
      'Production (main)',
    );
    expect(
      (await call('PATCH', '/api/v1/accounts/123456789012', { token: tokenA, body: { alias: '' } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call('PATCH', '/api/v1/accounts/123456789012', { token: tokenA, body: {} })).statusCode,
    ).toBe(400);
    expect(
      (await call('PATCH', '/api/v1/accounts/123456789012', { token: viewerToken, body: { alias: 'x' } }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('PATCH', '/api/v1/accounts/123456789012', { token: tokenB, body: { alias: 'x' } }))
        .statusCode,
    ).toBe(404);
  });

  it('validates input with consistent error envelopes', async () => {
    const bad = await call('POST', '/api/v1/accounts', {
      token: tokenA,
      body: { accountId: '12', alias: '' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(bad.body.error.details.length).toBeGreaterThan(0);
    expect((await call('GET', '/api/v1/scans/not-a-scan', { token: tokenA })).statusCode).toBe(400);
    expect((await call('GET', '/api/v1/nope', { token: tokenA })).statusCode).toBe(404);
    expect((await call('PUT', '/api/v1/accounts', { token: tokenA })).statusCode).toBe(405);
    const mismatch = await call('POST', '/api/v1/accounts/123456789012/verify', {
      token: tokenA,
      body: { roleArn: 'arn:aws:iam::210987654321:role/CloudSentryReadOnlyRole' },
    });
    expect(mismatch.statusCode).toBe(400);
  });

  it('enforces roles: VIEWER can read but not mutate', async () => {
    expect((await call('GET', '/api/v1/accounts', { token: viewerToken })).statusCode).toBe(200);
    expect(
      (
        await call('POST', '/api/v1/accounts', {
          token: viewerToken,
          body: { accountId: '111122223333', alias: 'x' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call('POST', '/api/v1/accounts/123456789012/scans', { token: viewerToken, body: {} }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call('PUT', '/api/v1/settings/detection', {
          token: viewerToken,
          body: { lookbackDays: 30, ignoreTagKey: 'x', rules: {} },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('isolates tenants at the API boundary', async () => {
    expect((await call('GET', '/api/v1/accounts/123456789012', { token: tokenB })).statusCode).toBe(404);
    expect((await call('DELETE', '/api/v1/accounts/123456789012', { token: tokenB })).statusCode).toBe(404);
    expect(
      (await call('POST', '/api/v1/accounts/123456789012/verify', { token: tokenB, body: {} })).statusCode,
    ).toBe(404);
    expect((await call('GET', '/api/v1/accounts', { token: tokenB })).body.data).toEqual([]);
    expect((await call('GET', '/api/v1/accounts', { token: tokenA })).body.data).toHaveLength(1);
  });

  it('verifies, scans and reports through the API with correct status codes', async () => {
    const verified = await call('POST', '/api/v1/accounts/123456789012/verify', { token: tokenA, body: {} });
    expect(verified.body.data.status).toBe('CONNECTED');
    const scan = await call('POST', '/api/v1/accounts/123456789012/scans', {
      token: tokenA,
      body: {},
      headers: { 'idempotency-key': 'abcdefgh-1' },
    });
    expect(scan.statusCode).toBe(202);
    const replay = await call('POST', '/api/v1/accounts/123456789012/scans', {
      token: tokenA,
      body: {},
      headers: { 'idempotency-key': 'abcdefgh-1' },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.body.data.scanId).toBe(scan.body.data.scanId);
    expect(
      (await call('GET', `/api/v1/scans/${scan.body.data.scanId as string}`, { token: tokenB })).statusCode,
    ).toBe(404);
    const report = await call('POST', '/api/v1/reports', { token: tokenA, body: { format: 'PDF' } });
    expect(report.statusCode).toBe(202);
    expect(
      (
        await call('GET', `/api/v1/reports/${report.body.data.reportId as string}/download`, {
          token: tokenA,
        })
      ).statusCode,
    ).toBe(412);
    const rules = await call('GET', '/api/v1/rules', { token: tokenA });
    expect(rules.body.data.map((r: { ruleId: string }) => r.ruleId)).toContain('idle-ec2');
  });
});
