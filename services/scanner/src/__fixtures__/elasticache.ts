/** SYNTHETIC TEST FIXTURE: SDK-shaped DescribeCacheClusters pages. Not real AWS data. */
import type { DescribeCacheClustersCommandOutput } from '@aws-sdk/client-elasticache';

export const cacheClustersPage1: Partial<DescribeCacheClustersCommandOutput> = {
  Marker: 'page-2',
  CacheClusters: [
    {
      CacheClusterId: 'fixture-redis-001',
      ARN: 'arn:aws:elasticache:us-east-1:111122223333:cluster:fixture-redis-001',
      CacheNodeType: 'cache.r6g.large',
      Engine: 'redis',
      EngineVersion: '7.1',
      CacheClusterStatus: 'available',
      NumCacheNodes: 1,
      PreferredAvailabilityZone: 'us-east-1a',
      CacheClusterCreateTime: new Date('2026-02-01T00:00:00Z'),
      ReplicationGroupId: 'fixture-redis',
      SnapshotRetentionLimit: 5,
    },
  ],
};

export const cacheClustersPage2: Partial<DescribeCacheClustersCommandOutput> = {
  CacheClusters: [
    {
      CacheClusterId: 'fixture-memcached',
      CacheNodeType: 'cache.t3.micro',
      Engine: 'memcached',
      CacheClusterStatus: 'modifying',
      NumCacheNodes: 3,
    },
    { CacheNodeType: 'cache.t3.micro' },
  ],
};
