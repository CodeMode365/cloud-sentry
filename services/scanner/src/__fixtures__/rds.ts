/** SYNTHETIC TEST FIXTURE: SDK-shaped DescribeDBInstances pages. Not real AWS data. */
import type { DescribeDBInstancesCommandOutput } from '@aws-sdk/client-rds';

export const rdsInstancesPage1: Partial<DescribeDBInstancesCommandOutput> = {
  Marker: 'page-2',
  DBInstances: [
    {
      DBInstanceIdentifier: 'fixture-db-1',
      DBInstanceArn: 'arn:aws:rds:us-east-1:111122223333:db:fixture-db-1',
      Engine: 'postgres',
      EngineVersion: '16.4',
      DBInstanceClass: 'db.m5.large',
      DBInstanceStatus: 'available',
      AllocatedStorage: 100,
      StorageType: 'gp3',
      AvailabilityZone: 'us-east-1a',
      MultiAZ: true,
      PubliclyAccessible: false,
      StorageEncrypted: true,
      LicenseModel: 'postgresql-license',
      InstanceCreateTime: new Date('2026-01-10T12:00:00Z'),
      TagList: [{ Key: 'Environment', Value: 'staging' }],
    },
  ],
};

export const rdsInstancesPage2: Partial<DescribeDBInstancesCommandOutput> = {
  DBInstances: [
    {
      DBInstanceIdentifier: 'fixture-db-2',
      Engine: 'mysql',
      DBInstanceClass: 'db.t3.micro',
      DBInstanceStatus: 'stopped',
      AllocatedStorage: 20,
      MultiAZ: false,
      PubliclyAccessible: true,
      StorageEncrypted: false,
      DBClusterIdentifier: undefined,
      TagList: [{ Key: 'Name', Value: 'fixture-mysql' }],
    },
  ],
};
