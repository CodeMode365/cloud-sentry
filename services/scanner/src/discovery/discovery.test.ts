import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DescribeAddressesCommand,
  DescribeInstancesCommand,
  DescribeNatGatewaysCommand,
  DescribeSnapshotsCommand,
  DescribeVolumesCommand,
  EC2Client,
} from '@aws-sdk/client-ec2';
import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import {
  DescribeLoadBalancersCommand,
  ElasticLoadBalancingV2Client,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { ec2InstancesPage1, ec2InstancesPage2 } from '../__fixtures__/ec2';
import { ebsVolumesPage1, ebsVolumesPage2 } from '../__fixtures__/ebs';
import { rdsInstancesPage1, rdsInstancesPage2 } from '../__fixtures__/rds';
import { elasticIpsResponse } from '../__fixtures__/eip';
import { discoverEc2Instances } from './ec2';
import { discoverEbsVolumes } from './ebs';
import { discoverElasticIps } from './eip';
import { discoverRdsInstances } from './rds';
import { discoverSnapshots } from './snapshots';
import { discoverNatGateways } from './nat-gateways';
import { discoverLoadBalancers } from './load-balancers';

const ctx = { accountId: '111122223333', region: 'us-east-1' };
const ec2Mock = mockClient(EC2Client);
const rdsMock = mockClient(RDSClient);
const elbMock = mockClient(ElasticLoadBalancingV2Client);

beforeEach(() => {
  ec2Mock.reset();
  rdsMock.reset();
  elbMock.reset();
});

describe('discoverEc2Instances', () => {
  it('follows pagination, excludes terminated instances and maps fields', async () => {
    ec2Mock.on(DescribeInstancesCommand).resolvesOnce(ec2InstancesPage1).resolvesOnce(ec2InstancesPage2);
    const result = await discoverEc2Instances(new EC2Client({ region: 'us-east-1' }), ctx);

    expect(ec2Mock.commandCalls(DescribeInstancesCommand)).toHaveLength(2);
    expect(ec2Mock.commandCalls(DescribeInstancesCommand)[1]?.args[0].input.NextToken).toBe('page-2');
    expect(result.map((r) => r.resourceId)).toEqual(['i-0aaaaaaaaaaaaaaa1', 'i-0aaaaaaaaaaaaaaa3']);

    const [web, spot] = result;
    expect(web).toMatchObject({
      resourceType: 'EC2_INSTANCE',
      accountId: '111122223333',
      region: 'us-east-1',
      name: 'fixture-web-1',
      state: 'running',
      createdAt: '2026-09-01T10:00:00.000Z',
      arn: 'arn:aws:ec2:us-east-1:111122223333:instance/i-0aaaaaaaaaaaaaaa1',
      tags: { Name: 'fixture-web-1', Environment: 'test' },
      attributes: {
        instanceType: 't3.micro',
        availabilityZone: 'us-east-1a',
        platformDetails: 'Linux/UNIX',
        tenancy: 'default',
        instanceLifecycle: null,
        publicIpAddress: '198.51.100.10',
        privateIpAddress: '10.0.1.10',
        monitoringState: 'disabled',
        attachedVolumeIds: ['vol-0aaaaaaaaaaaaaaa1'],
      },
    });
    expect(spot?.attributes).toMatchObject({
      tenancy: 'dedicated',
      instanceLifecycle: 'spot',
      platform: 'Windows',
      publicIpAddress: null,
      attachedVolumeIds: [],
    });
    expect(spot?.name).toBeNull();
  });
});

describe('discoverEbsVolumes', () => {
  it('follows pagination and maps attachments', async () => {
    ec2Mock.on(DescribeVolumesCommand).resolvesOnce(ebsVolumesPage1).resolvesOnce(ebsVolumesPage2);
    const result = await discoverEbsVolumes(new EC2Client({ region: 'us-east-1' }), ctx);
    expect(result).toHaveLength(2);
    expect(result[0]?.attributes).toMatchObject({
      volumeType: 'gp3',
      sizeGiB: 8,
      iops: 3000,
      throughput: 125,
      encrypted: true,
      snapshotId: 'snap-0aaaaaaaaaaaaaaa1',
      attachments: [{ instanceId: 'i-0aaaaaaaaaaaaaaa1', device: '/dev/xvda', state: 'attached' }],
    });
    expect(result[1]).toMatchObject({
      state: 'available',
      createdAt: '2026-03-01T00:00:00.000Z',
      attributes: { snapshotId: null, attachments: [], throughput: null, multiAttachEnabled: false },
    });
  });
});

describe('discoverElasticIps', () => {
  it('maps association data and skips addresses without allocation IDs', async () => {
    ec2Mock.on(DescribeAddressesCommand).resolves(elasticIpsResponse);
    const result = await discoverElasticIps(new EC2Client({ region: 'us-east-1' }), ctx);
    expect(result.map((r) => r.resourceId)).toEqual([
      'eipalloc-0aaaaaaaaaaaaaaa1',
      'eipalloc-0aaaaaaaaaaaaaaa2',
    ]);
    expect(result[0]).toMatchObject({
      state: 'associated',
      name: 'fixture-web-ip',
      attributes: {
        publicIp: '203.0.113.10',
        associationId: 'eipassoc-0aaaaaaaaaaaaaaa1',
        instanceId: 'i-0aaaaaaaaaaaaaaa1',
        networkInterfaceId: 'eni-0aaaaaaaaaaaaaaa1',
      },
    });
    expect(result[1]).toMatchObject({
      state: 'unassociated',
      attributes: { associationId: null, instanceId: null },
    });
  });
});

describe('discoverRdsInstances', () => {
  it('follows Marker pagination and maps fields', async () => {
    rdsMock.on(DescribeDBInstancesCommand).resolvesOnce(rdsInstancesPage1).resolvesOnce(rdsInstancesPage2);
    const result = await discoverRdsInstances(new RDSClient({ region: 'us-east-1' }), ctx);
    expect(rdsMock.commandCalls(DescribeDBInstancesCommand)[1]?.args[0].input.Marker).toBe('page-2');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      resourceId: 'fixture-db-1',
      arn: 'arn:aws:rds:us-east-1:111122223333:db:fixture-db-1',
      name: 'fixture-db-1',
      state: 'available',
      createdAt: '2026-01-10T12:00:00.000Z',
      attributes: {
        engine: 'postgres',
        instanceClass: 'db.m5.large',
        allocatedStorageGiB: 100,
        multiAz: true,
        publiclyAccessible: false,
        storageEncrypted: true,
      },
    });
    expect(result[1]).toMatchObject({
      name: 'fixture-mysql',
      arn: 'arn:aws:rds:us-east-1:111122223333:db:fixture-db-2',
      attributes: { publiclyAccessible: true, engineVersion: null, dbClusterIdentifier: null },
    });
  });
});

