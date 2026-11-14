/** SYNTHETIC TEST FIXTURE: SDK-shaped EKS responses. Not real AWS data. */
import type {
  DescribeClusterCommandOutput,
  DescribeNodegroupCommandOutput,
  ListClustersCommandOutput,
} from '@aws-sdk/client-eks';

export const eksClustersPage1: Partial<ListClustersCommandOutput> = {
  nextToken: 'clusters-2',
  clusters: ['fixture-prod'],
};

export const eksClustersPage2: Partial<ListClustersCommandOutput> = {
  clusters: ['fixture-idle', 'fixture-degraded', 'fixture-gone'],
};

export const eksProdCluster: Partial<DescribeClusterCommandOutput> = {
  cluster: {
    name: 'fixture-prod',
    arn: 'arn:aws:eks:us-east-1:111122223333:cluster/fixture-prod',
    createdAt: new Date('2025-06-01T00:00:00Z'),
    version: '1.31',
    platformVersion: 'eks.12',
    status: 'ACTIVE',
    tags: { team: 'platform' },
    upgradePolicy: { supportType: 'EXTENDED' },
    computeConfig: { enabled: false },
  },
};

export const eksIdleCluster: Partial<DescribeClusterCommandOutput> = {
  cluster: {
    name: 'fixture-idle',
    arn: 'arn:aws:eks:us-east-1:111122223333:cluster/fixture-idle',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    version: '1.33',
    status: 'ACTIVE',
  },
};

export const eksDegradedCluster: Partial<DescribeClusterCommandOutput> = {
  cluster: {
    name: 'fixture-degraded',
    arn: 'arn:aws:eks:us-east-1:111122223333:cluster/fixture-degraded',
    status: 'ACTIVE',
  },
};

export const eksNodegroupA: Partial<DescribeNodegroupCommandOutput> = {
  nodegroup: {
    nodegroupName: 'ng-a',
    status: 'ACTIVE',
    capacityType: 'ON_DEMAND',
    instanceTypes: ['m5.large'],
    amiType: 'AL2023_x86_64_STANDARD',
    scalingConfig: { minSize: 1, maxSize: 4, desiredSize: 2 },
  },
};

export const eksNodegroupB: Partial<DescribeNodegroupCommandOutput> = {
  nodegroup: {
    nodegroupName: 'ng-b',
    status: 'ACTIVE',
    capacityType: 'SPOT',
    instanceTypes: ['m6g.large', 'm7g.large'],
    amiType: 'BOTTLEROCKET_ARM_64',
    scalingConfig: { minSize: 0, maxSize: 10, desiredSize: 3 },
  },
};
