import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DescribeClusterCommand,
  DescribeNodegroupCommand,
  EKSClient,
  ListClustersCommand,
  ListFargateProfilesCommand,
  ListNodegroupsCommand,
} from '@aws-sdk/client-eks';
import {
  eksClustersPage1,
  eksClustersPage2,
  eksDegradedCluster,
  eksIdleCluster,
  eksNodegroupA,
  eksNodegroupB,
  eksProdCluster,
} from '../__fixtures__/eks';
import { discoverEksClusters } from './eks-clusters';
import { awsError, captureLogger, warnings } from './test-helpers';

const eksMock = mockClient(EKSClient);
const client = () => new EKSClient({ region: 'us-east-1' });
const ctx = { accountId: '111122223333', region: 'us-east-1' };

beforeEach(() => eksMock.reset());

function mockHappyDefaults() {
  eksMock.on(ListNodegroupsCommand).resolves({ nodegroups: [] });
  eksMock.on(ListFargateProfilesCommand).resolves({ fargateProfileNames: [] });
}

describe('discoverEksClusters', () => {
  it('paginates clusters and nodegroups, maps fields, degrades failed nodegroups and skips deleted clusters', async () => {
    eksMock.on(ListClustersCommand).resolvesOnce(eksClustersPage1).resolvesOnce(eksClustersPage2);
    mockHappyDefaults();
    eksMock.on(DescribeClusterCommand, { name: 'fixture-prod' }).resolves(eksProdCluster);
    eksMock.on(DescribeClusterCommand, { name: 'fixture-idle' }).resolves(eksIdleCluster);
    eksMock.on(DescribeClusterCommand, { name: 'fixture-degraded' }).resolves(eksDegradedCluster);
    eksMock
      .on(DescribeClusterCommand, { name: 'fixture-gone' })
      .rejects(awsError('ResourceNotFoundException'));
    eksMock
      .on(ListNodegroupsCommand, { clusterName: 'fixture-prod' })
      .resolvesOnce({ nodegroups: ['ng-a'], nextToken: 'ng-2' })
      .resolvesOnce({ nodegroups: ['ng-b'] });
    eksMock
      .on(ListNodegroupsCommand, { clusterName: 'fixture-degraded' })
      .resolves({ nodegroups: ['ng-ok', 'ng-fail'] });
    eksMock
      .on(ListFargateProfilesCommand, { clusterName: 'fixture-prod' })
      .resolves({ fargateProfileNames: ['fp-default', 'fp-batch'] });
    eksMock.on(DescribeNodegroupCommand, { clusterName: 'fixture-prod', nodegroupName: 'ng-a' }).resolves(eksNodegroupA);
    eksMock.on(DescribeNodegroupCommand, { clusterName: 'fixture-prod', nodegroupName: 'ng-b' }).resolves(eksNodegroupB);
    eksMock
      .on(DescribeNodegroupCommand, { clusterName: 'fixture-degraded', nodegroupName: 'ng-ok' })
      .resolves({ nodegroup: { ...eksNodegroupA.nodegroup, nodegroupName: 'ng-ok' } });
    eksMock
      .on(DescribeNodegroupCommand, { clusterName: 'fixture-degraded', nodegroupName: 'ng-fail' })
      .rejects(awsError('AccessDeniedException'));
    const { logger, lines } = captureLogger();

    const result = await discoverEksClusters(client(), { ...ctx, logger });

    expect(eksMock.commandCalls(ListClustersCommand)[1]?.args[0].input.nextToken).toBe('clusters-2');
    const prodNodegroupCalls = eksMock
      .commandCalls(ListNodegroupsCommand)
      .filter((c) => c.args[0].input.clusterName === 'fixture-prod');
    expect(prodNodegroupCalls).toHaveLength(2);
    expect(result.map((r) => r.resourceId)).toEqual(['fixture-prod', 'fixture-idle', 'fixture-degraded']);

    const [prod, idle, degraded] = result;
    expect(prod).toEqual({
      resourceType: 'EKS_CLUSTER',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceId: 'fixture-prod',
      arn: 'arn:aws:eks:us-east-1:111122223333:cluster/fixture-prod',
      name: 'fixture-prod',
      state: 'ACTIVE',
      tags: { team: 'platform' },
      createdAt: '2025-06-01T00:00:00.000Z',
      attributes: {
        clusterName: 'fixture-prod',
        version: '1.31',
        platformVersion: 'eks.12',
        supportType: 'EXTENDED',
        autoModeEnabled: false,
        fargateProfileCount: 2,
        nodegroups: [
          {
            name: 'ng-a',
            status: 'ACTIVE',
            instanceTypes: ['m5.large'],
            capacityType: 'ON_DEMAND',
            amiType: 'AL2023_x86_64_STANDARD',
            desiredSize: 2,
            minSize: 1,
            maxSize: 4,
          },
          {
            name: 'ng-b',
            status: 'ACTIVE',
            instanceTypes: ['m6g.large', 'm7g.large'],
            capacityType: 'SPOT',
            amiType: 'BOTTLEROCKET_ARM_64',
            desiredSize: 3,
            minSize: 0,
            maxSize: 10,
          },
        ],
      },
    });
    expect(idle).toMatchObject({
      state: 'ACTIVE',
      tags: {},
      attributes: { nodegroups: [], fargateProfileCount: 0, autoModeEnabled: false, supportType: null },
    });
    // One nodegroup could not be described: its sizes are unknown, so the cluster is not reported ACTIVE.
    expect(degraded?.state).toBe('unknown');
    expect(degraded?.attributes.nodegroups).toEqual([
      expect.objectContaining({ name: 'ng-ok', status: 'ACTIVE', desiredSize: 2 }),
      {
        name: 'ng-fail',
        status: null,
        instanceTypes: [],
        capacityType: null,
        amiType: null,
        desiredSize: 0,
        minSize: 0,
        maxSize: 0,
      },
    ]);
    expect(warnings(lines).map((w) => w.nodegroupName)).toEqual(['ng-fail']);
  });

  it('keeps a cluster with state unknown when a cluster-level detail call fails', async () => {
    eksMock.on(ListClustersCommand).resolves({ clusters: ['fixture-a', 'fixture-b'] });
    mockHappyDefaults();
    eksMock.on(DescribeClusterCommand, { name: 'fixture-a' }).rejects(awsError('ServerException'));
    eksMock.on(DescribeClusterCommand, { name: 'fixture-b' }).resolves(eksIdleCluster);
    eksMock
      .on(ListFargateProfilesCommand, { clusterName: 'fixture-b' })
      .rejects(awsError('AccessDeniedException'));

    const result = await discoverEksClusters(client(), { ...ctx, logger: captureLogger().logger });

    expect(result.map((r) => [r.resourceId, r.state])).toEqual([
      ['fixture-a', 'unknown'],
      ['fixture-b', 'unknown'],
    ]);
    expect(result[0]).toMatchObject({
      arn: 'arn:aws:eks:us-east-1:111122223333:cluster/fixture-a',
      createdAt: null,
      attributes: { version: null, nodegroups: [], fargateProfileCount: 0 },
    });
    expect(result[1]?.attributes.version).toBe('1.33');
  });
});
