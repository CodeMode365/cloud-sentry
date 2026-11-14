/**
 * SYNTHETIC AWS API RESPONSES for integration tests (aws-sdk-client-mock). They imitate response shapes;
 * they are not real AWS data and do not prove real AWS integration.
 */
import { mockClient } from 'aws-sdk-client-mock';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import {
  DescribeAddressesCommand,
  DescribeInstancesCommand,
  DescribeNatGatewaysCommand,
  DescribeRegionsCommand,
  DescribeSnapshotsCommand,
  DescribeVolumesCommand,
  EC2Client,
} from '@aws-sdk/client-ec2';
import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import {
  DescribeLoadBalancersCommand,
  ElasticLoadBalancingV2Client,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { CloudWatchClient, GetMetricDataCommand, type MetricDataQuery } from '@aws-sdk/client-cloudwatch';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { GetProductsCommand, PricingClient } from '@aws-sdk/client-pricing';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { EKSClient } from '@aws-sdk/client-eks';
import { ElastiCacheClient } from '@aws-sdk/client-elasticache';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { EFSClient } from '@aws-sdk/client-efs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { RedshiftClient } from '@aws-sdk/client-redshift';
import { BackupClient } from '@aws-sdk/client-backup';
import { ApplicationAutoScalingClient } from '@aws-sdk/client-application-auto-scaling';
import { ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';

export const sts = mockClient(STSClient);
export const ec2 = mockClient(EC2Client);
export const rds = mockClient(RDSClient);
export const elb = mockClient(ElasticLoadBalancingV2Client);
export const cw = mockClient(CloudWatchClient);
export const ce = mockClient(CostExplorerClient);
export const pricing = mockClient(PricingClient);
/** Extended-service clients: empty accounts by default so tests stay hermetic (no real AWS calls). */
/** Minimal view of an aws-sdk-client-mock stub, so stubs for different client classes fit in one array. */
interface SimpleStub {
  reset(): void;
  onAnyCommand(): { resolves(value: object): unknown };
}
const stub = (m: unknown) => m as SimpleStub;
export const extendedClients: SimpleStub[] = [
  stub(mockClient(LambdaClient)),
  stub(mockClient(EKSClient)),
  stub(mockClient(ElastiCacheClient)),
  stub(mockClient(CloudFrontClient)),
  stub(mockClient(EFSClient)),
  stub(mockClient(RedshiftClient)),
  stub(mockClient(BackupClient)),
  stub(mockClient(ApplicationAutoScalingClient)),
  stub(mockClient(ResourceGroupsTaggingAPIClient)),
];
// DynamoDB: the client class is shared with DynamoDB Local (repositories), so only a dedicated customer-side
// instance is mocked; tests route CustomerAwsClients.dynamodb() to it.
export const customerDynamoDb = new DynamoDBClient({ region: 'us-east-1' });
export const customerDynamoDbMock = stub(mockClient(customerDynamoDb));

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

function priceDoc(usagetype: string, unit: string, usd: string) {
  return JSON.stringify({
    product: { sku: `SKU-${usagetype}`, attributes: { usagetype } },
    terms: {
      OnDemand: {
        T1: {
          effectiveDate: '2026-11-01T00:00:00Z',
          priceDimensions: {
            D1: { unit, pricePerUnit: { USD: usd }, description: `${usagetype} test price` },
          },
        },
      },
    },
  });
}

export function installBaselineMocks(
  accountId: string,
  opts: { volumeAttached?: boolean; eipRegionFails?: boolean } = {},
): void {
  for (const m of [sts, ec2, rds, elb, cw, ce, pricing]) m.reset();
  for (const m of [...extendedClients, customerDynamoDbMock]) {
    m.reset();
    m.onAnyCommand().resolves({});
  }
  sts.on(GetCallerIdentityCommand).resolves({
    Account: accountId,
    Arn: `arn:aws:sts::${accountId}:assumed-role/CloudSentryReadOnlyRole/x`,
  });
  ec2.on(DescribeRegionsCommand).resolves({ Regions: [{ RegionName: 'us-east-1' }] });
  ec2.on(DescribeInstancesCommand).resolves({
    Reservations: [
      {
        Instances: [
          {
            InstanceId: 'i-0idle',
            InstanceType: 'm5.large',
            State: { Name: 'running' },
            LaunchTime: daysAgo(60),
            PlatformDetails: 'Linux/UNIX',
            Placement: { AvailabilityZone: 'us-east-1a', Tenancy: 'default' },
            Monitoring: { State: 'disabled' },
            Tags: [{ Key: 'Name', Value: 'idle-box' }],
          },
        ],
      },
    ],
  });
  ec2.on(DescribeVolumesCommand).resolves({
    Volumes: [
      {
        VolumeId: 'vol-0orphan',
        VolumeType: 'gp3',
        Size: 100,
        State: opts.volumeAttached ? 'in-use' : 'available',
        CreateTime: daysAgo(60),
        Encrypted: true,
        AvailabilityZone: 'us-east-1a',
        Attachments: opts.volumeAttached
          ? [{ InstanceId: 'i-0idle', Device: '/dev/sdf', State: 'attached', AttachTime: daysAgo(1) }]
          : [],
      },
    ],
  });
  if (opts.eipRegionFails) {
    ec2
      .on(DescribeAddressesCommand)
      .rejects(Object.assign(new Error('not authorized'), { name: 'UnauthorizedOperation' }));
  } else {
    ec2
      .on(DescribeAddressesCommand)
      .resolves({ Addresses: [{ AllocationId: 'eipalloc-0free', PublicIp: '198.51.100.7', Domain: 'vpc' }] });
  }
  ec2.on(DescribeSnapshotsCommand).resolves({ Snapshots: [] });
  ec2.on(DescribeNatGatewaysCommand).resolves({ NatGateways: [] });
  rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: [] });
  elb.on(DescribeLoadBalancersCommand).resolves({ LoadBalancers: [] });

  cw.on(GetMetricDataCommand).callsFake(
    (input: { StartTime: Date; EndTime: Date; MetricDataQueries: MetricDataQuery[] }) => {
      const hours = Math.floor((input.EndTime.getTime() - input.StartTime.getTime()) / 3_600_000);
      const timestamps = Array.from(
        { length: hours },
        (_, i) => new Date(input.StartTime.getTime() + i * 3_600_000),
      );
      return {
        MetricDataResults: input.MetricDataQueries.map((q) => {
          const name = q.MetricStat?.Metric?.MetricName ?? '';
          const stat = q.MetricStat?.Stat ?? '';
          const value =
            name === 'CPUUtilization' ? (stat === 'Maximum' ? 3 : 1) : name.startsWith('Network') ? 1000 : 0;
          return {
            Id: q.Id,
            StatusCode: 'Complete',
            Timestamps: timestamps,
            Values: timestamps.map(() => value),
          };
        }),
      };
    },
  );

  ce.on(GetCostAndUsageCommand).callsFake(
    (input: { TimePeriod: { Start: string; End: string }; GroupBy?: unknown[] }) => ({
      ResultsByTime: [
        input.GroupBy?.length
          ? {
              TimePeriod: input.TimePeriod,
              Estimated: true,
              Groups: [
                {
                  Keys: ['Amazon Elastic Compute Cloud - Compute'],
                  Metrics: { UnblendedCost: { Amount: '42.10', Unit: 'USD' } },
                },
              ],
            }
          : {
              TimePeriod: input.TimePeriod,
              Estimated: true,
              Total: { UnblendedCost: { Amount: '12.50', Unit: 'USD' } },
            },
      ],
    }),
  );

  pricing
    .on(GetProductsCommand)
    .callsFake((input: { ServiceCode: string; Filters: { Field: string; Value: string }[] }) => {
      const f = Object.fromEntries(input.Filters.map((x) => [x.Field, x.Value]));
      if (input.ServiceCode === 'AmazonEC2' && f.instanceType === 'm5.large')
        return { PriceList: [priceDoc('BoxUsage:m5.large', 'Hrs', '0.0960000000')] };
      if (input.ServiceCode === 'AmazonEC2' && f.volumeApiName === 'gp3')
        return { PriceList: [priceDoc('EBS:VolumeUsage.gp3', 'GB-Mo', '0.0800000000')] };
      if (input.ServiceCode === 'AmazonVPC') {
        return {
          PriceList: [
            priceDoc('USE1-PublicIPv4:InUseAddress', 'Hrs', '0.005'),
            priceDoc('USE1-PublicIPv4:IdleAddress', 'Hrs', '0.005'),
          ],
        };
      }
      return { PriceList: [] };
    });
}
