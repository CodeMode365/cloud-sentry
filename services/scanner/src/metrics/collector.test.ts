import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CloudWatchClient,
  GetMetricDataCommand,
  type GetMetricDataCommandInput,
} from '@aws-sdk/client-cloudwatch';
import type { DiscoveredResource } from '@cloudsentry/shared-types';
import { resourceKeyFor, silentLogger } from '@cloudsentry/utilities';
import { cloudFrontDistribution, lambdaFunction } from '../__fixtures__/resources';
import { batchSizeFor, collectUtilization, observableDaysFor, summarizeValues } from './collector';

const NOW = new Date('2026-11-14T12:30:00Z');

function ec2(
  id: string,
  region = 'us-east-1',
  state = 'running',
  createdAt: string | null = '2026-01-01T00:00:00Z',
): DiscoveredResource {
  return {
    resourceType: 'EC2_INSTANCE',
    accountId: '111122223333',
    region,
    resourceId: id,
    arn: null,
    name: null,
    state,
    tags: {},
    createdAt,
    attributes: {
      instanceType: 't3.micro',
      availabilityZone: null,
      launchTime: createdAt,
      platformDetails: 'Linux/UNIX',
      platform: null,
      tenancy: 'default',
      instanceLifecycle: null,
      publicIpAddress: null,
      privateIpAddress: null,
      monitoringState: null,
      vpcId: null,
      subnetId: null,
      architecture: null,
      attachedVolumeIds: [],
    },
  };
}

const key = (r: DiscoveredResource) => resourceKeyFor(r.accountId, r.region, r.resourceType, r.resourceId);
const awsError = (name: string) => Object.assign(new Error(`${name} message`), { name });

describe('collector helpers', () => {
  it('sizes batches by both query and datapoint limits', () => {
    expect(batchSizeFor(720)).toBe(140);
    expect(batchSizeFor(30)).toBe(500);
    expect(batchSizeFor(1_000_000)).toBe(1);
  });

  it('summarizes values and computes coverage', () => {
    const stats = summarizeValues([1, 2, 3, 4], 8);
    expect(stats).toMatchObject({
      average: 2.5,
      minimum: 1,
      maximum: 4,
      sum: 10,
      datapoints: 4,
      expectedDatapoints: 8,
      coverage: 0.5,
      zeroFraction: 0,
    });
    expect(stats.p50).toBe(2.5);
  });

  it('computes zeroFraction as the share of datapoints exactly 0, null without datapoints', () => {
    expect(summarizeValues([0, 0, 1, 2], 4).zeroFraction).toBe(0.5);
    expect(summarizeValues([0, 0, 0], 3).zeroFraction).toBe(1);
    expect(summarizeValues([0.001, 3], 2).zeroFraction).toBe(0);
    expect(summarizeValues([0, 1, 1], 3).zeroFraction).toBe(0.3333);
    expect(summarizeValues([], 10)).toMatchObject({ zeroFraction: null, datapoints: 0, average: null });
  });

  it('bounds observable days by creation time', () => {
    expect(observableDaysFor(null, 30, NOW)).toBe(30);
    expect(observableDaysFor('2026-11-04T12:30:00Z', 30, NOW)).toBe(10);
    expect(observableDaysFor('2020-01-01T00:00:00Z', 30, NOW)).toBe(30);
  });
});

