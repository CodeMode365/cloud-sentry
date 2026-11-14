# Discovery, Metrics and Cost Collection

Source: `services/scanner/src/{discovery,metrics,costs,normalize}`. These modules are pure with respect to
CloudSentry state: they take AWS SDK clients (already configured with the customer's temporary credentials)
and return typed data. Workflow handlers own persistence, artifacts and scan status.

## Resource discovery

One module per resource type, each `discoverX(client, { accountId, region })`:

| Type          | Module              | AWS API                                        | Pagination                            | Resource ID    | Notes                                                                                                               |
| ------------- | ------------------- | ---------------------------------------------- | ------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| EC2_INSTANCE  | `ec2.ts`            | `ec2:DescribeInstances`                        | `paginateDescribeInstances` (1000)    | instance ID    | `terminated` and `shutting-down` excluded; stopped instances kept (their EBS volumes still bill).                   |
| EBS_VOLUME    | `ebs.ts`            | `ec2:DescribeVolumes`                          | `paginateDescribeVolumes` (500)       | volume ID      |                                                                                                                     |
| ELASTIC_IP    | `eip.ts`            | `ec2:DescribeAddresses`                        | not paginated by AWS                  | allocation ID  | Addresses without an allocation ID (EC2-Classic) are skipped. No creation time is available.                        |
| RDS_INSTANCE  | `rds.ts`            | `rds:DescribeDBInstances`                      | `paginateDescribeDBInstances` (100)   | DB identifier  | Includes Aurora cluster members (`dbClusterIdentifier` set).                                                        |
| EBS_SNAPSHOT  | `snapshots.ts`      | `ec2:DescribeSnapshots` (`OwnerIds: ['self']`) | `paginateDescribeSnapshots` (1000)    | snapshot ID    | `vol-ffffffff` placeholder volume IDs become `null`.                                                                |
| NAT_GATEWAY   | `nat-gateways.ts`   | `ec2:DescribeNatGateways`                      | `paginateDescribeNatGateways` (1000)  | NAT gateway ID | `deleted`/`deleting` excluded.                                                                                      |
| LOAD_BALANCER | `load-balancers.ts` | `elasticloadbalancing:DescribeLoadBalancers`   | `paginateDescribeLoadBalancers` (400) | ARN            | ELBv2 only (ALB/NLB/GWLB). Classic Load Balancers are not supported. Tags are not collected (needs `DescribeTags`). |

ARNs are built from account/region/ID where AWS does not return one. `name` comes from the `Name` tag
(RDS falls back to the DB identifier). `createdAt` comes from LaunchTime / CreateTime / StartTime /
InstanceCreateTime / CreatedTime.

`runRegionalDiscovery(type, regions, clients, { accountId, logger, concurrency = 4 })` runs one type across
regions with bounded concurrency:

- A region that throws is recorded in `regionsFailed` (`errorCode` = AWS error name) and never affects other regions.
- The SDK already retries throttling (adaptive mode, 8 attempts). If throttling still escapes, the whole region is
  retried up to 3 times with exponential backoff and full jitter; other errors are not retried.
- Results are deduplicated by `(region, resourceId)` and duplicate regions in the input are ignored.

Callers must only mark a resource as no longer present for regions listed in `regionsSucceeded`.

## Utilization metrics

`metrics/catalog.ts` lists the metrics per type. Only resources in a meaningful state are queried:
EC2 `running`, EBS `in-use`, RDS `available`, NAT `available`. Elastic IPs, snapshots and load balancers are
not queried (no utilization rule uses them).

| Type | Namespace / dimension              | Metrics (statistic)                                                                                                                                                      |
| ---- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EC2  | `AWS/EC2` / `InstanceId`           | CPUUtilization (Average, Maximum), NetworkIn (Sum), NetworkOut (Sum), DiskReadOps (Sum), DiskWriteOps (Sum), StatusCheckFailed (Maximum)                                 |
| EBS  | `AWS/EBS` / `VolumeId`             | VolumeReadOps, VolumeWriteOps, VolumeReadBytes, VolumeWriteBytes, VolumeIdleTime (all Sum)                                                                               |
| RDS  | `AWS/RDS` / `DBInstanceIdentifier` | CPUUtilization (Average, Maximum), DatabaseConnections (Average, Maximum), FreeableMemory (Average), ReadIOPS (Average), WriteIOPS (Average), FreeStorageSpace (Minimum) |
| NAT  | `AWS/NATGateway` / `NatGatewayId`  | BytesOutToDestination, BytesInFromDestination, BytesInFromSource, BytesOutToSource (Sum), ActiveConnectionCount (Maximum)                                                |

Summaries are keyed `${metricName}:${statistic}` (for example `CPUUtilization:Average`). The analyzer depends on
these keys. EC2 DiskReadOps/DiskWriteOps only report instance-store activity, so EBS-backed instances usually show
`NO_DATA` for them.

`collectUtilization(resources, { cloudwatch(region) }, { lookbackDays, now, periodSeconds = 3600, logger })`:

- Window: `[now - lookbackDays, now]`, both ends floored to the period. One-hour periods keep 30-day windows inside
  CloudWatch's one-hour retention (455 days) and cost the same per metric as finer periods.
- Requests use `GetMetricData` with `ScanBy: TimestampAscending`. Each request holds at most 500 queries and at most
  100,800 expected datapoints (hourly over 30 days = 720 points per query, so 140 queries per request). `NextToken`
  pages are followed and values for the same query are concatenated.
- Statistics (`average`, `minimum`, `maximum`, `p50`, `p95`, `p99`, `sum`) are computed over the per-period
  datapoints, not raw samples. Percentiles therefore describe hourly values.
- `observableDays = min(lookbackDays, age of the resource)`; `expectedDatapoints = floor(observableDays * 86400 / period)`;
  `coverage = datapoints / expectedDatapoints` (capped at 1). Rules use coverage to decide whether they have enough
  evidence.
- Missing data is never zero. No datapoints yields `availability: NO_DATA` with `stats: null`. A query returning
  `Forbidden`/`InternalError` status, or a region whose request throws, yields `availability: ERROR` with the error
  text; the region is also reported in `regionErrors`. Real zero values are `AVAILABLE` with zero statistics.

`partitionForReuse(resources, previous, { reuseHours, lookbackDays, now })` cuts CloudWatch traffic: utilization
collected within `METRICS_REUSE_HOURS` for the same lookback, with no `ERROR`/`NOT_COLLECTED` metrics, is reused.
Everything else that qualifies is collected again.

## Extended services

Contract: [`extended-services.md`](./extended-services.md) sections 1, 2 and 6. One module per type in
`services/scanner/src/discovery/`:

| Type                    | Module                        | Calls (paginated where AWS supports it)                                                         | Tags                |
| ----------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- | ------------------- |
| LAMBDA_FUNCTION         | `lambda-functions.ts`         | `ListFunctions` (`$LATEST`), `ListProvisionedConcurrencyConfigs` per function                   | Tagging API         |
| EKS_CLUSTER             | `eks-clusters.ts`             | `ListClusters`, `DescribeCluster`, `ListNodegroups`, `DescribeNodegroup`, `ListFargateProfiles` | DescribeCluster     |
| ELASTICACHE_CLUSTER     | `elasticache-clusters.ts`     | `DescribeCacheClusters`                                                                         | Tagging API         |
| CLOUDFRONT_DISTRIBUTION | `cloudfront-distributions.ts` | `ListDistributions` (us-east-1 client, once per scan)                                           | not collected       |
| EFS_FILE_SYSTEM         | `efs-file-systems.ts`         | `DescribeFileSystems` (`deleted` excluded), `DescribeLifecycleConfiguration` per fs             | DescribeFileSystems |
| DYNAMODB_TABLE          | `dynamodb-tables.ts`          | `ListTables`, `DescribeTable` per table, `DescribeScalableTargets` (once per region)            | Tagging API         |
| REDSHIFT_CLUSTER        | `redshift-clusters.ts`        | `DescribeClusters` (provisioned only)                                                           | DescribeClusters    |
| BACKUP_PLAN             | `backup-plans.ts`             | `ListBackupPlans`, `GetBackupPlan` per plan                                                     | not collected       |
| BACKUP_VAULT            | `backup-vaults.ts`            | `ListBackupVaults`, `ListRecoveryPointsByBackupVault` per vault (cap 5,000 points)              | not collected       |

- `tagging.ts` `fetchTagsByArn(client, resourceTypeFilters, logger?)` runs one paginated `tag:GetResources` call
  per region and filter. Any failure returns an empty map and logs a warning, so resources get `tags: {}`.
- Per-item sub-calls run through `mapSettledWithConcurrency` with a limit of 5 (`SUB_CALL_CONCURRENCY`). A failed
  sub-call degrades only that item, logs a warning and never fails the region. A failed provisioned-concurrency
  listing gives `provisionedConcurrency: []`. A failed lifecycle call gives `lifecycle: null`. A failed scalable-target
  call gives `autoScalingEnabled: null` for every table. A failed `GetBackupPlan` gives `rules: []`. A failed
  recovery-point listing gives empty totals with `truncated: true`. If `DescribeTable` fails, the table keeps state
  `unknown` and billing mode `UNKNOWN`. If any EKS cluster-level call or a `DescribeNodegroup` fails, the cluster
  keeps state `unknown`, and the failed nodegroup has `status: null` with zero sizes as placeholders. State
  `unknown` means no metrics are collected and no state-gated rule fires. An item reported as `*NotFound` (deleted
  mid-scan) is dropped.
- Backup vault summaries: recovery points are grouped by AWS Backup resource type into non-cumulative age buckets
  (`BACKUP_AGE_BUCKETS_DAYS`; age = `CreationDate` vs `ctx.now`, default the current time). Points without a
  `CreationDate` fall in the 0-day bucket. `resourcesWithMultiplePlans` lists resources with points from 2 or more
  distinct `CreatedBy.BackupPlanId` values in the last 35 days, sorted by ARN, capped at 50.
- `DiscoveryContext` gains optional `logger` (set by `runRegionalDiscovery` per region) and `now`.
- Types in `GLOBAL_RESOURCE_TYPES` (CloudFront) run once with region `global`, whatever the regions list holds.
  Their outcome is reported as `regionsSucceeded: ['global']` or `regionsFailed: [{ region: 'global', ... }]`.

Metrics: catalog entries may override `namespace`/`dimensions` per metric (LambdaInsights `function_name`), add
`extraDimensions` (CloudFront `Region=Global`), produce `dynamicQueries` with custom keys (one
`ProvisionedConcurrencyUtilization:Maximum:<qualifier>` query per provisioned-concurrency config, with dimensions
`FunctionName` + `Resource=<name>:<qualifier>`), and route to another CloudWatch region via `metricsRegion`
(CloudFront uses `us-east-1`). `metricQueriesFor(resource)` resolves all of this and `metricsRegionFor(resource)`
names the CloudWatch region. A query can set `scale`: provisioned-concurrency utilization is a 0..1 ratio in
CloudWatch, so it is multiplied by 100 and reported in `Percent`. `MetricStatistics.zeroFraction` is the share of
datapoints exactly equal to 0, or `null` without datapoints. Reuse also requires the previous utilization to contain
every key the catalog now plans, so a new provisioned-concurrency qualifier is always collected.

## Cost Explorer

`fetchCostSnapshot(ce, { now, months, includeResourceLevel, logger })` returns a `CostSnapshot` without tenant,
account and scan fields.

Every Cost Explorer request is billed (USD 0.01, including each pagination page). A snapshot issues four core
requests, plus one when resource-level data is enabled. Workflow handlers must reuse snapshots younger than
`COST_REFRESH_HOURS`.

| Query                    | Granularity | Range                                             | Grouping                                                            |
| ------------------------ | ----------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| monthlyTrend             | MONTHLY     | first day of the month `months` back, to tomorrow | none                                                                |
| daily                    | DAILY       | first day of previous month, to tomorrow          | none                                                                |
| services                 | MONTHLY     | first day of current month, to tomorrow           | `SERVICE`                                                           |
| regions                  | MONTHLY     | first day of current month, to tomorrow           | `REGION`                                                            |
| resourceLevel (optional) | DAILY       | today minus 13 days, to tomorrow                  | `RESOURCE_ID`, filtered to `Amazon Elastic Compute Cloud - Compute` |

- Cost Explorer's End date is exclusive, so ranges that should include today end tomorrow. That also keeps
  `Start < End` on the first day of a month. Tomorrow is at most the first day of next month, which Cost Explorer
  accepts.
- `previousMonthToDate` (previous month, days 1 to today's day-of-month) is derived from the daily series, which
  saves a billed request.
- The metric is `UnblendedCost`. Values are actual AWS costs. Periods AWS marks `Estimated` are reported as
  `unfinalized`; they are still billed amounts, just not final.
- Each query fails on its own and is recorded in `errors`. If all four core queries fail, availability is
  `UNAVAILABLE` with an explanation (for example `AccessDeniedException` becomes "Cost Explorer access denied or not
  enabled for this account"). If some fail, availability is `PARTIAL`.
- Resource-level data needs the customer to opt in to "hourly and resource level granularity" in Cost Explorer
  settings, which AWS bills separately. `DataUnavailableException`/`ValidationException` therefore mark only
  `resourceLevel` as `UNAVAILABLE`. When it is available, amounts are 14-day totals, not monthly costs.

`detectDailyAnomalies(daily, { minHistory = 14, zThreshold = 3, minAbsoluteDeviation = 1 })` flags upward spikes.
A day is anomalous when it is at least `zThreshold` standard deviations and at least USD 1 above the mean of the
previous 14 days. If those 14 days have zero variance, the day must instead exceed their mean by more than 50%.
Windows whose mean is zero are skipped, because a percentage deviation from zero is undefined.

## Normalization

`normalizeResources(discovered, utilization, { succeededRegionsByType })` builds the detection input:

- `resourceKey = base64url(accountId|region|resourceType|resourceId)`.
- Utilization is attached when present, otherwise `null`.
- `EBS_SNAPSHOT.attributes.sourceVolumeExists` is only `true`/`false` when EBS volume discovery succeeded in that
  region. It is `false` when the snapshot has no usable volume ID, and `null` when the region's volume inventory is
  unknown.
- Output is deduplicated by `resourceKey` and sorted by it.

## Tests

Colocated `*.test.ts` files use `aws-sdk-client-mock`. They cover pagination and field mapping for every discovery
module, regional failure isolation, throttling retries and deduplication, metric batching (both the 500-query and
the datapoint limit), `NO_DATA` vs zero, coverage, `NextToken`, region failure, reuse partitioning, Cost Explorer
parsing (including `Estimated`, pagination, partial and denied access, resource-level opt-in, and first-day-of-month
ranges), anomaly detection and normalization. Extended-service tests also cover sub-call degradation, the tagging
helper, the run-once behaviour for global types, per-qualifier Lambda keys, CloudFront routing to us-east-1,
`zeroFraction`, and backup age buckets, multiple-plan detection and truncation. Fixtures in `src/__fixtures__/` are
synthetic, SDK-shaped responses, used only by tests.
