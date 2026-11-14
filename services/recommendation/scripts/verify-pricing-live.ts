/**
 * Live check of every Price List query spec against the real AWS Price List API (read-only, free).
 * Uses the default AWS credential chain; needs pricing:GetProducts. Not part of the test suite.
 *
 *   pnpm --filter @cloudsentry/recommendation verify:pricing [region]
 */
import type { PriceQuery } from '@cloudsentry/shared-types';
import { createLogger } from '@cloudsentry/utilities';
import { createPricingService } from '../src/pricing';

const region = process.argv[2] ?? 'us-east-1';
const queries: PriceQuery[] = [
  {
    kind: 'EC2_INSTANCE_HOURLY',
    region,
    instanceType: 't3.micro',
    operatingSystem: 'Linux',
    tenancy: 'Shared',
    preInstalledSw: 'NA',
    licenseModel: 'No License required',
  },
  { kind: 'EBS_STORAGE_GB_MONTH', region, volumeApiName: 'gp3' },
  { kind: 'EBS_SNAPSHOT_GB_MONTH', region },
  { kind: 'PUBLIC_IPV4_IDLE_HOURLY', region },
  {
    kind: 'RDS_INSTANCE_HOURLY',
    region,
    instanceClass: 'db.t3.micro',
    databaseEngine: 'PostgreSQL',
    deploymentOption: 'Single-AZ',
  },
  { kind: 'NAT_GATEWAY_HOURLY', region },
  { kind: 'LAMBDA_GB_SECOND', region, architecture: 'x86_64' },
  { kind: 'LAMBDA_GB_SECOND', region, architecture: 'arm64' },
  { kind: 'LAMBDA_PROVISIONED_CONCURRENCY_GB_SECOND', region, architecture: 'x86_64' },
  { kind: 'LAMBDA_PROVISIONED_CONCURRENCY_GB_SECOND', region, architecture: 'arm64' },
  { kind: 'EKS_CLUSTER_HOURLY', region, supportType: 'STANDARD' },
  { kind: 'EKS_CLUSTER_HOURLY', region, supportType: 'EXTENDED' },
  { kind: 'ELASTICACHE_NODE_HOURLY', region, cacheNodeType: 'cache.r6g.large', cacheEngine: 'Redis' },
  { kind: 'ELASTICACHE_NODE_HOURLY', region, cacheNodeType: 'cache.r6g.large', cacheEngine: 'Valkey' },
  { kind: 'ELASTICACHE_NODE_HOURLY', region, cacheNodeType: 'cache.t3.micro', cacheEngine: 'Memcached' },
  { kind: 'EFS_STORAGE_GB_MONTH', region, storageClass: 'General Purpose' },
  { kind: 'EFS_STORAGE_GB_MONTH', region, storageClass: 'Infrequent Access' },
  { kind: 'EFS_STORAGE_GB_MONTH', region, storageClass: 'Archive' },
  { kind: 'EFS_STORAGE_GB_MONTH', region, storageClass: 'One Zone-General Purpose' },
  { kind: 'EFS_STORAGE_GB_MONTH', region, storageClass: 'One Zone-Infrequent Access' },
  { kind: 'DYNAMODB_PROVISIONED_CAPACITY_HOURLY', region, capacity: 'READ', tableClass: 'STANDARD' },
  { kind: 'DYNAMODB_PROVISIONED_CAPACITY_HOURLY', region, capacity: 'WRITE', tableClass: 'STANDARD' },
  {
    kind: 'DYNAMODB_PROVISIONED_CAPACITY_HOURLY',
    region,
    capacity: 'READ',
    tableClass: 'STANDARD_INFREQUENT_ACCESS',
  },
  { kind: 'DYNAMODB_ON_DEMAND_REQUEST_UNIT', region, request: 'READ', tableClass: 'STANDARD' },
  { kind: 'DYNAMODB_ON_DEMAND_REQUEST_UNIT', region, request: 'WRITE', tableClass: 'STANDARD' },
  { kind: 'DYNAMODB_STORAGE_GB_MONTH', region, tableClass: 'STANDARD' },
  { kind: 'DYNAMODB_STORAGE_GB_MONTH', region, tableClass: 'STANDARD_INFREQUENT_ACCESS' },
  { kind: 'REDSHIFT_NODE_HOURLY', region, nodeType: 'ra3.xlplus' },
  { kind: 'REDSHIFT_NODE_HOURLY', region, nodeType: 'dc2.large' },
];

const logger = createLogger({ service: 'verify-pricing', level: 'warn' });
const pricing = createPricingService({ logger, region: 'us-east-1' });
let failures = 0;
for (const q of queries) {
  const r = await pricing.getPrice(q);
  const { kind, region: _r, ...rest } = q;
  const label = `${kind} ${Object.values(rest).join(' ')}`.padEnd(70);
  if (r.price)
    console.log(`OK    ${label} ${r.price.unitPriceUsd} / ${r.price.unit}  [${r.price.sku ?? '-'}]`);
  else {
    failures++;
    console.log(`MISS  ${label} ${r.unavailableReason ?? ''}`);
  }
}
console.log(`\n${queries.length - failures}/${queries.length} priced in ${region}`);
process.exitCode = failures ? 1 : 0;
