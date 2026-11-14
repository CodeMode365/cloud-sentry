import {
  HOURS_PER_MONTH,
  MONTHS_PER_YEAR,
  SEVERITY_ORDER,
  type PriceQuery,
  type PricedRecommendationDraft,
  type PricePoint,
  type PricingSourceRef,
  type RecommendationDraft,
  type SavingsEstimate,
  type SavingsRequest,
  type Severity,
} from '@cloudsentry/shared-types';
import { roundMoney } from '@cloudsentry/utilities';
import type { PriceProvider } from './pricing/provider';

/** Monthly savings (USD) at or above which severity is escalated. Ordered high to low. */
export const SAVINGS_SEVERITY_TIERS: readonly [number, Severity][] = [
  [1000, 'CRITICAL'],
  [250, 'HIGH'],
  [25, 'MEDIUM'],
];

export function severityForSavings(monthly: number | null): Severity | null {
  if (monthly === null) return null;
  for (const [threshold, severity] of SAVINGS_SEVERITY_TIERS) if (monthly >= threshold) return severity;
  return null;
}

/** Final severity = max(rule base severity, severity implied by estimated monthly savings). */
export function escalateSeverity(base: Severity, monthly: number | null): Severity {
  const tier = severityForSavings(monthly);
  return tier && SEVERITY_ORDER[tier] > SEVERITY_ORDER[base] ? tier : base;
}

export const COMMON_ASSUMPTIONS = [
  'Uses public on-demand list prices (USD) from the AWS Price List API; taxes, credits, Free Tier and private discounts are not considered.',
  'Reserved Instance and Savings Plans coverage is not considered; if this resource is covered, realized savings may be lower.',
  'This is an estimate, not a guaranteed saving.',
];
const HOURS_ASSUMPTION = `A month is approximated as ${HOURS_PER_MONTH} hours.`;

type Lookup = { ok: true; price: PricePoint; ref: PricingSourceRef } | { ok: false; reason: string };

async function lookup(pricing: PriceProvider, query: PriceQuery): Promise<Lookup> {
  const result = await pricing.getPrice(query);
  if (!result.price) return { ok: false, reason: result.unavailableReason ?? 'Price unavailable' };
  const p = result.price;
  return {
    ok: true,
    price: p,
    ref: {
      query,
      unitPriceUsd: p.unitPriceUsd,
      unit: p.unit,
      sku: p.sku,
      effectiveDate: p.effectiveDate,
      retrievedAt: p.retrievedAt,
    },
  };
}

function fmt(n: number): string {
  return Number(n.toPrecision(6)).toString();
}

const SECONDS_PER_HOUR = 3600;
const MB_PER_GB = 1024;

/** Price List EFS `storageClass` values. */
const EFS_ARCHIVE_CLASS = 'Archive';
function efsStorageClasses(oneZone: boolean): { standard: string; ia: string } {
  return oneZone
    ? { standard: 'One Zone-General Purpose', ia: 'One Zone-Infrequent Access' }
    : { standard: 'General Purpose', ia: 'Infrequent Access' };
}

type CapacityPrices =
  | { ok: true; rcu: Extract<Lookup, { ok: true }>; wcu: Extract<Lookup, { ok: true }> }
  | { ok: false; reason: string };

/** Provisioned read and write capacity unit-hour prices (paid tier) for a DynamoDB table class. */
async function dynamoCapacityPrices(
  pricing: PriceProvider,
  region: string,
  tableClass: string,
): Promise<CapacityPrices> {
  const base = { kind: 'DYNAMODB_PROVISIONED_CAPACITY_HOURLY' as const, region, tableClass };
  const [rcu, wcu] = await Promise.all([
    lookup(pricing, { ...base, capacity: 'READ' }),
    lookup(pricing, { ...base, capacity: 'WRITE' }),
  ]);
  if (!rcu.ok) return { ok: false, reason: `Provisioned read capacity: ${rcu.reason}` };
  if (!wcu.ok) return { ok: false, reason: `Provisioned write capacity: ${wcu.reason}` };
  return { ok: true, rcu, wcu };
}

interface Computation {
  monthly: number;
  method: string;
  assumptions: string[];
  sources: PricingSourceRef[];
  estimateType?: 'POINT' | 'UPPER_BOUND';
}

type ComputeResult =
  Computation | { unavailable: string; assumptions?: string[]; sources?: PricingSourceRef[] };