describe('discoverSnapshots', () => {
  it('requests only self-owned snapshots, paginates, and drops placeholder volume IDs', async () => {
    ec2Mock
      .on(DescribeSnapshotsCommand)
      .resolvesOnce({
        NextToken: 't2',
        Snapshots: [
          {
            SnapshotId: 'snap-1',
            VolumeId: 'vol-0aaaaaaaaaaaaaaa1',
            VolumeSize: 8,
            StartTime: new Date('2025-01-01T00:00:00Z'),
            Description: 'nightly',
            OwnerId: '111122223333',
            State: 'completed',
            Encrypted: true,
            StorageTier: 'standard',
          },
        ],
      })
      .resolvesOnce({
        Snapshots: [{ SnapshotId: 'snap-2', VolumeId: 'vol-ffffffff', VolumeSize: 50, State: 'completed' }],
      });
    const result = await discoverSnapshots(new EC2Client({ region: 'us-east-1' }), ctx);
    expect(ec2Mock.commandCalls(DescribeSnapshotsCommand)[0]?.args[0].input.OwnerIds).toEqual(['self']);
    expect(result).toHaveLength(2);
    expect(result[0]?.attributes).toMatchObject({
      volumeId: 'vol-0aaaaaaaaaaaaaaa1',
      volumeSizeGiB: 8,
      description: 'nightly',
      ownerId: '111122223333',
      sourceVolumeExists: null,
    });
    expect(result[0]?.createdAt).toBe('2025-01-01T00:00:00.000Z');
    expect(result[1]?.attributes.volumeId).toBeNull();
  });
});

