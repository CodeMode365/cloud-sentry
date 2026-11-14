/** SYNTHETIC TEST FIXTURE: SDK-shaped Redshift DescribeClusters pages. Not real AWS data. */
import type { DescribeClustersCommandOutput } from '@aws-sdk/client-redshift';

export const redshiftClustersPage1: Partial<DescribeClustersCommandOutput> = {
  Marker: 'page-2',
  Clusters: [
    {
      ClusterIdentifier: 'fixture-warehouse',
      NodeType: 'ra3.xlplus',
      ClusterStatus: 'available',
      ClusterAvailabilityStatus: 'Available',
      ClusterCreateTime: new Date('2025-03-01T00:00:00Z'),
      NumberOfNodes: 2,
      Encrypted: true,
      MultiAZ: 'Enabled',
      AutomatedSnapshotRetentionPeriod: 7,
      Tags: [{ Key: 'team', Value: 'analytics' }],
    },
  ],
};

export const redshiftClustersPage2: Partial<DescribeClustersCommandOutput> = {
  Clusters: [
    {
      ClusterIdentifier: 'fixture-paused',
      NodeType: 'dc2.large',
      ClusterStatus: 'paused',
      NumberOfNodes: 1,
    },
  ],
};
