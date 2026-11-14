import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  BackupClient,
  ListBackupVaultsCommand,
  ListRecoveryPointsByBackupVaultCommand,
} from '@aws-sdk/client-backup';
import {
  BACKUP_FIXTURE_NOW,
  backupVaultsPage1,
  backupVaultsPage2,
  recoveryPoint,
  recoveryPointsPage1,
  recoveryPointsPage2,
} from '../__fixtures__/backup';
import {
  ageBucketFor,
  discoverBackupVaults,
  listRecoveryPoints,
  MULTIPLE_PLANS_CAP,
  RECOVERY_POINT_CAP,
  summarizeRecoveryPoints,
} from './backup-vaults';
import { awsError, captureLogger, warnings } from './test-helpers';

const backupMock = mockClient(BackupClient);
const client = () => new BackupClient({ region: 'us-east-1' });
const ctx = { accountId: '111122223333', region: 'us-east-1', now: BACKUP_FIXTURE_NOW };
const ages = (minDays: number[], counts: number[], bytes: number[]) =>
  minDays.map((m, i) => ({ minDays: m, count: counts[i], bytes: bytes[i] }));
const BUCKETS = [0, 30, 90, 180, 365, 730];

beforeEach(() => backupMock.reset());

describe('ageBucketFor', () => {
  it('maps ages to non-cumulative lower bounds', () => {
    expect(ageBucketFor(-1)).toBe(0);
    expect(ageBucketFor(29.99)).toBe(0);
    expect(ageBucketFor(30)).toBe(30);
    expect(ageBucketFor(364)).toBe(180);
    expect(ageBucketFor(365)).toBe(365);
    expect(ageBucketFor(5000)).toBe(730);
  });
});

describe('discoverBackupVaults', () => {
  it('paginates vaults and recovery points, builds age buckets and multiple-plan resources', async () => {
    backupMock.on(ListBackupVaultsCommand).resolvesOnce(backupVaultsPage1).resolvesOnce(backupVaultsPage2);
    backupMock
      .on(ListRecoveryPointsByBackupVaultCommand, { BackupVaultName: 'fixture-vault' })
      .resolvesOnce({ RecoveryPoints: recoveryPointsPage1, NextToken: 'rp-2' })
      .resolvesOnce({ RecoveryPoints: recoveryPointsPage2 });
    backupMock
      .on(ListRecoveryPointsByBackupVaultCommand, { BackupVaultName: 'fixture-denied-vault' })
      .rejects(awsError('AccessDeniedException'));
    const { logger, lines } = captureLogger();

    const result = await discoverBackupVaults(client(), { ...ctx, logger });

    expect(backupMock.commandCalls(ListBackupVaultsCommand)[1]?.args[0].input.NextToken).toBe('vaults-2');
    const rpCalls = backupMock
      .commandCalls(ListRecoveryPointsByBackupVaultCommand)
      .filter((c) => c.args[0].input.BackupVaultName === 'fixture-vault');
    expect(rpCalls).toHaveLength(2);
    expect(rpCalls[1]?.args[0].input.NextToken).toBe('rp-2');

    expect(result.map((r) => r.resourceId)).toEqual(['fixture-vault', 'fixture-denied-vault']);
    const [vault, denied] = result;
    expect(vault).toMatchObject({
      resourceType: 'BACKUP_VAULT',
      arn: 'arn:aws:backup:us-east-1:111122223333:backup-vault:fixture-vault',
      name: 'fixture-vault',
      state: 'active',
      tags: {},
      createdAt: '2024-06-01T00:00:00.000Z',
    });
    expect(vault?.attributes).toEqual({
      vaultName: 'fixture-vault',
      locked: true,
      truncated: false,
      recoveryPointCount: 8,
      totalBytes: 100 + 200 + 300 + 400 + 1000 + 5 + 50,
      oldestRecoveryPointAt: '2024-09-05T00:00:00.000Z', // 800 days before 2026-11-14
      byResourceType: [
        {
          resourceType: 'EBS',
          count: 6,
          bytes: 1050,
          byAge: ages(BUCKETS, [4, 2, 0, 0, 0, 0], [350, 700, 0, 0, 0, 0]),
        },
        {
          resourceType: 'EFS',
          count: 1,
          bytes: 5,
          byAge: ages(BUCKETS, [0, 0, 0, 0, 0, 1], [0, 0, 0, 0, 0, 5]),
        },
        {
          resourceType: 'RDS',
          count: 1,
          bytes: 1000,
          byAge: ages(BUCKETS, [0, 0, 0, 0, 1, 0], [0, 0, 0, 0, 1000, 0]),
        },
      ],
      resourcesWithMultiplePlans: [
        {
          resourceArn: 'arn:aws:ec2:us-east-1:111122223333:volume/vol-1',
          resourceType: 'EBS',
          planIds: ['plan-daily', 'plan-weekly'],
        },
      ],
    });
    expect(denied).toMatchObject({
      arn: 'arn:aws:backup:us-east-1:111122223333:backup-vault:fixture-denied-vault',
      attributes: {
        locked: false,
        truncated: true,
        recoveryPointCount: 0,
        totalBytes: 0,
        oldestRecoveryPointAt: null,
        byResourceType: [],
        resourcesWithMultiplePlans: [],
      },
    });
    expect(warnings(lines).map((w) => w.vaultName)).toEqual(['fixture-denied-vault']);
  });
});

