# Savings Estimation

`services/recommendation` turns detected issues into recommendations and prices them. All savings are
**estimates**. CloudSentry never claims they are guaranteed, and it never invents a price: when a price
cannot be determined, the estimate has `status: UNAVAILABLE` and a reason.

## Pipeline

1. **GenerateRecommendations** (`runGenerateRecommendationsStep`): `findings.json` →
   `recommendations.json`. Each issue produces exactly one `RecommendationDraft`, with ID
   `recommendationIdFor(findingId)`.
2. **EstimateSavings** (`runEstimateSavingsStep`): `recommendations.json` →
   `recommendations-priced.json`. Each draft gets a `SavingsEstimate` and a final severity.

## Pricing engine

The pricing engine is a stack of providers:

```
memoizePriceProvider (per run; dedupes identical queries)
  -> CachedPriceProvider (DynamoDB PriceCache; 7-day TTL, 1-day TTL for "no match"/"ambiguous", API errors never cached)
     -> AwsPriceListProvider (pricing:GetProducts, us-east-1 endpoint, CloudSentry's own credentials)
```

Construct the production engine with `createPricingService({ logger, cache })`. The step wraps it
with `memoizePriceProvider` on each run. Detection rules only emit a `SavingsRequest`, so pricing
sources can change without touching the rules.

`AwsPriceListProvider` uses `TERM_MATCH` filters. It keeps only products whose `usagetype` matches the
pattern below; the pattern may carry a region prefix such as `USW2-` (us-east-1 usually has none). Some
specs also carry an **exclusion** pattern that drops decoy products sharing the same filters. It reads
on-demand price dimensions in the expected unit. The filters were verified against live responses.

| Query            | Service   | Filters                                                                                               | usagetype                                               | Unit  |
| ---------------- | --------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----- |
| EC2 instance     | AmazonEC2 | regionCode, instanceType, operatingSystem, tenancy, capacitystatus=Used, preInstalledSw, licenseModel | `BoxUsage:` / `DedicatedUsage:` / `HostBoxUsage:`       | Hrs   |
| EBS storage      | AmazonEC2 | regionCode, productFamily=Storage, volumeApiName                                                      | `EBS:VolumeUsage[.type]`                                | GB-Mo |
| EBS snapshot     | AmazonEC2 | regionCode, productFamily=Storage Snapshot                                                            | `EBS:SnapshotUsage` (not archive)                       | GB-Mo |
| Idle public IPv4 | AmazonVPC | regionCode, group=VPCPublicIPv4Address                                                                | `PublicIPv4:IdleAddress`                                | Hrs   |
| RDS instance     | AmazonRDS | regionCode, instanceType, databaseEngine, deploymentOption                                            | `InstanceUsage:` / `Multi-AZUsage:` (never `UnusedBox`) | Hrs   |
| NAT Gateway      | AmazonEC2 | regionCode, productFamily=NAT Gateway                                                                 | `NatGateway-Hours` (not Regional/Bytes/Prvd)            | Hrs   |

### Extended services