describe('discoverNatGateways', () => {
  it('paginates and excludes deleted gateways', async () => {
    ec2Mock
      .on(DescribeNatGatewaysCommand)
      .resolvesOnce({
        NextToken: 'n2',
        NatGateways: [
          {
            NatGatewayId: 'nat-1',
            State: 'available',
            SubnetId: 'subnet-1',
            VpcId: 'vpc-1',
            ConnectivityType: 'public',
            NatGatewayAddresses: [{ PublicIp: '198.51.100.20' }],
            CreateTime: new Date('2026-02-01T00:00:00Z'),
          },
          { NatGatewayId: 'nat-2', State: 'deleted' },
        ],
      })
      .resolvesOnce({
        NatGateways: [{ NatGatewayId: 'nat-3', State: 'pending', ConnectivityType: 'private' }],
      });
    const result = await discoverNatGateways(new EC2Client({ region: 'us-east-1' }), ctx);
    expect(result.map((r) => r.resourceId)).toEqual(['nat-1', 'nat-3']);
    expect(result[0]?.attributes).toMatchObject({
      subnetId: 'subnet-1',
      vpcId: 'vpc-1',
      connectivityType: 'public',
      publicIps: ['198.51.100.20'],
    });
  });
});

describe('discoverLoadBalancers', () => {
  it('paginates with NextMarker and uses the ARN as resource ID', async () => {
    const arn1 = 'arn:aws:elasticloadbalancing:us-east-1:111122223333:loadbalancer/app/fixture-alb/abc';
    const arn2 = 'arn:aws:elasticloadbalancing:us-east-1:111122223333:loadbalancer/net/fixture-nlb/def';
    elbMock
      .on(DescribeLoadBalancersCommand)
      .resolvesOnce({
        NextMarker: 'm2',
        LoadBalancers: [
          {
            LoadBalancerArn: arn1,
            LoadBalancerName: 'fixture-alb',
            Type: 'application',
            Scheme: 'internet-facing',
            VpcId: 'vpc-1',
            State: { Code: 'active' },
            AvailabilityZones: [{ ZoneName: 'us-east-1a' }, { ZoneName: 'us-east-1b' }],
            DNSName: 'fixture-alb.example.invalid',
            CreatedTime: new Date('2026-04-01T00:00:00Z'),
          },
        ],
      })
      .resolvesOnce({
        LoadBalancers: [{ LoadBalancerArn: arn2, LoadBalancerName: 'fixture-nlb', Type: 'network' }],
      });
    const result = await discoverLoadBalancers(
      new ElasticLoadBalancingV2Client({ region: 'us-east-1' }),
      ctx,
    );
    expect(elbMock.commandCalls(DescribeLoadBalancersCommand)[1]?.args[0].input.Marker).toBe('m2');
    expect(result.map((r) => r.resourceId)).toEqual([arn1, arn2]);
    expect(result[0]).toMatchObject({
      name: 'fixture-alb',
      state: 'active',
      attributes: {
        type: 'application',
        scheme: 'internet-facing',
        availabilityZones: ['us-east-1a', 'us-east-1b'],
      },
    });
    expect(result[1]?.state).toBe('unknown');
  });
});
