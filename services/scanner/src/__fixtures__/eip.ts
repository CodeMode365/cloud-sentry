/** SYNTHETIC TEST FIXTURE: SDK-shaped DescribeAddresses output. Not real AWS data. */
import type { DescribeAddressesCommandOutput } from '@aws-sdk/client-ec2';

export const elasticIpsResponse: Partial<DescribeAddressesCommandOutput> = {
  Addresses: [
    {
      AllocationId: 'eipalloc-0aaaaaaaaaaaaaaa1',
      PublicIp: '203.0.113.10',
      AssociationId: 'eipassoc-0aaaaaaaaaaaaaaa1',
      InstanceId: 'i-0aaaaaaaaaaaaaaa1',
      NetworkInterfaceId: 'eni-0aaaaaaaaaaaaaaa1',
      PrivateIpAddress: '10.0.1.10',
      Domain: 'vpc',
      Tags: [{ Key: 'Name', Value: 'fixture-web-ip' }],
    },
    {
      AllocationId: 'eipalloc-0aaaaaaaaaaaaaaa2',
      PublicIp: '203.0.113.11',
      Domain: 'vpc',
    },
    { PublicIp: '203.0.113.12', Domain: 'standard' },
  ],
};
