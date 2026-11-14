/** SYNTHETIC TEST FIXTURE: SDK-shaped DescribeVolumes pages. Not real AWS data. */
import type { DescribeVolumesCommandOutput } from '@aws-sdk/client-ec2';

export const ebsVolumesPage1: Partial<DescribeVolumesCommandOutput> = {
  NextToken: 'page-2',
  Volumes: [
    {
      VolumeId: 'vol-0aaaaaaaaaaaaaaa1',
      VolumeType: 'gp3',
      Size: 8,
      Iops: 3000,
      Throughput: 125,
      State: 'in-use',
      AvailabilityZone: 'us-east-1a',
      Encrypted: true,
      SnapshotId: 'snap-0aaaaaaaaaaaaaaa1',
      CreateTime: new Date('2026-09-01T10:00:00Z'),
      MultiAttachEnabled: false,
      Attachments: [
        {
          InstanceId: 'i-0aaaaaaaaaaaaaaa1',
          Device: '/dev/xvda',
          State: 'attached',
          AttachTime: new Date('2026-09-01T10:00:05Z'),
        },
      ],
      Tags: [{ Key: 'Name', Value: 'fixture-root' }],
    },
  ],
};

export const ebsVolumesPage2: Partial<DescribeVolumesCommandOutput> = {
  Volumes: [
    {
      VolumeId: 'vol-0aaaaaaaaaaaaaaa2',
      VolumeType: 'gp2',
      Size: 100,
      Iops: 300,
      State: 'available',
      AvailabilityZone: 'us-east-1b',
      Encrypted: false,
      SnapshotId: '',
      CreateTime: new Date('2026-03-01T00:00:00Z'),
      Attachments: [],
    },
  ],
};