async function compute(request: SavingsRequest, pricing: PriceProvider): Promise<ComputeResult> {
  switch (request.kind) {
    case 'EC2_INSTANCE_STOP': {
      if (request.nonOnDemandLifecycle) {
        return {
          unavailable: `Instance lifecycle "${request.nonOnDemandLifecycle}" is not on-demand; on-demand pricing does not apply.`,
        };
      }
      const l = await lookup(pricing, {
        kind: 'EC2_INSTANCE_HOURLY',
        region: request.region,
        instanceType: request.instanceType,
        operatingSystem: request.operatingSystem,
        tenancy: request.tenancy,
        preInstalledSw: request.preInstalledSw,
        licenseModel: request.licenseModel,
      });
      if (!l.ok) return { unavailable: l.reason };
      return {
        monthly: l.price.unitPriceUsd * HOURS_PER_MONTH,
        method: `${fmt(l.price.unitPriceUsd)} USD/hr (${request.instanceType}, ${request.operatingSystem}) x ${HOURS_PER_MONTH} hr`,
        assumptions: [
          HOURS_ASSUMPTION,
          'The instance runs 24x7 today; savings assume it is stopped or terminated for the whole month.',
          'Attached EBS volumes, snapshots and Elastic IPs are still billed after stopping and are not included.',
        ],
        sources: [l.ref],
      };
    }
    case 'EBS_VOLUME_DELETE': {
      const l = await lookup(pricing, {
        kind: 'EBS_STORAGE_GB_MONTH',
        region: request.region,
        volumeApiName: request.volumeType,
      });
      if (!l.ok) return { unavailable: l.reason };
      return {
        monthly: request.sizeGiB * l.price.unitPriceUsd,
        method: `${request.sizeGiB} GiB x ${fmt(l.price.unitPriceUsd)} USD/GB-month (${request.volumeType})`,
        assumptions: [
          'Only provisioned storage is included; provisioned IOPS and throughput charges are excluded, so actual savings may be higher.',
          'If you snapshot the volume before deleting it, snapshot storage charges will offset part of these savings.',
        ],
        sources: [l.ref],
      };
    }
    case 'ELASTIC_IP_RELEASE': {
      const l = await lookup(pricing, { kind: 'PUBLIC_IPV4_IDLE_HOURLY', region: request.region });
      if (!l.ok) return { unavailable: l.reason };
      return {
        monthly: l.price.unitPriceUsd * HOURS_PER_MONTH,
        method: `${fmt(l.price.unitPriceUsd)} USD/hr (idle public IPv4 address) x ${HOURS_PER_MONTH} hr`,
        assumptions: [HOURS_ASSUMPTION, 'Public IPv4 Free Tier allowances are not considered.'],
        sources: [l.ref],
      };
    }
    case 'RDS_RIGHTSIZE': {
      if (!request.databaseEngine)
        return { unavailable: 'The database engine is not supported by the savings engine.' };
      if (!request.targetClass)
        return { unavailable: 'No smaller instance class in the same family was identified.' };
      const deploymentOption = request.multiAz ? 'Multi-AZ' : 'Single-AZ';
      const base = {
        kind: 'RDS_INSTANCE_HOURLY' as const,
        region: request.region,
        databaseEngine: request.databaseEngine,
        deploymentOption,
      };
      const [current, target] = await Promise.all([
        lookup(pricing, { ...base, instanceClass: request.currentClass }),
        lookup(pricing, { ...base, instanceClass: request.targetClass }),
      ]);
      if (!current.ok) return { unavailable: `Current class ${request.currentClass}: ${current.reason}` };
      if (!target.ok) return { unavailable: `Target class ${request.targetClass}: ${target.reason}` };
      const diff = current.price.unitPriceUsd - target.price.unitPriceUsd;
      if (diff <= 0) {
        return {
          unavailable: `Target class ${request.targetClass} is not cheaper than ${request.currentClass}.`,
          sources: [current.ref, target.ref],
        };
      }
      return {
        monthly: diff * HOURS_PER_MONTH,
        method: `(${fmt(current.price.unitPriceUsd)} - ${fmt(target.price.unitPriceUsd)}) USD/hr (${request.currentClass} -> ${request.targetClass}, ${deploymentOption}) x ${HOURS_PER_MONTH} hr`,
        assumptions: [
          HOURS_ASSUMPTION,
          'Storage, IOPS, backup and data transfer charges are unchanged by rightsizing and are not included.',
          'The target class must support the current engine version and have enough memory for the workload; validate before changing.',
        ],
        sources: [current.ref, target.ref],
      };
    }
    case 'RDS_STOP': {
      if (!request.databaseEngine)
        return { unavailable: 'The database engine is not supported by the savings engine.' };
      const deploymentOption = request.multiAz ? 'Multi-AZ' : 'Single-AZ';
      const l = await lookup(pricing, {
        kind: 'RDS_INSTANCE_HOURLY',
        region: request.region,
        instanceClass: request.instanceClass,
        databaseEngine: request.databaseEngine,
        deploymentOption,
      });
      if (!l.ok) return { unavailable: l.reason };
      return {
        monthly: l.price.unitPriceUsd * HOURS_PER_MONTH,
        method: `${fmt(l.price.unitPriceUsd)} USD/hr (${request.instanceClass}, ${deploymentOption}) x ${HOURS_PER_MONTH} hr`,
        assumptions: [
          HOURS_ASSUMPTION,
          'Instance-hour charges only: storage and backup storage remain billed while an instance is stopped.',
          'AWS automatically starts a stopped RDS instance after 7 consecutive days; sustained savings require deleting it (after a final snapshot).',
        ],
        sources: [l.ref],
      };
    }
    case 'EBS_SNAPSHOT_DELETE': {
      const l = await lookup(pricing, { kind: 'EBS_SNAPSHOT_GB_MONTH', region: request.region });
      if (!l.ok) return { unavailable: l.reason };
      return {
        monthly: request.sizeGiB * l.price.unitPriceUsd,
        method: `up to ${request.sizeGiB} GiB (source volume size) x ${fmt(l.price.unitPriceUsd)} USD/GB-month`,
        assumptions: [
          'Upper bound: snapshots are incremental and billed only for changed blocks, so the billed size is usually smaller than the source volume size.',
          'Deleting a snapshot may not free blocks that later snapshots of the same volume still reference.',
        ],
        sources: [l.ref],
        estimateType: 'UPPER_BOUND',
      };
    }
    case 'NAT_GATEWAY_DELETE': {
      const l = await lookup(pricing, { kind: 'NAT_GATEWAY_HOURLY', region: request.region });
      if (!l.ok) return { unavailable: l.reason };
      return {
        monthly: l.price.unitPriceUsd * HOURS_PER_MONTH,
        method: `${fmt(l.price.unitPriceUsd)} USD/hr (NAT Gateway) x ${HOURS_PER_MONTH} hr`,
        assumptions: [
          HOURS_ASSUMPTION,
          'Per-GB data processing charges are excluded (traffic is low by definition of this finding).',
          'Costs of replacement connectivity (for example VPC interface endpoints) are not considered.',
        ],
        sources: [l.ref],
      };
    }
    // ---- Lambda
    case 'LAMBDA_MEMORY_RIGHTSIZE': {
      const reductionMb = request.currentMemoryMb - request.recommendedMemoryMb;
      if (reductionMb <= 0) {
        return { unavailable: 'The recommended memory size is not lower than the current memory size.' };
      }
      const l = await lookup(pricing, {
        kind: 'LAMBDA_GB_SECOND',
        region: request.region,
        architecture: request.architecture,
      });
      if (!l.ok) return { unavailable: l.reason };
      return {
        monthly: (reductionMb / MB_PER_GB) * request.monthlyDurationSeconds * l.price.unitPriceUsd,
        method: `(${request.currentMemoryMb} - ${request.recommendedMemoryMb}) MB / ${MB_PER_GB} x ${fmt(request.monthlyDurationSeconds)} s/month x ${fmt(l.price.unitPriceUsd)} USD/GB-second (${request.architecture})`,
        assumptions: [
          'Upper bound: Lambda allocates CPU in proportion to memory, so duration may increase at the lower memory size and reduce the savings.',
          'Uses the first (highest-price) duration tier; accounts in a lower-priced volume tier save less per GB-second.',
          'Billed duration is the observed duration normalised to 30 days. Request charges are unchanged and not included.',
        ],
        sources: [l.ref],
        estimateType: 'UPPER_BOUND',
      };
    }
    case 'LAMBDA_ARM64_MIGRATION': {
      const base = { kind: 'LAMBDA_GB_SECOND' as const, region: request.region };
      const [x86, arm] = await Promise.all([
        lookup(pricing, { ...base, architecture: 'x86_64' }),
        lookup(pricing, { ...base, architecture: 'arm64' }),
      ]);
      if (!x86.ok) return { unavailable: `x86_64 duration price: ${x86.reason}` };
      if (!arm.ok) return { unavailable: `arm64 duration price: ${arm.reason}` };
      const diff = x86.price.unitPriceUsd - arm.price.unitPriceUsd;
      if (diff <= 0) {
        return {
          unavailable: 'The arm64 duration price is not lower than the x86_64 price in this region.',
          sources: [x86.ref, arm.ref],
        };
      }
      return {
        monthly: (request.memoryMb / MB_PER_GB) * request.monthlyDurationSeconds * diff,
        method: `${request.memoryMb} MB / ${MB_PER_GB} x ${fmt(request.monthlyDurationSeconds)} s/month x (${fmt(x86.price.unitPriceUsd)} - ${fmt(arm.price.unitPriceUsd)}) USD/GB-second (x86_64 -> arm64)`,
        assumptions: [
          'Assumes the same billed duration on arm64 (Graviton); actual performance differs by workload.',
          'The function code, native dependencies and layers must support arm64; test before switching.',
          'Uses the first (highest-price) duration tier of each architecture. Request charges are unchanged.',
        ],
        sources: [x86.ref, arm.ref],
      };
    }
    case 'LAMBDA_PROVISIONED_CONCURRENCY_REDUCE': {
      const reduction = request.currentAllocated - request.recommendedAllocated;
      if (reduction <= 0) {
        return {
          unavailable: 'The recommended provisioned concurrency is not lower than the current allocation.',
        };
      }
      const l = await lookup(pricing, {
        kind: 'LAMBDA_PROVISIONED_CONCURRENCY_GB_SECOND',
        region: request.region,
        architecture: request.architecture,
      });
      if (!l.ok) return { unavailable: l.reason };
      return {
        monthly:
          reduction *
          (request.memoryMb / MB_PER_GB) *
          HOURS_PER_MONTH *
          SECONDS_PER_HOUR *
          l.price.unitPriceUsd,
        method: `(${request.currentAllocated} - ${request.recommendedAllocated}) concurrency x ${request.memoryMb} MB / ${MB_PER_GB} x ${HOURS_PER_MONTH} hr x ${SECONDS_PER_HOUR} s x ${fmt(l.price.unitPriceUsd)} USD/GB-second (provisioned concurrency, ${request.architecture})`,
        assumptions: [
          HOURS_ASSUMPTION,
          'Provisioned concurrency is billed for the whole allocation whether or not it is used.',
          'Requests above the reduced allocation run on on-demand concurrency at the standard duration rate and may see cold starts; that difference is not included.',
        ],
        sources: [l.ref],
      };
    }
    // ---- EKS
    case 'EKS_CLUSTER_DELETE': {
      const base = { kind: 'EKS_CLUSTER_HOURLY' as const, region: request.region };
      const extended = request.supportType === 'EXTENDED';
      // Two lookups: the control-plane rate, plus the extended-support surcharge billed on top of it.
      const [control, surcharge] = await Promise.all([
        lookup(pricing, { ...base, supportType: 'STANDARD' }),
        extended ? lookup(pricing, { ...base, supportType: 'EXTENDED' }) : null,
      ]);
      if (!control.ok) return { unavailable: `EKS control plane: ${control.reason}` };
      if (surcharge && !surcharge.ok) {
        return { unavailable: `EKS extended support: ${surcharge.reason}`, sources: [control.ref] };
      }
      const controlHourly = control.price.unitPriceUsd;
      const surchargeHourly = surcharge?.ok ? surcharge.price.unitPriceUsd : 0;
      return {
        monthly: (controlHourly + surchargeHourly) * HOURS_PER_MONTH,
        method: surcharge?.ok
          ? `(${fmt(controlHourly)} control plane + ${fmt(surchargeHourly)} extended support) USD/hr x ${HOURS_PER_MONTH} hr`
          : `${fmt(controlHourly)} USD/hr (EKS control plane) x ${HOURS_PER_MONTH} hr`,
        assumptions: [
          HOURS_ASSUMPTION,
          'Control-plane charges only: worker nodes, Fargate pods, load balancers, EBS volumes and other resources used by the cluster are billed separately and are not included.',
          extended
            ? 'Includes the extended-support surcharge for clusters running a Kubernetes version in extended support.'
            : 'Priced at the standard-support rate; clusters on a Kubernetes version in extended support pay an additional hourly surcharge.',
        ],
        sources: surcharge?.ok ? [control.ref, surcharge.ref] : [control.ref],
      };
    }
    case 'EKS_NODES_REDUCE': {
      if (request.capacityType !== null && request.capacityType !== 'ON_DEMAND') {
        return {
          unavailable: `Node group capacity type "${request.capacityType}" is not on-demand; on-demand pricing does not apply.`,
        };
      }
      if (request.removableNodes <= 0) return { unavailable: 'No removable nodes were identified.' };
      const l = await lookup(pricing, {
        kind: 'EC2_INSTANCE_HOURLY',
        region: request.region,
        instanceType: request.instanceType,
        operatingSystem: request.operatingSystem,
        tenancy: 'Shared',
        preInstalledSw: 'NA',
        licenseModel: 'No License required',
      });
      if (!l.ok) return { unavailable: l.reason };
      return {
        monthly: request.removableNodes * l.price.unitPriceUsd * HOURS_PER_MONTH,
        method: `${request.removableNodes} node(s) x ${fmt(l.price.unitPriceUsd)} USD/hr (${request.instanceType}, ${request.operatingSystem}, on-demand) x ${HOURS_PER_MONTH} hr`,
        assumptions: [
          HOURS_ASSUMPTION,
          'Upper bound: assumes the pods on the removed nodes fit on the remaining nodes (requests, pod limits, affinity rules and disruption budgets).',
          'EBS volumes attached to the removed nodes would also stop being billed; they are not included.',
          ...(request.capacityType === null
            ? ['The node capacity type is unknown; nodes are priced as on-demand.']
            : []),
        ],
        sources: [l.ref],
        estimateType: 'UPPER_BOUND',
      };
    }
    // ---- ElastiCache
    case 'ELASTICACHE_RIGHTSIZE': {
      if (!request.targetNodeType) {
        return { unavailable: 'No smaller node type in the same family was identified.' };
      }
      const base = {
        kind: 'ELASTICACHE_NODE_HOURLY' as const,
        region: request.region,
        cacheEngine: request.cacheEngine,
      };
      const [current, target] = await Promise.all([
        lookup(pricing, { ...base, cacheNodeType: request.currentNodeType }),
        lookup(pricing, { ...base, cacheNodeType: request.targetNodeType }),
      ]);
      if (!current.ok)
        return { unavailable: `Current node type ${request.currentNodeType}: ${current.reason}` };
      if (!target.ok) return { unavailable: `Target node type ${request.targetNodeType}: ${target.reason}` };
      const diff = current.price.unitPriceUsd - target.price.unitPriceUsd;
      if (diff <= 0) {
        return {
          unavailable: `Target node type ${request.targetNodeType} is not cheaper than ${request.currentNodeType}.`,
          sources: [current.ref, target.ref],
        };
      }
      return {
        monthly: diff * request.numNodes * HOURS_PER_MONTH,
        method: `(${fmt(current.price.unitPriceUsd)} - ${fmt(target.price.unitPriceUsd)}) USD/hr (${request.currentNodeType} -> ${request.targetNodeType}, ${request.cacheEngine}) x ${request.numNodes} node(s) x ${HOURS_PER_MONTH} hr`,
        assumptions: [
          HOURS_ASSUMPTION,
          'The target node type must hold the dataset plus reserved memory and replication overhead; validate before changing.',
          'Reserved nodes are not considered; if the cluster is covered by reserved nodes, realized savings may be lower.',
          'Backup storage and data transfer charges are unchanged and not included.',
        ],
        sources: [current.ref, target.ref],
      };
    }
    case 'ELASTICACHE_DELETE': {
      const l = await lookup(pricing, {
        kind: 'ELASTICACHE_NODE_HOURLY',
        region: request.region,
        cacheNodeType: request.cacheNodeType,
        cacheEngine: request.cacheEngine,
      });
      if (!l.ok) return { unavailable: l.reason };
      return {
        monthly: l.price.unitPriceUsd * request.numNodes * HOURS_PER_MONTH,
        method: `${fmt(l.price.unitPriceUsd)} USD/hr (${request.cacheNodeType}, ${request.cacheEngine}) x ${request.numNodes} node(s) x ${HOURS_PER_MONTH} hr`,
        assumptions: [
          HOURS_ASSUMPTION,
          'Node-hour charges only: backup storage is excluded, and a final backup kept after deletion is billed separately.',
          'Reserved nodes are not considered; if the cluster is covered by reserved nodes, realized savings may be lower.',
        ],
        sources: [l.ref],
      };
    }
    // ---- EFS
    case 'EFS_DELETE': {
      const classes = efsStorageClasses(request.oneZone);
      const parts = [
        { label: 'Standard', gb: request.standardGb, storageClass: classes.standard },
        { label: 'Infrequent Access', gb: request.infrequentAccessGb, storageClass: classes.ia },
        { label: 'Archive', gb: request.archiveGb, storageClass: EFS_ARCHIVE_CLASS },
      ].filter((part, index) => index === 0 || part.gb > 0);
      const priced = await Promise.all(
        parts.map(async (part) => ({
          ...part,
          l: await lookup(pricing, {
            kind: 'EFS_STORAGE_GB_MONTH',
            region: request.region,
            storageClass: part.storageClass,
          }),
        })),
      );
      let monthly = 0;
      const terms: string[] = [];
      const sources: PricingSourceRef[] = [];
      for (const part of priced) {
        if (!part.l.ok) return { unavailable: `${part.label} storage: ${part.l.reason}` };
        monthly += part.gb * part.l.price.unitPriceUsd;
        terms.push(
          `${fmt(part.gb)} GB x ${fmt(part.l.price.unitPriceUsd)} USD/GB-month (${part.storageClass})`,
        );
        sources.push(part.l.ref);
      }
      return {
        monthly,
        method: terms.join(' + '),
        assumptions: [
          'Storage charges only: throughput (provisioned or elastic), data access and request charges are excluded.',
          'Sizes are the metered sizes reported by EFS, which can lag recent writes and deletes.',
          'Back up the file system before deleting it if the data may be needed; backup storage is billed separately.',
        ],
        sources,
      };
    }
    case 'EFS_LIFECYCLE_TO_IA': {
      const classes = efsStorageClasses(request.oneZone);
      const base = { kind: 'EFS_STORAGE_GB_MONTH' as const, region: request.region };
      const [standard, ia] = await Promise.all([
        lookup(pricing, { ...base, storageClass: classes.standard }),
        lookup(pricing, { ...base, storageClass: classes.ia }),
      ]);
      if (!standard.ok) return { unavailable: `${classes.standard} storage: ${standard.reason}` };
      if (!ia.ok) return { unavailable: `${classes.ia} storage: ${ia.reason}` };
      const diff = standard.price.unitPriceUsd - ia.price.unitPriceUsd;
      if (diff <= 0) {
        return {
          unavailable: `${classes.ia} storage is not cheaper than ${classes.standard} storage in this region.`,
          sources: [standard.ref, ia.ref],
        };
      }
      return {
        monthly: request.standardGb * diff,
        method: `${fmt(request.standardGb)} GB x (${fmt(standard.price.unitPriceUsd)} - ${fmt(ia.price.unitPriceUsd)}) USD/GB-month (${classes.standard} -> ${classes.ia})`,
        assumptions: [
          'Upper bound: assumes all data now in Standard storage is infrequently accessed and moves to Infrequent Access; lifecycle management only moves files that are not accessed for the transition period.',
          'Infrequent Access data-access (per-GB read and write) charges are excluded and reduce the savings for data that is still accessed.',
          'Files smaller than 128 KiB are not moved by lifecycle management and stay in Standard storage.',
        ],
        sources: [standard.ref, ia.ref],
        estimateType: 'UPPER_BOUND',
      };
    }
    // ---- DynamoDB
    case 'DYNAMODB_RIGHTSIZE_PROVISIONED': {
      const readReduction = Math.max(0, request.currentRcu - request.recommendedRcu);
      const writeReduction = Math.max(0, request.currentWcu - request.recommendedWcu);
      if (readReduction === 0 && writeReduction === 0) {
        return {
          unavailable: 'The recommended capacity is not lower than the current provisioned capacity.',
        };
      }
      const capacity = await dynamoCapacityPrices(pricing, request.region, request.tableClass);
      if (!capacity.ok) return { unavailable: capacity.reason };
      const rcu = capacity.rcu.price.unitPriceUsd;
      const wcu = capacity.wcu.price.unitPriceUsd;
      return {
        monthly: (readReduction * rcu + writeReduction * wcu) * HOURS_PER_MONTH,
        method: `(${readReduction} RCU x ${fmt(rcu)} + ${writeReduction} WCU x ${fmt(wcu)}) USD/hr x ${HOURS_PER_MONTH} hr (${request.tableClass})`,
        assumptions: [
          HOURS_ASSUMPTION,
          'Table-level provisioned capacity only; global secondary indexes are excluded.',
          'The recommended capacity is based on hourly peaks with headroom; sub-hour bursts above it would be throttled. Consider auto scaling instead of a fixed lower value.',
          'Reserved capacity is not considered and the DynamoDB Free Tier is ignored.',
        ],
        sources: [capacity.rcu.ref, capacity.wcu.ref],
      };
    }
    case 'DYNAMODB_SWITCH_TO_ON_DEMAND': {
      const capacity = await dynamoCapacityPrices(pricing, request.region, request.tableClass);
      if (!capacity.ok) return { unavailable: capacity.reason };
      const base = {
        kind: 'DYNAMODB_ON_DEMAND_REQUEST_UNIT' as const,
        region: request.region,
        tableClass: request.tableClass,
      };
      const [rru, wru] = await Promise.all([
        lookup(pricing, { ...base, request: 'READ' }),
        lookup(pricing, { ...base, request: 'WRITE' }),
      ]);
      if (!rru.ok) return { unavailable: `On-demand read request units: ${rru.reason}` };
      if (!wru.ok) return { unavailable: `On-demand write request units: ${wru.reason}` };
      const rcu = capacity.rcu.price.unitPriceUsd;
      const wcu = capacity.wcu.price.unitPriceUsd;
      const provisionedMonthly =
        (request.provisionedRcu * rcu + request.provisionedWcu * wcu) * HOURS_PER_MONTH;
      const onDemandMonthly =
        request.monthlyReadUnits * rru.price.unitPriceUsd +
        request.monthlyWriteUnits * wru.price.unitPriceUsd;
      const sources = [capacity.rcu.ref, capacity.wcu.ref, rru.ref, wru.ref];
      const comparison = `Provisioned capacity costs about ${fmt(roundMoney(provisionedMonthly))} USD/month; on-demand at the observed traffic would cost about ${fmt(roundMoney(onDemandMonthly))} USD/month.`;
      if (provisionedMonthly - onDemandMonthly <= 0) {
        return {
          unavailable: 'On-demand is not cheaper at the observed traffic',
          assumptions: [comparison],
          sources,
        };
      }
      return {
        monthly: provisionedMonthly - onDemandMonthly,
        method: `(${request.provisionedRcu} RCU x ${fmt(rcu)} + ${request.provisionedWcu} WCU x ${fmt(wcu)}) USD/hr x ${HOURS_PER_MONTH} hr - (${fmt(request.monthlyReadUnits)} RRU x ${fmt(rru.price.unitPriceUsd)} + ${fmt(request.monthlyWriteUnits)} WRU x ${fmt(wru.price.unitPriceUsd)}) USD`,
        assumptions: [
          HOURS_ASSUMPTION,
          comparison,
          'Consumed capacity units are used as an approximation of on-demand request units.',
          'Assumes traffic stays at the observed level; on-demand cost grows linearly with requests.',
          'Global secondary indexes, storage and other features are unchanged and not included. Reserved capacity is not considered.',
        ],
        sources,
      };
    }
    case 'DYNAMODB_DELETE_TABLE': {
      const provisioned = request.billingMode === 'PROVISIONED';
      const storage = await lookup(pricing, {
        kind: 'DYNAMODB_STORAGE_GB_MONTH',
        region: request.region,
        tableClass: request.tableClass,
      });
      if (!storage.ok) return { unavailable: `Table storage: ${storage.reason}` };
      let monthly = request.storageGb * storage.price.unitPriceUsd;
      const terms = [
        `${fmt(request.storageGb)} GB x ${fmt(storage.price.unitPriceUsd)} USD/GB-month (storage)`,
      ];
      const sources: PricingSourceRef[] = [storage.ref];
      if (provisioned) {
        const capacity = await dynamoCapacityPrices(pricing, request.region, request.tableClass);
        if (!capacity.ok) return { unavailable: capacity.reason };
        const rcu = capacity.rcu.price.unitPriceUsd;
        const wcu = capacity.wcu.price.unitPriceUsd;
        monthly += (request.provisionedRcu * rcu + request.provisionedWcu * wcu) * HOURS_PER_MONTH;
        terms.unshift(
          `(${request.provisionedRcu} RCU x ${fmt(rcu)} + ${request.provisionedWcu} WCU x ${fmt(wcu)}) USD/hr x ${HOURS_PER_MONTH} hr`,
        );
        sources.push(capacity.rcu.ref, capacity.wcu.ref);
      }
      return {
        monthly,
        method: terms.join(' + '),
        assumptions: [
          provisioned
            ? HOURS_ASSUMPTION
            : 'On-demand table: request charges depend on traffic, which is zero for an unused table, so only storage is included.',
          'Storage is priced at the paid rate; the Free Tier storage allowance is ignored.',
          'Backups (on-demand and point-in-time recovery), streams, global secondary indexes and global table replicas are excluded.',
          'Export the table or create a backup before deleting it; that storage is billed separately.',
        ],
        sources,
      };
    }
    // ---- Redshift
    case 'REDSHIFT_PAUSE': {
      const fraction = Math.min(1, request.pausableFraction);
      if (!(fraction > 0)) return { unavailable: 'No pausable time was identified.' };
      const l = await lookup(pricing, {
        kind: 'REDSHIFT_NODE_HOURLY',
        region: request.region,
        nodeType: request.nodeType,
      });
      if (!l.ok) return { unavailable: l.reason };
      const fullMonth = fraction >= 1;
      return {
        monthly: l.price.unitPriceUsd * request.numberOfNodes * HOURS_PER_MONTH * fraction,
        method: `${fmt(l.price.unitPriceUsd)} USD/hr (${request.nodeType}) x ${request.numberOfNodes} node(s) x ${HOURS_PER_MONTH} hr${fullMonth ? '' : ` x ${fmt(fraction)} (pausable share of the month)`}`,
        assumptions: [
          HOURS_ASSUMPTION,
          'Compute (node-hour) charges only: RA3 managed storage, backup storage and data transfer remain billed while the cluster is paused.',
          'A paused cluster cannot run queries; pausing and resuming take several minutes.',
          fullMonth
            ? 'Assumes the cluster stays idle and paused for the whole month.'
            : 'Upper bound: the pausable share is the fraction of hourly periods with no database connections; a pause schedule will cover fewer hours.',
        ],
        sources: [l.ref],
        estimateType: fullMonth ? 'POINT' : 'UPPER_BOUND',
      };
    }
    // ---- AWS Backup
    case 'BACKUP_RETENTION_REDUCE': {
      const other = request.otherGbBeyondRetention;
      const unpriced =
        other > 0
          ? `${fmt(other)} GB of recovery points of other resource types beyond the retention threshold were not priced.`
          : 'All recovery points beyond the retention threshold are EBS or EC2 backups.';
      if (!(request.ebsGbBeyondRetention > 0)) {
        return {
          unavailable: 'No EBS or EC2 recovery points beyond the retention threshold can be priced.',
          assumptions: [unpriced],
        };
      }
      const l = await lookup(pricing, { kind: 'EBS_SNAPSHOT_GB_MONTH', region: request.region });
      if (!l.ok) return { unavailable: l.reason, assumptions: [unpriced] };
      return {
        monthly: request.ebsGbBeyondRetention * l.price.unitPriceUsd,
        method: `up to ${fmt(request.ebsGbBeyondRetention)} GB (EBS/EC2 recovery points beyond retention) x ${fmt(l.price.unitPriceUsd)} USD/GB-month (EBS snapshot)`,
        assumptions: [
          'Only EBS and EC2 recovery points are priced, at the EBS snapshot storage rate.',
          unpriced,
          'Upper bound: EBS backups are incremental, so billed storage is usually smaller than the reported recovery point size, and deleting older recovery points may not free blocks that newer ones still reference.',
          'Retention may be required by legal, regulatory or business policies; confirm before shortening it.',
        ],
        sources: [l.ref],
        estimateType: 'UPPER_BOUND',
      };
    }
  }
}