| Query kind                                 | Service           | Filters                                                                                                  | usagetype (exclusions)                                                                                                                                                                     | Unit                                | Tier    |
| ------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ------- |
| `LAMBDA_GB_SECOND`                         | AWSLambda         | regionCode, group=`AWS-Lambda-Duration` (x86_64) / `AWS-Lambda-Duration-ARM` (arm64)                     | `Lambda-GB-Second[-ARM]`                                                                                                                                                                   | Lambda-GB-Second                    | `first` |
| `LAMBDA_PROVISIONED_CONCURRENCY_GB_SECOND` | AWSLambda         | regionCode, group=`AWS-Lambda-Provisioned-Concurrency` (arm64: `...-ARM`; no products => unavailable)    | `Lambda-Provisioned-Concurrency[-ARM]` (not the provisioned-duration charge)                                                                                                               | Lambda-GB-Second                    | `first` |
| `EKS_CLUSTER_HOURLY`                       | AmazonEKS         | regionCode                                                                                               | STANDARD: `AmazonEKS-Hours:perCluster`; EXTENDED: `AmazonEKS-Hours:extendedSupport` (the surcharge only)                                                                                   | Hours (or Hrs)                      | `first` |
| `ELASTICACHE_NODE_HOURLY`                  | AmazonElastiCache | regionCode, instanceType, cacheEngine (Redis / Valkey / Memcached)                                       | `^(?:[A-Z]{2,4}\d?-)?NodeUsage:` (excludes `ExtendedSupport`, `SyncDurability`)                                                                                                            | Hrs                                 | `first` |
| `EFS_STORAGE_GB_MONTH`                     | AmazonEFS         | regionCode, productFamily=Storage, storageClass                                                          | per class: `TimedStorage-ByteHrs`, `IATimedStorage-ByteHrs`, `ArchiveTimedStorage-ByteHrs`, `TimedStorage-Z-ByteHrs`, `IATimedStorage-Z-ByteHrs` (excludes `-ET-`, `SmallFiles`, `Access`) | GB-Mo                               | `first` |
| `DYNAMODB_PROVISIONED_CAPACITY_HOURLY`     | AmazonDynamoDB    | regionCode, productFamily=Provisioned IOPS, group=`DDB-ReadUnits` / `DDB-WriteUnits` (IA class: `...IA`) | `ReadCapacityUnit-Hrs` / `WriteCapacityUnit-Hrs` (excludes `Repl`, `Vector`)                                                                                                               | Read/WriteCapacityUnit-Hrs (or Hrs) | `paid`  |
| `DYNAMODB_ON_DEMAND_REQUEST_UNIT`          | AmazonDynamoDB    | regionCode, productFamily=Amazon DynamoDB PayPerRequest Throughput                                       | exactly `ReadRequestUnits` / `WriteRequestUnits` after the region prefix (IA class: `IA-` prefixed; standard excludes `IA-`; both exclude `Repl`, `Vector`)                                | Read/WriteRequestUnits              | `first` |
| `DYNAMODB_STORAGE_GB_MONTH`                | AmazonDynamoDB    | regionCode, productFamily=Database Storage                                                               | `TimedStorage-ByteHrs` (IA class: `IA-TimedStorage-ByteHrs`; standard excludes `IA-`; both exclude `PITR`)                                                                                 | GB-Mo                               | `paid`  |
| `REDSHIFT_NODE_HOURLY`                     | AmazonRedshift    | regionCode, instanceType=node type, productFamily=Compute Instance                                       | `Node:<nodeType>`                                                                                                                                                                          | Hrs                                 | `first` |

### Tier strategy

Each `QuerySpec` declares a `tier` (`TierStrategy`, applied by `selectTierDimensions`):

- `first`: use the dimension whose `beginRange` is `0` (or that has no range). This is the original
  behaviour, and tier 1 is normally the highest price. Lambda duration uses it: savings are priced at the
  first volume tier, which is an upper bound for accounts in a cheaper tier.
- `paid`: use the dimension with the highest `beginRange` whose price is above zero. DynamoDB
  provisioned capacity and DynamoDB storage use it, because their `beginRange` 0 row is the $0 Free Tier
  allowance. Pricing those rows with `first` would always report zero savings.

The lookup fails safe:

- No matching price gives `NO_MATCHING_PRICE`. This includes a `paid` product whose rows are all $0.
- More than one distinct price gives `AMBIGUOUS_PRICE`.
- An API failure (after retrying transient errors) gives `PRICING_API_ERROR`.

In each case the price is null.

## Formulas

`HOURS_PER_MONTH = 730`. Annual = monthly × 12. Values are rounded to cents.

