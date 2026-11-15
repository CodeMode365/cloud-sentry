import { describe, expect, it } from 'vitest';
import {
  createAccountRequestSchema,
  createScheduleRequestSchema,
  parseRoleArn,
  passwordSchema,
  roleArnMatchesAccount,
  roleArnSchema,
  validateEventBridgeCron,
} from './index';

describe('AWS identifiers', () => {
  it('validates account IDs and defaults the role name', () => {
    const ok = createAccountRequestSchema.parse({ accountId: '123456789012', alias: 'prod' });
    expect(ok.roleName).toBe('CloudSentryReadOnlyRole');
    expect(ok.regions).toEqual(['us-east-1']);
    expect(createAccountRequestSchema.safeParse({ accountId: '1234', alias: 'x' }).success).toBe(false);
    expect(
      createAccountRequestSchema.safeParse({ accountId: '123456789012', alias: 'x', roleName: 'Admin' })
        .success,
    ).toBe(false);
  });

  it('parses role ARNs and verifies the account', () => {
    const arn = 'arn:aws:iam::123456789012:role/path/CloudSentryReadOnlyRole';
    expect(parseRoleArn(arn)).toEqual({
      accountId: '123456789012',
      path: '/path/',
      roleName: 'CloudSentryReadOnlyRole',
    });
    expect(roleArnMatchesAccount(arn, '123456789012')).toBe(true);
    expect(roleArnMatchesAccount(arn, '210987654321')).toBe(false);
    expect(
      roleArnSchema.safeParse('arn:aws:iam::123456789012:role/OrganizationAccountAccessRole').success,
    ).toBe(false);
    expect(roleArnSchema.safeParse('arn:aws:iam::123456789012:user/CloudSentry').success).toBe(false);
  });
});

describe('schedules', () => {
  it('validates EventBridge cron expressions', () => {
    expect(validateEventBridgeCron('cron(0 2 * * ? *)')).toBeNull();
    expect(validateEventBridgeCron('cron(0 2 ? * MON-FRI *)')).toBeNull();
    expect(validateEventBridgeCron('cron(0 2 * * * *)')).toMatch(/Exactly one/);
    expect(validateEventBridgeCron('cron(* * * * ? *)')).toMatch(/every minute/);
    expect(validateEventBridgeCron('0 2 * * *')).toMatch(/cron\(/);
  });

  it('requires cronExpression for CUSTOM frequency and validates timezone', () => {
    expect(
      createScheduleRequestSchema.safeParse({ accountId: '123456789012', frequency: 'CUSTOM' }).success,
    ).toBe(false);
    expect(
      createScheduleRequestSchema.safeParse({
        accountId: '123456789012',
        frequency: 'DAILY',
        timezone: 'Mars/Base',
      }).success,
    ).toBe(false);
    const parsed = createScheduleRequestSchema.parse({
      accountId: '123456789012',
      frequency: 'WEEKLY',
      timezone: 'Asia/Kathmandu',
    });
    expect(parsed).toMatchObject({ hour: 2, minute: 0, dayOfWeek: 2, enabled: true });
  });
});

describe('passwords', () => {
  it('enforces the password policy', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('alllowercaseletters1!').success).toBe(false);
    expect(passwordSchema.safeParse('Correct-Horse-9-Battery').success).toBe(true);
  });
});

describe('environment parsing', () => {
  it('treats empty values as unset', async () => {
    const { apiEnvSchema, parseEnv } = await import('./index');
    const env = parseEnv(apiEnvSchema, { TABLE_NAME: 't', PLATFORM_ACCOUNT_ID: '', STATE_MACHINE_ARN: '' });
    expect(env.PLATFORM_ACCOUNT_ID).toBeUndefined();
    expect(env.STATE_MACHINE_ARN).toBeUndefined();
    expect(() => parseEnv(apiEnvSchema, { TABLE_NAME: 't', PLATFORM_ACCOUNT_ID: '123' })).toThrow(
      /PLATFORM_ACCOUNT_ID/,
    );
  });
});
