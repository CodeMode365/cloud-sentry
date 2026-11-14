import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DescribeClustersCommand, RedshiftClient } from '@aws-sdk/client-redshift';
import { redshiftClustersPage1, redshiftClustersPage2 } from '../__fixtures__/redshift';
import { discoverRedshiftClusters } from './redshift-clusters';

const redshiftMock = mockClient(RedshiftClient);

beforeEach(() => redshiftMock.reset());

describe('discoverRedshiftClusters', () => {
  it('follows Marker pagination and maps fields', async () => {
    redshiftMock
      .on(DescribeClustersCommand)
      .resolvesOnce(redshiftClustersPage1)
      .resolvesOnce(redshiftClustersPage2);
    const result = await discoverRedshiftClusters(new RedshiftClient({ region: 'us-east-1' }), {
      accountId: '111122223333',
      region: 'us-east-1',
    });

    expect(redshiftMock.commandCalls(DescribeClustersCommand)[1]?.args[0].input.Marker).toBe('page-2');
    expect(result[0]).toEqual({
      resourceType: 'REDSHIFT_CLUSTER',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceId: 'fixture-warehouse',
      arn: 'arn:aws:redshift:us-east-1:111122223333:cluster:fixture-warehouse',
      name: 'fixture-warehouse',
      state: 'available',
      tags: { team: 'analytics' },
      createdAt: '2025-03-01T00:00:00.000Z',
      attributes: {
        clusterIdentifier: 'fixture-warehouse',
        nodeType: 'ra3.xlplus',
        numberOfNodes: 2,
        clusterStatus: 'available',
        availabilityStatus: 'Available',
        encrypted: true,
        multiAz: true,
        automatedSnapshotRetentionPeriod: 7,
      },
    });
    expect(result[1]).toMatchObject({
      state: 'paused',
      tags: {},
      attributes: {
        clusterStatus: 'paused',
        availabilityStatus: null,
        encrypted: false,
        multiAz: null,
        automatedSnapshotRetentionPeriod: null,
      },
    });
  });
});
