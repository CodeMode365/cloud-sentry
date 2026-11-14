import { App } from 'aws-cdk-lib';
import { CUSTOMER_ROLE_PERMISSION_STATEMENTS } from '@cloudsentry/shared-types';
import { describe, expect, it } from 'vitest';
import { HANDLERS } from '../constructs/handlers';
import { loadEnvironment } from '../environments';
import { customerRoleActions, customerRoleTemplate } from '../policies/customer-role';

describe('environment loader', () => {
  it('defaults to dev and reads the account from the CDK CLI', () => {
    const config = loadEnvironment(new App(), { CDK_DEFAULT_ACCOUNT: '111111111111' });
    expect(config.stage).toBe('dev');
    expect(config.account).toBe('111111111111');
    expect(config.region).toBe('us-east-1');
  });

  it('requires an explicit account for prod', () => {
    const app = new App({ context: { stage: 'prod' } });
    expect(() => loadEnvironment(app, { CDK_DEFAULT_ACCOUNT: '111111111111' })).toThrow(
      /CLOUDSENTRY_ACCOUNT/,
    );
    const config = loadEnvironment(app, { CLOUDSENTRY_ACCOUNT: '222222222222' });
    expect(config.deletionProtection).toBe(true);
    expect(config.pointInTimeRecovery).toBe(true);
  });

  it('rejects unknown stages and half-configured custom domains', () => {
    expect(() => loadEnvironment(new App({ context: { stage: 'qa' } }), {})).toThrow(/Unknown stage/);
    expect(() => loadEnvironment(new App(), { CLOUDSENTRY_WEB_DOMAIN: 'app.example.com' })).toThrow(
      /together/,
    );
  });
});

describe('customer role template', () => {
  const template = customerRoleTemplate({ trustedAccountId: '123456789012', externalId: 'cs-test' });
  const role = (template.Resources as Record<string, { Properties: Record<string, unknown> }>)
    .CloudSentryReadOnlyRole!;

  it('trusts only the platform account with the external ID condition', () => {
    const trust = role.Properties.AssumeRolePolicyDocument as { Statement: Record<string, unknown>[] };
    expect(trust.Statement).toHaveLength(1);
    expect(trust.Statement[0]).toMatchObject({
      Effect: 'Allow',
      Action: 'sts:AssumeRole',
      Condition: { StringEquals: { 'sts:ExternalId': { Ref: 'ExternalId' } } },
    });
  });

  it('grants exactly the shared read-only permission set', () => {
    const expected = CUSTOMER_ROLE_PERMISSION_STATEMENTS.flatMap((s) => [...s.Action]);
    expect(customerRoleActions()).toEqual(expected);
    for (const action of expected) {
      expect(action).toMatch(/:(Describe|Get|List)[A-Za-z]+$/);
    }
  });
});

describe('handler manifest', () => {
  it('uses unique function ids that fit Lambda name limits', () => {
    const ids = Object.values(HANDLERS).map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(`cloudsentry-staging-${id}`.length).toBeLessThanOrEqual(64);
  });
});
