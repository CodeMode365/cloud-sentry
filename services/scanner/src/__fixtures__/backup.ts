/** SYNTHETIC TEST FIXTURE: SDK-shaped AWS Backup responses. Not real AWS data. */
import type {
  GetBackupPlanCommandOutput,
  ListBackupPlansCommandOutput,
  ListBackupVaultsCommandOutput,
  RecoveryPointByBackupVault,
} from '@aws-sdk/client-backup';

export const backupPlansPage1: Partial<ListBackupPlansCommandOutput> = {
  NextToken: 'plans-2',
  BackupPlansList: [
    {
      BackupPlanId: 'plan-daily',
      BackupPlanArn: 'arn:aws:backup:us-east-1:111122223333:backup-plan:plan-daily',
      BackupPlanName: 'fixture-daily',
      VersionId: 'v1',
      CreationDate: new Date('2025-01-01T00:00:00Z'),
      LastExecutionDate: new Date('2026-11-13T05:00:00Z'),
    },
  ],
};

export const backupPlansPage2: Partial<ListBackupPlansCommandOutput> = {
  BackupPlansList: [
    { BackupPlanId: 'plan-denied', BackupPlanName: 'fixture-denied', VersionId: 'v9' },
    { BackupPlanId: 'plan-gone', BackupPlanName: 'fixture-gone' },
  ],
};

export const dailyPlanDetails: Partial<GetBackupPlanCommandOutput> = {
  BackupPlanId: 'plan-daily',
  VersionId: 'v1',
  BackupPlan: {
    BackupPlanName: 'fixture-daily',
    Rules: [
      {
        RuleName: 'daily-35d',
        TargetBackupVaultName: 'fixture-vault',
        ScheduleExpression: 'cron(0 5 ? * * *)',
        Lifecycle: { DeleteAfterDays: 35, MoveToColdStorageAfterDays: 7 },
        CopyActions: [{ DestinationBackupVaultArn: 'arn:aws:backup:eu-west-1:111122223333:backup-vault:dr' }],
      },
      { RuleName: 'monthly-forever', TargetBackupVaultName: 'fixture-vault' },
    ],
  },
};

export const backupVaultsPage1: Partial<ListBackupVaultsCommandOutput> = {
  NextToken: 'vaults-2',
  BackupVaultList: [
    {
      BackupVaultName: 'fixture-vault',
      BackupVaultArn: 'arn:aws:backup:us-east-1:111122223333:backup-vault:fixture-vault',
      CreationDate: new Date('2024-06-01T00:00:00Z'),
      NumberOfRecoveryPoints: 8,
      Locked: true,
    },
  ],
};

export const backupVaultsPage2: Partial<ListBackupVaultsCommandOutput> = {
  BackupVaultList: [{ BackupVaultName: 'fixture-denied-vault' }],
};

/** Reference time for the recovery point ages below. */
export const BACKUP_FIXTURE_NOW = new Date('2026-11-14T00:00:00Z');

const daysAgo = (days: number) => new Date(BACKUP_FIXTURE_NOW.getTime() - days * 86_400_000);
const vol = (id: string) => `arn:aws:ec2:us-east-1:111122223333:volume/${id}`;

export function recoveryPoint(
  resourceArn: string,
  resourceType: string,
  ageDays: number,
  bytes: number | undefined,
  planId: string | undefined,
): RecoveryPointByBackupVault {
  return {
    RecoveryPointArn: `arn:aws:backup:us-east-1:111122223333:recovery-point:${resourceType}-${ageDays}-${planId ?? 'od'}`,
    BackupVaultName: 'fixture-vault',
    ResourceArn: resourceArn,
    ResourceType: resourceType,
    CreatedBy: planId ? { BackupPlanId: planId } : {},
    Status: 'COMPLETED',
    CreationDate: daysAgo(ageDays),
    BackupSizeInBytes: bytes,
  };
}

/** Page 1 of fixture-vault's recovery points. */
export const recoveryPointsPage1: RecoveryPointByBackupVault[] = [
  recoveryPoint(vol('vol-1'), 'EBS', 10, 100, 'plan-daily'),
  recoveryPoint(vol('vol-1'), 'EBS', 20, 200, 'plan-weekly'), // vol-1: two plans within 35 days
  recoveryPoint(vol('vol-2'), 'EBS', 30, 300, 'plan-daily'), // exactly 30 days -> bucket 30
  recoveryPoint(vol('vol-2'), 'EBS', 40, 400, 'plan-weekly'), // second plan outside the 35-day window
];

/** Page 2 of fixture-vault's recovery points. */
export const recoveryPointsPage2: RecoveryPointByBackupVault[] = [
  recoveryPoint('arn:aws:rds:us-east-1:111122223333:db:fixture-db', 'RDS', 400, 1000, 'plan-daily'),
  recoveryPoint('arn:aws:elasticfilesystem:us-east-1:111122223333:file-system/fs-1', 'EFS', 800, 5, 'plan-daily'),
  recoveryPoint(vol('vol-3'), 'EBS', 5, undefined, 'plan-daily'),
  recoveryPoint(vol('vol-3'), 'EBS', 6, 50, undefined), // on-demand backup: no plan
];
