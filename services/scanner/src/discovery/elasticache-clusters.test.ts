import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DescribeCacheClustersCommand, ElastiCacheClient } from '@aws-sdk/client-elasticache';
import {
  GetResourcesCommand,
  ResourceGroupsTaggingAPIClient,
} from '@aws-sdk/client-resource-groups-tagging-api';
import { cacheClustersPage1, cacheClustersPage2 } from '../__fixtures__/elasticache';
import { discoverElastiCacheClusters } from './elasticache-clusters';
import { awsError, captureLogger, warnings } from './test-helpers';

const cacheMock = mockClient(ElastiCacheClient);
const taggingMock = mockClient(ResourceGroupsTaggingAPIClient);
const ctx = { accountId: '111122223333', region: 'us-east-1' };
const run = (logger = captureLogger().logger) =>
  discoverElastiCacheClusters(
    new ElastiCacheClient({ region: 'us-east-1' }),
    new ResourceGroupsTaggingAPIClient({ region: 'us-east-1' }),
    { ...ctx, logger },
  );

beforeEach(() => {
  cacheMock.reset();
  taggingMock.reset();
});

describe('discoverElastiCacheClusters', () => {
  it('follows Marker pagination, maps fields and joins tags by ARN', async () => {
    cacheMock.on(DescribeCacheClustersCommand).resolvesOnce(cacheClustersPage1).resolvesOnce(cacheClustersPage2);
    taggingMock.on(GetResourcesCommand).resolves({
      ResourceTagMappingList: [
        {
          ResourceARN: 'arn:aws:elasticache:us-east-1:111122223333:cluster:fixture-redis-001',
          Tags: [{ Key: 'env', Value: 'prod' }],
        },
      ],
    });

    const result = await run();

    expect(cacheMock.commandCalls(DescribeCacheClustersCommand)[1]?.args[0].input.Marker).toBe('page-2');
    expect(taggingMock.commandCalls(GetResourcesCommand)[0]?.args[0].input.ResourceTypeFilters).toEqual([
      'elasticache:cluster',
    ]);
    expect(result.map((r) => r.resourceId)).toEqual(['fixture-redis-001', 'fixture-memcached']);
    expect(result[0]).toEqual({
      resourceType: 'ELASTICACHE_CLUSTER',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceId: 'fixture-redis-001',
      arn: 'arn:aws:elasticache:us-east-1:111122223333:cluster:fixture-redis-001',
      name: 'fixture-redis-001',
      state: 'available',
      tags: { env: 'prod' },
      createdAt: '2026-02-01T00:00:00.000Z',
      attributes: {
        cacheClusterId: 'fixture-redis-001',
        engine: 'redis',
        engineVersion: '7.1',
        cacheNodeType: 'cache.r6g.large',
        numCacheNodes: 1,
        replicationGroupId: 'fixture-redis',
        preferredAvailabilityZone: 'us-east-1a',
        snapshotRetentionLimit: 5,
      },
    });
    expect(result[1]).toMatchObject({
      arn: 'arn:aws:elasticache:us-east-1:111122223333:cluster:fixture-memcached',
      state: 'modifying',
      tags: {},
      createdAt: null,
      attributes: {
        engine: 'memcached',
        numCacheNodes: 3,
        engineVersion: null,
        replicationGroupId: null,
        snapshotRetentionLimit: null,
      },
    });
  });

  it('continues with empty tags when the Tagging API fails', async () => {
    cacheMock.on(DescribeCacheClustersCommand).resolves(cacheClustersPage1);
    taggingMock.on(GetResourcesCommand).rejects(awsError('ThrottlingException'));
    const { logger, lines } = captureLogger();
    const result = await run(logger);
    expect(result).toHaveLength(1);
    expect(result[0]?.tags).toEqual({});
    expect(warnings(lines)).toHaveLength(1);
  });
});