| Request               | Formula                                                            | Notes                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `EC2_INSTANCE_STOP`   | on-demand hourly × 730                                             | Unavailable for spot and capacity-block instances. Attached EBS is still billed.                                                             |
| `EBS_VOLUME_DELETE`   | size GiB × GB-month price                                          | Provisioned IOPS and throughput are excluded, so actual savings may be higher. A snapshot taken before deletion offsets part of the savings. |
| `ELASTIC_IP_RELEASE`  | idle public IPv4 hourly × 730                                      | Free Tier is not considered.                                                                                                                 |
| `RDS_RIGHTSIZE`       | (current − target) hourly × 730, same engine and deployment option | Unavailable if there is no target, the engine is unsupported, or the target is not cheaper.                                                  |
| `RDS_STOP`            | instance hourly × 730                                              | Storage and backups are still billed. AWS restarts stopped instances after 7 days.                                                           |
| `EBS_SNAPSHOT_DELETE` | source volume GiB × snapshot GB-month                              | **UPPER_BOUND**: snapshots are incremental.                                                                                                  |
| `NAT_GATEWAY_DELETE`  | hourly × 730                                                       | Data processing and replacement connectivity are excluded.                                                                                   |

### Extended services

| Request                                 | Formula                                                                                      | Estimate                                | Notes                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LAMBDA_MEMORY_RIGHTSIZE`               | (current − recommended) MB / 1024 × monthly duration s × GB-s price                          | UPPER_BOUND                             | Less memory means less CPU, so duration may rise. Uses the tier-1 price. Request charges are unchanged. Unavailable if the recommendation is not lower.                                                                                                                                                                                    |
| `LAMBDA_ARM64_MIGRATION`                | memory MB / 1024 × monthly duration s × (x86_64 − arm64 GB-s price)                          | POINT                                   | Two lookups. Assumes the same duration on arm64; compatibility testing is required. Unavailable if arm64 is not cheaper.                                                                                                                                                                                                                   |
| `LAMBDA_PROVISIONED_CONCURRENCY_REDUCE` | (current − recommended) × memory MB / 1024 × 730 × 3600 × PC GB-s price                      | POINT                                   | The allocation is billed whether used or not. Requests above the new allocation run on-demand (standard duration rate, cold starts), which is not included. arm64 without an `-ARM` product is unavailable.                                                                                                                                |
| `EKS_CLUSTER_DELETE`                    | (control plane + extended-support surcharge if EXTENDED) hourly × 730                        | POINT                                   | **Two queries** for EXTENDED (`supportType` STANDARD + EXTENDED), summed; either missing makes it unavailable. Nodes, Fargate, load balancers and storage are excluded.                                                                                                                                                                    |
| `EKS_NODES_REDUCE`                      | removable nodes × EC2 on-demand hourly × 730                                                 | UPPER_BOUND                             | Uses `EC2_INSTANCE_HOURLY` with the request's operatingSystem, tenancy Shared, preInstalledSw NA, licenseModel `No License required`, capacitystatus Used. Capacity type other than `ON_DEMAND`/null (for example SPOT) is unavailable without a lookup; null is priced as on-demand and says so. Assumes pods fit on the remaining nodes. |
| `ELASTICACHE_RIGHTSIZE`                 | (current − target node hourly) × nodes × 730                                                 | POINT                                   | Unavailable without a target or if the target is not cheaper. Reserved nodes are not considered.                                                                                                                                                                                                                                           |
| `ELASTICACHE_DELETE`                    | node hourly × nodes × 730                                                                    | POINT                                   | Backup storage is excluded.                                                                                                                                                                                                                                                                                                                |
| `EFS_DELETE`                            | Standard GB × Standard + IA GB × IA + Archive GB × Archive (One Zone classes when `oneZone`) | POINT                                   | Only classes holding data are looked up (Standard always). Throughput and access charges are excluded.                                                                                                                                                                                                                                     |
| `EFS_LIFECYCLE_TO_IA`                   | Standard GB × (Standard − IA)                                                                | UPPER_BOUND                             | Assumes all Standard data is infrequently accessed. IA access charges are excluded. Files under 128 KiB stay in Standard.                                                                                                                                                                                                                  |
| `DYNAMODB_RIGHTSIZE_PROVISIONED`        | ((cur R − rec R) × RCU-hr + (cur W − rec W) × WCU-hr) × 730                                  | POINT                                   | Paid-tier prices. Negative per-side reductions count as 0; unavailable if neither side is reduced. GSIs are excluded; the Free Tier is ignored.                                                                                                                                                                                            |
| `DYNAMODB_SWITCH_TO_ON_DEMAND`          | (R × RCU-hr + W × WCU-hr) × 730 − (monthly read units × RRU + monthly write units × WRU)     | POINT                                   | Four lookups. A difference ≤ 0 is unavailable with reason `On-demand is not cheaper at the observed traffic`; both monthly figures are listed in the assumptions. Consumed units approximate request units; traffic is assumed to stay as observed.                                                                                        |
| `DYNAMODB_DELETE_TABLE`                 | capacity cost (PROVISIONED only) + storage GB × storage price                                | POINT                                   | Storage at the paid tier. Backups, PITR, streams, GSIs and replicas are excluded.                                                                                                                                                                                                                                                          |
| `REDSHIFT_PAUSE`                        | node hourly × nodes × 730 × pausable fraction (clamped to 1)                                 | POINT if fraction ≥ 1, else UPPER_BOUND | A fraction ≤ 0 is unavailable. RA3 managed storage and backups are still billed while paused.                                                                                                                                                                                                                                              |
| `BACKUP_RETENTION_REDUCE`               | EBS/EC2 GB beyond retention × EBS snapshot GB-month (`EBS_SNAPSHOT_GB_MONTH`)                | UPPER_BOUND                             | Only EBS/EC2 recovery points are priced. The assumptions state how many GB of other recovery points were **not priced**. Incremental storage makes the reported size an upper bound. With no EBS GB the estimate is unavailable.                                                                                                           |

### Example prices (verified 2026-11-14, us-east-1)

These are the prices the live Price List API returned when the queries were verified. They are
**examples for checking the query specs, not constants**: the engine always reads current prices from the
API, and none of these values appear in runtime code.

| Query                                          | Example price                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| Lambda duration, tier 1 (x86_64 / arm64)       | 0.0000166667 / 0.0000133334 USD per Lambda-GB-Second                                   |
| Lambda provisioned concurrency (x86_64)        | 0.0000041667 USD per Lambda-GB-Second                                                  |
| EKS control plane / extended-support surcharge | 0.10 / +0.50 USD per cluster-hour                                                      |
| ElastiCache node                               | cache.r6g.large Redis 0.206, Valkey 0.1648; cache.t3.micro Memcached 0.017 USD/hr      |
| EFS storage                                    | Standard 0.30, IA 0.025, Archive 0.008, One Zone 0.16, One Zone-IA 0.0133 USD/GB-month |
| DynamoDB provisioned (paid tier)               | RCU-hr 0.00013, WCU-hr 0.00065 (IA class 0.00016 / 0.00081) USD                        |
| DynamoDB on-demand                             | 0.000000125 USD per RRU, 0.000000625 USD per WRU                                       |
| DynamoDB storage (paid tier)                   | 0.25 USD/GB-month (IA class 0.10)                                                      |
| Redshift node                                  | ra3.xlplus 1.086 USD/hr                                                                |

Every estimate also carries these assumptions:

- It uses public on-demand list prices. Taxes, credits and private discounts are not applied.
- Reserved Instance and Savings Plans coverage is not considered.
- It is not a guaranteed saving.

`pricingSources` records the exact query, unit price, SKU and effective date behind each number. Requests
that need several prices (RDS and ElastiCache rightsizing, Lambda arm64, EKS extended support, EFS,
DynamoDB) list one source per lookup. The per-run `memoizePriceProvider` dedupes them by
`priceCacheKey`, so, for example, every EKS cluster in a region shares one control-plane lookup.

## Severity escalation

| Estimated monthly savings | Minimum severity |
| ------------------------- | ---------------- |
| ≥ 1000 USD                | CRITICAL         |
| ≥ 250 USD                 | HIGH             |
| ≥ 25 USD                  | MEDIUM           |

The final severity is `max(rule base severity, tier)`. Unpriced recommendations keep their base
severity.

## Cost-type separation

- **Actual billed cost** comes from Cost Explorer (scanner). It is never mixed with these estimates.
- **Estimated resource cost** and **estimated potential savings** come from this engine, and are always
  labelled as estimates.
- **Realized savings** are tracked by the persistence layer when an ACCEPTED recommendation's issue
  disappears. They remain estimates based on pre-change pricing, not billing measurements.
