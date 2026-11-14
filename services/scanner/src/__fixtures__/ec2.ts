/** SYNTHETIC TEST FIXTURE: SDK-shaped DescribeInstances pages. Not real AWS data. */
import type { DescribeInstancesCommandOutput } from '@aws-sdk/client-ec2';

export const ec2InstancesPage1: Partial<DescribeInstancesCommandOutput> = {
  NextToken: 'page-2',
  Reservations: [
    {
      Instances: [
        {
          InstanceId: 'i-0aaaaaaaaaaaaaaa1',
          InstanceType: 't3.micro',
          State: { Name: 'running', Code: 16 },
          LaunchTime: new Date('2026-09-01T10:00:00Z'),
          Placement: { AvailabilityZone: 'us-east-1a', Tenancy: 'default' },
          PlatformDetails: 'Linux/UNIX',
          PublicIpAddress: '198.51.100.10',
          PrivateIpAddress: '10.0.1.10',
          Monitoring: { State: 'disabled' },
          VpcId: 'vpc-0test',
          SubnetId: 'subnet-0test',
          Architecture: 'x86_64',
          Tags: [
            { Key: 'Name', Value: 'fixture-web-1' },
            { Key: 'Environment', Value: 'test' },
          ],
          BlockDeviceMappings: [{ DeviceName: '/dev/xvda', Ebs: { VolumeId: 'vol-0aaaaaaaaaaaaaaa1' } }],
        },
        {
          InstanceId: 'i-0aaaaaaaaaaaaaaa2',
          InstanceType: 'm5.large',
          State: { Name: 'terminated', Code: 48 },
          LaunchTime: new Date('2026-08-01T10:00:00Z'),
        },
      ],
    },
  ],
};

export const ec2InstancesPage2: Partial<DescribeInstancesCommandOutput> = {
  Reservations: [
    {
      Instances: [
        {
          InstanceId: 'i-0aaaaaaaaaaaaaaa3',
          InstanceType: 'm5.xlarge',
          State: { Name: 'stopped', Code: 80 },
          LaunchTime: new Date('2026-07-15T08:30:00Z'),
          Placement: { AvailabilityZone: 'us-east-1b', Tenancy: 'dedicated' },
          PlatformDetails: 'Windows',
          Platform: 'Windows',
          InstanceLifecycle: 'spot',
          Monitoring: { State: 'enabled' },
          Tags: [],
        },
      ],
    },
  ],
};
