import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DescribeFileSystemsCommand,
  DescribeLifecycleConfigurationCommand,
  EFSClient,
} from '@aws-sdk/client-efs';
import { fileSystemsPage1, fileSystemsPage2 } from '../__fixtures__/efs';
import { discoverEfsFileSystems } from './efs-file-systems';
import { awsError, captureLogger, warnings } from './test-helpers';

const efsMock = mockClient(EFSClient);

beforeEach(() => efsMock.reset());

describe('discoverEfsFileSystems', () => {
  it('paginates, excludes deleted file systems, maps sizes and lifecycle, and degrades a failed lifecycle call', async () => {
    efsMock.on(DescribeFileSystemsCommand).resolvesOnce(fileSystemsPage1).resolvesOnce(fileSystemsPage2);
    efsMock.on(DescribeLifecycleConfigurationCommand, { FileSystemId: 'fs-0aaaaaaaaaaaaaaa1' }).resolves({
      LifecyclePolicies: [
        { TransitionToIA: 'AFTER_30_DAYS' },
        { TransitionToPrimaryStorageClass: 'AFTER_1_ACCESS' },
        { TransitionToArchive: 'AFTER_90_DAYS' },
      ],
    });
    efsMock
      .on(DescribeLifecycleConfigurationCommand, { FileSystemId: 'fs-0aaaaaaaaaaaaaaa2' })
      .resolves({ LifecyclePolicies: [] });
    efsMock
      .on(DescribeLifecycleConfigurationCommand, { FileSystemId: 'fs-0aaaaaaaaaaaaaaa3' })
      .rejects(awsError('InternalServerError'));
    const { logger, lines } = captureLogger();

    const result = await discoverEfsFileSystems(new EFSClient({ region: 'us-east-1' }), {
      accountId: '111122223333',
      region: 'us-east-1',
      logger,
    });

    expect(efsMock.commandCalls(DescribeFileSystemsCommand)[1]?.args[0].input.Marker).toBe('page-2');
    expect(efsMock.commandCalls(DescribeLifecycleConfigurationCommand)).toHaveLength(3);
    expect(result.map((r) => r.resourceId)).toEqual([
      'fs-0aaaaaaaaaaaaaaa1',
      'fs-0aaaaaaaaaaaaaaa2',
      'fs-0aaaaaaaaaaaaaaa3',
    ]);
    expect(result[0]).toEqual({
      resourceType: 'EFS_FILE_SYSTEM',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceId: 'fs-0aaaaaaaaaaaaaaa1',
      arn: 'arn:aws:elasticfilesystem:us-east-1:111122223333:file-system/fs-0aaaaaaaaaaaaaaa1',
      name: 'fixture-shared',
      state: 'available',
      tags: { Name: 'ignored-because-name-set' },
      createdAt: '2025-11-01T00:00:00.000Z',
      attributes: {
        fileSystemId: 'fs-0aaaaaaaaaaaaaaa1',
        performanceMode: 'generalPurpose',
        throughputMode: 'elastic',
        provisionedThroughputMibps: null,
        sizeBytesTotal: 107374182400,
        sizeBytesStandard: 85899345920,
        sizeBytesInfrequentAccess: 16106127360,
        sizeBytesArchive: 5368709120,
        numberOfMountTargets: 2,
        encrypted: true,
        availabilityZoneName: null,
        lifecycle: {
          transitionToIA: 'AFTER_30_DAYS',
          transitionToArchive: 'AFTER_90_DAYS',
          transitionToPrimary: 'AFTER_1_ACCESS',
        },
      },
    });
    expect(result[1]).toMatchObject({
      name: 'fixture-one-zone',
      arn: 'arn:aws:elasticfilesystem:us-east-1:111122223333:file-system/fs-0aaaaaaaaaaaaaaa2',
      attributes: {
        throughputMode: 'provisioned',
        provisionedThroughputMibps: 128,
        sizeBytesTotal: 6144,
        sizeBytesStandard: 0,
        numberOfMountTargets: 0,
        encrypted: false,
        availabilityZoneName: 'us-east-1b',
        lifecycle: { transitionToIA: null, transitionToArchive: null, transitionToPrimary: null },
      },
    });
    expect(result[2]).toMatchObject({ name: null, attributes: { lifecycle: null } });
    expect(warnings(lines).map((w) => w.fileSystemId)).toEqual(['fs-0aaaaaaaaaaaaaaa3']);
  });
});