describe('collectUtilization', () => {
  const cwMock = mockClient(CloudWatchClient);
  beforeEach(() => cwMock.reset());

  it('splits large query sets into batches of at most 500 queries and follows the datapoint limit', async () => {
    const resources = Array.from({ length: 100 }, (_, i) => ec2(`i-${i}`));
    cwMock.on(GetMetricDataCommand).callsFake((input: GetMetricDataCommandInput) => ({
      MetricDataResults: (input.MetricDataQueries ?? []).map((q) => ({
        Id: q.Id,
        Values: [1],
        StatusCode: 'Complete',
      })),
    }));
    const client = new CloudWatchClient({ region: 'us-east-1' });

    const hourly = await collectUtilization(
      resources,
      { cloudwatch: () => client },
      { lookbackDays: 30, now: NOW, logger: silentLogger },
    );
    const hourlyCalls = cwMock.commandCalls(GetMetricDataCommand);
    expect(hourly.apiCalls).toBe(5); // 700 queries / 140 per request (720 points each)
    expect(hourlyCalls.every((c) => (c.args[0].input.MetricDataQueries?.length ?? 0) <= 140)).toBe(true);
    expect(hourlyCalls[0]?.args[0].input.ScanBy).toBe('TimestampAscending');

    cwMock.resetHistory();
    const daily = await collectUtilization(
      resources,
      { cloudwatch: () => client },
      {
        lookbackDays: 30,
        now: NOW,
        periodSeconds: 86_400,
        logger: silentLogger,
      },
    );
    const sizes = cwMock
      .commandCalls(GetMetricDataCommand)
      .map((c) => c.args[0].input.MetricDataQueries?.length);
    expect(sizes).toEqual([500, 200]);
    expect(daily.utilization.size).toBe(100);
  });

  it('distinguishes NO_DATA from zero utilization, follows NextToken, and skips non-qualifying resources', async () => {
    const running = ec2('i-running', 'us-east-1', 'running', '2026-11-04T12:00:00Z');
    const stopped = ec2('i-stopped', 'us-east-1', 'stopped');
    cwMock
      .on(GetMetricDataCommand)
      .resolvesOnce({
        NextToken: 'next',
        MetricDataResults: [
          { Id: 'm0', Values: [0, 0], StatusCode: 'PartialData' }, // CPUUtilization:Average
          { Id: 'm2', Values: [], StatusCode: 'Complete' }, // NetworkIn: no data at all
        ],
      })
      .resolvesOnce({
        MetricDataResults: [
          { Id: 'm0', Values: [0], StatusCode: 'Complete' },
          { Id: 'm1', Values: [3.5, 7], StatusCode: 'Complete' },
          { Id: 'm6', StatusCode: 'Forbidden' },
        ],
      });
    const client = new CloudWatchClient({ region: 'us-east-1' });
    const result = await collectUtilization(
      [running, stopped],
      { cloudwatch: () => client },
      {
        lookbackDays: 30,
        now: NOW,
        logger: silentLogger,
      },
    );

    expect(result.apiCalls).toBe(2);
    expect(cwMock.commandCalls(GetMetricDataCommand)[1]?.args[0].input.NextToken).toBe('next');
    expect(result.utilization.has(key(stopped))).toBe(false);

    const util = result.utilization.get(key(running));
    expect(util?.observableDays).toBe(10);
    const cpuAvg = util?.metrics['CPUUtilization:Average'];
    expect(cpuAvg?.availability).toBe('AVAILABLE');
    expect(cpuAvg?.stats).toMatchObject({
      average: 0,
      maximum: 0,
      datapoints: 3,
      expectedDatapoints: 240,
      zeroFraction: 1,
    });
    expect(cpuAvg?.stats?.coverage).toBeCloseTo(3 / 240, 4);
    expect(util?.metrics['CPUUtilization:Maximum']?.stats?.maximum).toBe(7);
    expect(util?.metrics['NetworkIn:Sum']).toMatchObject({ availability: 'NO_DATA', stats: null });
    expect(util?.metrics['NetworkOut:Sum']).toMatchObject({ availability: 'NO_DATA', stats: null });
    expect(util?.metrics['StatusCheckFailed:Maximum']).toMatchObject({ availability: 'ERROR', stats: null });
    expect(Object.keys(util?.metrics ?? {})).toHaveLength(7);
  });

  it('marks metrics as ERROR for a failing region without affecting other regions', async () => {
    const east = ec2('i-east', 'us-east-1');
    const west = ec2('i-west', 'eu-west-1');
    const eastClient = new CloudWatchClient({ region: 'us-east-1' });
    const westClient = new CloudWatchClient({ region: 'eu-west-1' });
    const eastMock = mockClient(eastClient);
    const westMock = mockClient(westClient);
    eastMock.on(GetMetricDataCommand).callsFake((input: GetMetricDataCommandInput) => ({
      MetricDataResults: (input.MetricDataQueries ?? []).map((q) => ({
        Id: q.Id,
        Values: [5],
        StatusCode: 'Complete',
      })),
    }));
    westMock.on(GetMetricDataCommand).rejects(awsError('AccessDenied'));

    const result = await collectUtilization(
      [east, west],
      {
        cloudwatch: (region) => (region === 'us-east-1' ? eastClient : westClient),
      },
      { lookbackDays: 30, now: NOW, logger: silentLogger },
    );

    expect(result.regionErrors).toEqual([
      { region: 'eu-west-1', errorCode: 'AccessDenied', message: 'AccessDenied message' },
    ]);
    expect(result.utilization.get(key(east))?.metrics['CPUUtilization:Average']?.availability).toBe(
      'AVAILABLE',
    );
    const westMetrics = Object.values(result.utilization.get(key(west))?.metrics ?? {});
    expect(westMetrics).toHaveLength(7);
    expect(westMetrics.every((m) => m.availability === 'ERROR' && m.stats === null)).toBe(true);
    eastMock.restore();
    westMock.restore();
  });

  it('queries CloudFront with the us-east-1 client while keeping its global resourceKey', async () => {
    const cf = cloudFrontDistribution('E1');
    const fn = lambdaFunction('fixture-eu', [], 'eu-west-1');
    const eastClient = new CloudWatchClient({ region: 'us-east-1' });
    const westClient = new CloudWatchClient({ region: 'eu-west-1' });
    const eastMock = mockClient(eastClient);
    const westMock = mockClient(westClient);
    const respond = (input: GetMetricDataCommandInput) => ({
      MetricDataResults: (input.MetricDataQueries ?? []).map((q) => ({
        Id: q.Id,
        Values: [0, 10, 20],
        StatusCode: 'Complete',
      })),
    });
    eastMock.on(GetMetricDataCommand).callsFake(respond);
    westMock.on(GetMetricDataCommand).callsFake(respond);
    const requested: string[] = [];

    const result = await collectUtilization(
      [cf, fn],
      {
        cloudwatch: (region) => {
          requested.push(region);
          if (region === 'us-east-1') return eastClient;
          if (region === 'eu-west-1') return westClient;
          throw new Error(`unexpected CloudWatch region ${region}`);
        },
      },
      { lookbackDays: 30, now: NOW, logger: silentLogger },
    );

    expect(requested.sort()).toEqual(['eu-west-1', 'us-east-1']);
    const eastQueries = eastMock.commandCalls(GetMetricDataCommand)[0]?.args[0].input.MetricDataQueries ?? [];
    expect(eastQueries.map((q) => q.MetricStat?.Metric)).toEqual([
      {
        Namespace: 'AWS/CloudFront',
        MetricName: 'Requests',
        Dimensions: [
          { Name: 'DistributionId', Value: 'E1' },
          { Name: 'Region', Value: 'Global' },
        ],
      },
      expect.objectContaining({ MetricName: 'BytesDownloaded' }),
    ]);
    expect(westMock.commandCalls(GetMetricDataCommand)[0]?.args[0].input.MetricDataQueries).toHaveLength(8);
    expect(key(cf)).toBe(resourceKeyFor('111122223333', 'global', 'CLOUDFRONT_DISTRIBUTION', 'E1'));
    const cfUtil = result.utilization.get(key(cf));
    expect(cfUtil?.metrics['Requests:Sum']).toMatchObject({
      namespace: 'AWS/CloudFront',
      availability: 'AVAILABLE',
      stats: { sum: 30, datapoints: 3, zeroFraction: 0.3333 },
    });
    expect(result.utilization.size).toBe(2);
    eastMock.restore();
    westMock.restore();
  });

  it('keys Lambda provisioned concurrency per qualifier and reports utilization in percent', async () => {
    const fn = lambdaFunction('fixture-api', ['live', '7']);
    cwMock.on(GetMetricDataCommand).callsFake((input: GetMetricDataCommandInput) => ({
      MetricDataResults: (input.MetricDataQueries ?? []).map((q) => {
        const dims = q.MetricStat?.Metric?.Dimensions ?? [];
        const resource = dims.find((d) => d.Name === 'Resource')?.Value;
        if (resource === 'fixture-api:live')
          return { Id: q.Id, Values: [0.05, 0.1, 0], StatusCode: 'Complete' };
        if (resource === 'fixture-api:7') return { Id: q.Id, Values: [], StatusCode: 'Complete' };
        return { Id: q.Id, Values: [1], StatusCode: 'Complete' };
      }),
    }));
    const client = new CloudWatchClient({ region: 'us-east-1' });

    const result = await collectUtilization(
      [fn],
      { cloudwatch: () => client },
      {
        lookbackDays: 30,
        now: NOW,
        logger: silentLogger,
      },
    );

    const queries = cwMock.commandCalls(GetMetricDataCommand)[0]?.args[0].input.MetricDataQueries ?? [];
    const live = queries.find((q) =>
      q.MetricStat?.Metric?.Dimensions?.some((d) => d.Name === 'Resource' && d.Value === 'fixture-api:live'),
    );
    expect(live?.MetricStat).toMatchObject({
      Stat: 'Maximum',
      Metric: {
        Namespace: 'AWS/Lambda',
        MetricName: 'ProvisionedConcurrencyUtilization',
        Dimensions: [
          { Name: 'FunctionName', Value: 'fixture-api' },
          { Name: 'Resource', Value: 'fixture-api:live' },
        ],
      },
    });
    const metrics = result.utilization.get(key(fn))?.metrics ?? {};
    expect(Object.keys(metrics)).toHaveLength(10);
    expect(metrics['ProvisionedConcurrencyUtilization:Maximum:live']).toMatchObject({
      metricName: 'ProvisionedConcurrencyUtilization',
      statistic: 'Maximum',
      unit: 'Percent',
      availability: 'AVAILABLE',
      stats: { maximum: 10, minimum: 0, zeroFraction: 0.3333 },
    });
    expect(metrics['ProvisionedConcurrencyUtilization:Maximum:7']).toMatchObject({ availability: 'NO_DATA' });
    expect(metrics['memory_utilization:Maximum']).toMatchObject({
      namespace: 'LambdaInsights',
      availability: 'AVAILABLE',
    });
    expect(metrics['Invocations:Sum']?.stats?.sum).toBe(1);
  });
});