function unavailableEstimate(
  reason: string,
  now: Date,
  extra: { assumptions?: string[]; sources?: PricingSourceRef[] } = {},
): SavingsEstimate {
  return {
    status: 'UNAVAILABLE',
    estimateType: 'POINT',
    monthly: null,
    annual: null,
    currency: 'USD',
    method: 'Not calculated',
    assumptions: [...(extra.assumptions ?? []), ...COMMON_ASSUMPTIONS],
    pricingSources: extra.sources ?? [],
    unavailableReason: reason,
    calculatedAt: now.toISOString(),
  };
}

/** Builds a SavingsEstimate for one request. Never throws for missing prices: returns UNAVAILABLE instead. */
export async function estimateRequestSavings(
  request: SavingsRequest | null,
  pricing: PriceProvider,
  now: Date,
  fallbackReason = 'No pricing model applies to this recommendation.',
): Promise<SavingsEstimate> {
  if (!request) return unavailableEstimate(fallbackReason, now);
  const result = await compute(request, pricing);
  if ('unavailable' in result) return unavailableEstimate(result.unavailable, now, result);
  return {
    status: 'ESTIMATED',
    estimateType: result.estimateType ?? 'POINT',
    monthly: roundMoney(result.monthly),
    annual: roundMoney(result.monthly * MONTHS_PER_YEAR),
    currency: 'USD',
    method: result.method,
    assumptions: [...result.assumptions, ...COMMON_ASSUMPTIONS],
    pricingSources: result.sources,
    calculatedAt: now.toISOString(),
  };
}

/** Prices a recommendation draft and applies savings-based severity escalation. */
export async function estimateSavings(
  draft: RecommendationDraft,
  pricing: PriceProvider,
  now: Date,
): Promise<PricedRecommendationDraft> {
  const unsupported = draft.issue.evidence.find((e) => e.key === 'pricing.unsupported');
  const savings = await estimateRequestSavings(
    draft.issue.savingsRequest,
    pricing,
    now,
    unsupported ? String(unsupported.value) : undefined,
  );
  return { ...draft, severity: escalateSeverity(draft.issue.baseSeverity, savings.monthly), savings };
}