describe('discoverBackupVaults failure handling', () => {
  it('reports a vault whose recovery points cannot be listed as state unknown, not as empty', async () => {
    backupMock.on(ListBackupVaultsCommand).resolves({
      BackupVaultList: [
        {
          BackupVaultName: 'ok-vault',
          BackupVaultArn: 'arn:aws:backup:us-east-1:111122223333:backup-vault:ok-vault',
        },
        {
          BackupVaultName: 'denied-vault',
          BackupVaultArn: 'arn:aws:backup:us-east-1:111122223333:backup-vault:denied-vault',
        },
      ],
    });
    backupMock
      .on(ListRecoveryPointsByBackupVaultCommand, { BackupVaultName: 'ok-vault' })
      .resolves({ RecoveryPoints: [] })
      .on(ListRecoveryPointsByBackupVaultCommand, { BackupVaultName: 'denied-vault' })
      .rejects(awsError('AccessDeniedException'));
    const out = await discoverBackupVaults(client(), ctx);
    const byName = Object.fromEntries(out.map((v) => [v.resourceId, v]));
    expect(byName['ok-vault']).toMatchObject({
      state: 'active',
      attributes: { truncated: false, recoveryPointCount: 0 },
    });
    expect(byName['denied-vault']).toMatchObject({
      state: 'unknown',
      attributes: { truncated: true, recoveryPointCount: 0 },
    });
  });
});

describe('listRecoveryPoints', () => {
  const page = (offset: number, size: number) =>
    Array.from({ length: size }, (_, i) =>
      recoveryPoint(`arn:aws:ec2:us-east-1:111122223333:volume/vol-${offset + i}`, 'EBS', 1, 1, 'plan-daily'),
    );

  it(`stops at ${RECOVERY_POINT_CAP} points and marks the vault truncated`, async () => {
    const mock = backupMock.on(ListRecoveryPointsByBackupVaultCommand);
    for (let p = 0; p < 6; p++)
      mock.resolvesOnce({ RecoveryPoints: page(p * 1000, 1000), NextToken: `t${p + 1}` });

    const { points, truncated } = await listRecoveryPoints(client(), 'big-vault');

    expect(points).toHaveLength(RECOVERY_POINT_CAP);
    expect(truncated).toBe(true);
    expect(backupMock.commandCalls(ListRecoveryPointsByBackupVaultCommand)).toHaveLength(5);
    expect(backupMock.commandCalls(ListRecoveryPointsByBackupVaultCommand)[0]?.args[0].input.MaxResults).toBe(
      1000,
    );
  });

  it('is not truncated when the last page ends exactly at the cap', async () => {
    backupMock
      .on(ListRecoveryPointsByBackupVaultCommand)
      .resolvesOnce({ RecoveryPoints: page(0, 3), NextToken: 'n' })
      .resolvesOnce({ RecoveryPoints: page(3, 2) });
    const exact = await listRecoveryPoints(client(), 'vault', 5);
    expect(exact).toMatchObject({ truncated: false });
    expect(exact.points).toHaveLength(5);

    backupMock.reset();
    backupMock.on(ListRecoveryPointsByBackupVaultCommand).resolvesOnce({ RecoveryPoints: page(0, 7) });
    const cut = await listRecoveryPoints(client(), 'vault', 5);
    expect(cut.truncated).toBe(true);
    expect(cut.points).toHaveLength(5);
  });
});

describe('summarizeRecoveryPoints', () => {
  it(`caps resourcesWithMultiplePlans at ${MULTIPLE_PLANS_CAP}, sorted by ARN`, () => {
    const points = Array.from({ length: 60 }, (_, i) => {
      const arn = `arn:aws:dynamodb:us-east-1:111122223333:table/t${String(i).padStart(2, '0')}`;
      return [
        recoveryPoint(arn, 'DynamoDB', 1, 10, 'plan-a'),
        recoveryPoint(arn, 'DynamoDB', 2, 10, 'plan-b'),
      ];
    }).flat();
    const summary = summarizeRecoveryPoints(points, BACKUP_FIXTURE_NOW);
    expect(summary.resourcesWithMultiplePlans).toHaveLength(MULTIPLE_PLANS_CAP);
    expect(summary.resourcesWithMultiplePlans[0]?.resourceArn).toMatch(/table\/t00$/);
    expect(summary.resourcesWithMultiplePlans[49]?.resourceArn).toMatch(/table\/t49$/);
  });

  it('puts points without CreationDate in the youngest bucket and returns null oldest for no points', () => {
    const point = { ...recoveryPoint('arn:x', 'EBS', 1, 7, undefined), CreationDate: undefined };
    const summary = summarizeRecoveryPoints([point], BACKUP_FIXTURE_NOW);
    expect(summary.oldestRecoveryPointAt).toBeNull();
    expect(summary.byResourceType[0]?.byAge[0]).toEqual({ minDays: 0, count: 1, bytes: 7 });
    expect(summarizeRecoveryPoints([], BACKUP_FIXTURE_NOW)).toEqual({
      recoveryPointCount: 0,
      totalBytes: 0,
      oldestRecoveryPointAt: null,
      byResourceType: [],
      resourcesWithMultiplePlans: [],
    });
  });
});
