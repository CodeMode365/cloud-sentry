/** SYNTHETIC TEST FIXTURE: SDK-shaped DescribeFileSystems pages. Not real AWS data. */
import type { DescribeFileSystemsCommandOutput } from '@aws-sdk/client-efs';

export const fileSystemsPage1: Partial<DescribeFileSystemsCommandOutput> = {
  NextMarker: 'page-2',
  FileSystems: [
    {
      OwnerId: '111122223333',
      CreationToken: 'fixture-1',
      FileSystemId: 'fs-0aaaaaaaaaaaaaaa1',
      FileSystemArn: 'arn:aws:elasticfilesystem:us-east-1:111122223333:file-system/fs-0aaaaaaaaaaaaaaa1',
      CreationTime: new Date('2025-11-01T00:00:00Z'),
      LifeCycleState: 'available',
      Name: 'fixture-shared',
      NumberOfMountTargets: 2,
      SizeInBytes: {
        Value: 107374182400,
        ValueInStandard: 85899345920,
        ValueInIA: 16106127360,
        ValueInArchive: 5368709120,
      },
      PerformanceMode: 'generalPurpose',
      Encrypted: true,
      ThroughputMode: 'elastic',
      Tags: [{ Key: 'Name', Value: 'ignored-because-name-set' }],
    },
    {
      OwnerId: '111122223333',
      CreationToken: 'fixture-2',
      FileSystemId: 'fs-0aaaaaaaaaaaaaaa2',
      CreationTime: new Date('2026-10-01T00:00:00Z'),
      LifeCycleState: 'available',
      NumberOfMountTargets: 0,
      SizeInBytes: { Value: 6144 },
      PerformanceMode: 'generalPurpose',
      ThroughputMode: 'provisioned',
      ProvisionedThroughputInMibps: 128,
      AvailabilityZoneName: 'us-east-1b',
      Tags: [{ Key: 'Name', Value: 'fixture-one-zone' }],
    },
  ],
};

export const fileSystemsPage2: Partial<DescribeFileSystemsCommandOutput> = {
  FileSystems: [
    {
      OwnerId: '111122223333',
      CreationToken: 'fixture-3',
      FileSystemId: 'fs-0aaaaaaaaaaaaaaa3',
      CreationTime: new Date('2026-03-01T00:00:00Z'),
      LifeCycleState: 'available',
      NumberOfMountTargets: 1,
      SizeInBytes: { Value: 1024 },
      PerformanceMode: 'maxIO',
      Tags: [],
    },
    {
      OwnerId: '111122223333',
      CreationToken: 'fixture-4',
      FileSystemId: 'fs-0aaaaaaaaaaaaaaa4',
      CreationTime: new Date('2026-03-01T00:00:00Z'),
      LifeCycleState: 'deleted',
      NumberOfMountTargets: 0,
      SizeInBytes: { Value: 0 },
      PerformanceMode: 'generalPurpose',
      Tags: [],
    },
  ],
};
