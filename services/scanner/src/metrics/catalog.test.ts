import { describe, expect, it } from 'vitest';
import {
  backupVault,
  cloudFrontDistribution,
  dynamoDbTable,
  efsFileSystem,
  eksCluster,
  elastiCacheCluster,
  lambdaFunction,
  redshiftCluster,
} from '../__fixtures__/resources';
import {
  metricQueriesFor,
  metricsRegionFor,
  provisionedConcurrencyMetricKey,
  qualifiesForMetrics,
} from './catalog';

const keys = (r: Parameters<typeof metricQueriesFor>[0]) => metricQueriesFor(r).map((q) => q.key);

describe('metric catalog for extended types', () => {
  it('plans Lambda AWS/Lambda, LambdaInsights and per-qualifier provisioned concurrency queries', () => {
    const queries = metricQueriesFor(lambdaFunction('fixture-api', ['live', '7']));
    expect(queries.map((q) => q.key)).toEqual([
      'Invocations:Sum',
      'Duration:Average',
      'Duration:Maximum',
      'Duration:Sum',
      'Errors:Sum',
      'Throttles:Sum',
      'memory_utilization:Maximum',
      'used_memory_max:Maximum',
      'ProvisionedConcurrencyUtilization:Maximum:live',
      'ProvisionedConcurrencyUtilization:Maximum:7',
    ]);
    expect(queries[0]).toMatchObject({
      namespace: 'AWS/Lambda',
      dimensions: [{ name: 'FunctionName', value: 'fixture-api' }],
    });
    expect(queries.find((q) => q.key === 'memory_utilization:Maximum')).toMatchObject({
      namespace: 'LambdaInsights',
      dimensions: [{ name: 'function_name', value: 'fixture-api' }],
    });
    expect(queries.find((q) => q.key === provisionedConcurrencyMetricKey('live'))).toEqual({
      key: 'ProvisionedConcurrencyUtilization:Maximum:live',
      namespace: 'AWS/Lambda',
      metricName: 'ProvisionedConcurrencyUtilization',
      stat: 'Maximum',
      unit: 'Percent',
      scale: 100,
      dimensions: [
        { name: 'FunctionName', value: 'fixture-api' },
        { name: 'Resource', value: 'fixture-api:live' },
      ],
    });
    expect(keys(lambdaFunction('f', []))).toHaveLength(8);
  });

  it('queries CloudFront with DistributionId + Region=Global in us-east-1', () => {
    const cf = cloudFrontDistribution('E1');
    expect(metricsRegionFor(cf)).toBe('us-east-1');
    expect(metricsRegionFor(lambdaFunction('f', [], 'eu-west-1'))).toBe('eu-west-1');
    expect(metricQueriesFor(cf)).toEqual([
      expect.objectContaining({
        key: 'Requests:Sum',
        namespace: 'AWS/CloudFront',
        dimensions: [
          { name: 'DistributionId', value: 'E1' },
          { name: 'Region', value: 'Global' },
        ],
      }),
      expect.objectContaining({ key: 'BytesDownloaded:Sum' }),
    ]);
  });

  it('uses the contract metric names, stats and dimensions', () => {
    expect(keys(eksCluster())).toEqual([
      'node_cpu_utilization:Average',
      'node_cpu_utilization:Maximum',
      'node_memory_utilization:Average',
      'node_memory_utilization:Maximum',
      'node_cpu_reserved_capacity:Average',
      'node_memory_reserved_capacity:Average',
      'cluster_node_count:Average',
    ]);
    expect(metricQueriesFor(eksCluster())[0]).toMatchObject({
      namespace: 'ContainerInsights',
      dimensions: [{ name: 'ClusterName', value: 'fixture-prod' }],
    });
    expect(keys(elastiCacheCluster())).toEqual([
      'CPUUtilization:Average',
      'CPUUtilization:Maximum',
      'EngineCPUUtilization:Average',
      'EngineCPUUtilization:Maximum',
      'DatabaseMemoryUsagePercentage:Maximum',
      'CurrConnections:Average',
      'CurrConnections:Maximum',
      'NetworkBytesIn:Sum',
      'NetworkBytesOut:Sum',
    ]);
    expect(metricQueriesFor(elastiCacheCluster())[0]?.dimensions).toEqual([
      { name: 'CacheClusterId', value: 'fixture-redis-001' },
    ]);
    expect(keys(efsFileSystem())).toEqual([
      'ClientConnections:Maximum',
      'DataReadIOBytes:Sum',
      'DataWriteIOBytes:Sum',
      'MeteredIOBytes:Sum',
    ]);
    expect(metricQueriesFor(efsFileSystem())[0]).toMatchObject({ namespace: 'AWS/EFS' });
    // DynamoDB consumed capacity is only collected as Sum (Maximum is the largest single request).
    expect(keys(dynamoDbTable())).toEqual([
      'ConsumedReadCapacityUnits:Sum',
      'ConsumedWriteCapacityUnits:Sum',
      'ReadThrottleEvents:Sum',
      'WriteThrottleEvents:Sum',
    ]);
    expect(metricQueriesFor(dynamoDbTable())[0]?.dimensions).toEqual([
      { name: 'TableName', value: 'orders' },
    ]);
    expect(keys(redshiftCluster())).toEqual([
      'CPUUtilization:Average',
      'CPUUtilization:Maximum',
      'DatabaseConnections:Average',
      'DatabaseConnections:Maximum',
      'PercentageDiskSpaceUsed:Average',
    ]);
    expect(metricQueriesFor(redshiftCluster())[0]).toMatchObject({
      namespace: 'AWS/Redshift',
      dimensions: [{ name: 'ClusterIdentifier', value: 'fixture-warehouse' }],
    });
  });

  it('applies the contract qualification rules', () => {
    expect(qualifiesForMetrics(lambdaFunction())).toBe(true);
    expect(qualifiesForMetrics(cloudFrontDistribution())).toBe(true);
    expect(qualifiesForMetrics(eksCluster('ACTIVE'))).toBe(true);
    expect(qualifiesForMetrics(eksCluster('unknown'))).toBe(false);
    expect(qualifiesForMetrics(elastiCacheCluster('modifying'))).toBe(false);
    expect(qualifiesForMetrics(efsFileSystem('creating'))).toBe(false);
    expect(qualifiesForMetrics(dynamoDbTable('UPDATING'))).toBe(false);
    expect(qualifiesForMetrics(redshiftCluster('paused'))).toBe(false);
    expect(qualifiesForMetrics(backupVault())).toBe(false);
    expect(metricQueriesFor(redshiftCluster('paused'))).toEqual([]);
    expect(metricQueriesFor(backupVault())).toEqual([]);
  });
});
