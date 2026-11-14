import { defineRule, NOT_DETECTED } from './types';

export const unassociatedEipRule = defineRule({
  ruleId: 'unassociated-eip',
  name: 'Unassociated Elastic IP',
  description: 'Elastic IP address that is not associated with an instance or network interface.',
  resourceType: 'ELASTIC_IP',
  category: 'UNUSED',
  version: 1,
  defaultSeverity: 'LOW',
  defaultThresholds: {},
  thresholdDescriptions: {},
  evaluate(resource) {
    const a = resource.attributes;
    if (a.associationId || a.instanceId || a.networkInterfaceId) return NOT_DETECTED;
    const label = a.publicIp ?? resource.resourceId;
    return {
      outcome: 'DETECTED',
      title: `Unassociated Elastic IP ${label}`,
      description: `Elastic IP ${label} (${a.allocationId}) is allocated but not associated with any resource; idle public IPv4 addresses are billed hourly.`,
      confidence: 'HIGH',
      riskLevel: 'MEDIUM',
      evidence: [
        { key: 'eip.publicIp', label: 'Public IP', value: a.publicIp },
        { key: 'eip.allocationId', label: 'Allocation ID', value: a.allocationId },
        { key: 'eip.associationId', label: 'Association', value: 'none' },
        { key: 'eip.domain', label: 'Domain', value: a.domain },
      ],
      suggestedAction: {
        type: 'RELEASE_ADDRESS',
        summary:
          'Confirm the address is not reserved for future use or referenced externally, then release it.',
        steps: [
          'Check DNS records, firewall allowlists and partner integrations that may reference this IP address.',
          'Release the address. A released address may not be recoverable.',
        ],
      },
      savingsRequest: { kind: 'ELASTIC_IP_RELEASE', region: resource.region },
    };
  },
});
