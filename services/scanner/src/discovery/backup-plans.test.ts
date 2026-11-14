import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { BackupClient, GetBackupPlanCommand, ListBackupPlansCommand } from '@aws-sdk/client-backup';
import { backupPlansPage1, backupPlansPage2, dailyPlanDetails } from '../__fixtures__/backup';
import { discoverBackupPlans } from './backup-plans';
import { awsError, captureLogger, warnings } from './test-helpers';

const backupMock = mockClient(BackupClient);

beforeEach(() => backupMock.reset());

describe('discoverBackupPlans', () => {
  it('paginates plans, maps rules from GetBackupPlan, degrades failures and skips deleted plans', async () => {
    backupMock.on(ListBackupPlansCommand).resolvesOnce(backupPlansPage1).resolvesOnce(backupPlansPage2);
    backupMock.on(GetBackupPlanCommand, { BackupPlanId: 'plan-daily' }).resolves(dailyPlanDetails);
    backupMock
      .on(GetBackupPlanCommand, { BackupPlanId: 'plan-denied' })
      .rejects(awsError('AccessDeniedException'));
    backupMock
      .on(GetBackupPlanCommand, { BackupPlanId: 'plan-gone' })
      .rejects(awsError('ResourceNotFoundException'));
    const { logger, lines } = captureLogger();

    const result = await discoverBackupPlans(new BackupClient({ region: 'us-east-1' }), {
      accountId: '111122223333',
      region: 'us-east-1',
      logger,
    });

    expect(backupMock.commandCalls(ListBackupPlansCommand)[1]?.args[0].input.NextToken).toBe('plans-2');
    expect(
      backupMock.commandCalls(GetBackupPlanCommand).find((c) => c.args[0].input.BackupPlanId === 'plan-daily')
        ?.args[0].input.VersionId,
    ).toBe('v1');
    expect(result.map((r) => r.resourceId)).toEqual(['plan-daily', 'plan-denied']);
    expect(result[0]).toEqual({
      resourceType: 'BACKUP_PLAN',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceId: 'plan-daily',
      arn: 'arn:aws:backup:us-east-1:111122223333:backup-plan:plan-daily',
      name: 'fixture-daily',
      state: 'active',
      tags: {},
      createdAt: '2025-01-01T00:00:00.000Z',
      attributes: {
        backupPlanId: 'plan-daily',
        backupPlanName: 'fixture-daily',
        versionId: 'v1',
        lastExecutionDate: '2026-11-13T05:00:00.000Z',
        rules: [
          {
            ruleName: 'daily-35d',
            targetVaultName: 'fixture-vault',
            scheduleExpression: 'cron(0 5 ? * * *)',
            deleteAfterDays: 35,
            moveToColdStorageAfterDays: 7,
            copyActionCount: 1,
          },
          {
            ruleName: 'monthly-forever',
            targetVaultName: 'fixture-vault',
            scheduleExpression: null,
            deleteAfterDays: null,
            moveToColdStorageAfterDays: null,
            copyActionCount: 0,
          },
        ],
      },
    });
    expect(result[1]).toMatchObject({
      name: 'fixture-denied',
      arn: 'arn:aws:backup:us-east-1:111122223333:backup-plan:plan-denied',
      attributes: { versionId: 'v9', lastExecutionDate: null, rules: [] },
    });
    expect(warnings(lines).map((w) => w.backupPlanId)).toEqual(['plan-denied']);
  });
});
