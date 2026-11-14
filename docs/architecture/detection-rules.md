# Detection Rules

The waste-detection engine (`services/analyzer`) is deterministic: the same normalized resources,
detection settings and clock always produce the same findings. No machine-learning model or LLM is
involved in deciding whether a resource is wasteful, and CloudSentry never acts on a finding: every
suggested action is carried out by a person.

## Engine

`runDetection(resources, { settings, now })` returns a `DetectionResult`:

- `issues`: one `DetectedIssue` for each (rule, resource) pair where the rule fired.
- `evaluations`: one entry for each (enabled rule, resource of that rule's type), with outcome
  `DETECTED`, `NOT_DETECTED` or `NOT_EVALUATED` plus a reason code. PersistResults uses this list to
  resolve findings that are no longer detected. Only `NOT_DETECTED` resolves a finding. `NOT_EVALUATED`
  (for example, missing metrics) leaves the existing finding unchanged.
- `rulesExecuted`: each rule's ID, version, enabled flag and the thresholds it actually used.

Finding IDs are `findingIdFor(accountId, region, ruleId, resourceId)`, a hash of the issue's natural
identity. The same issue therefore keeps the same ID across scans. This is what makes deduplication
and lifecycle tracking work.

### Configuration

Thresholds come from each rule's defaults, merged with the tenant's `DetectionSettings.rules[ruleId]`:

- Override keys the rule does not define are ignored.
- Override values that are not finite non-negative numbers fall back to the default. The step logs a
  warning that names the ignored keys.
- `enabled: false` turns a rule off. A disabled rule appears in `rulesExecuted` but produces no
  evaluations, so its existing findings are not resolved.

A resource is excluded from all rules (reason `EXCLUDED_BY_TAG`) when it carries the tag
`<ignoreTagKey>=true`. The default key is `cloudsentry:ignore`, and the value comparison is
case-insensitive.

If a rule throws an exception, the engine records it as `NOT_EVALUATED` with reason `RULE_ERROR: ...`.
The step then reports `PARTIAL` and logs a sample of the errors. A single bad record never aborts the
run.

### Metric handling

All rules read summaries keyed by `${MetricName}:${Statistic}`.

- If there is no utilization data, a series is missing, a series is not `AVAILABLE`, or a series has zero
  datapoints, the result is `NOT_EVALUATED`. Missing data is never treated as zero.
- If coverage (datapoints / expected hourly datapoints) is below `minCoverage`, the result is
  `NOT_EVALUATED` with reason `INSUFFICIENT_METRIC_COVERAGE`.
- `observableDays` comes from the scanner. It is the lookback period, limited by the resource's creation
  time. Rules compare it against `minObservationDays`.
- Sum-statistic metrics are converted to per-day values as mean-per-period × (86400 / period). This
  averages only over the periods that have data, so it stays accurate when coverage is partial.
- Rules for the extended services follow one more principle: **observed activity is conclusive, absence
  needs coverage.** A single datapoint above the threshold (connections, requests, I/O, consumed capacity)
  proves the resource is used, so those rules return `NOT_DETECTED` at any coverage. Concluding that a
  resource is idle or unused requires `minCoverage` to be met; otherwise the result is `NOT_EVALUATED`
  (`INSUFFICIENT_METRIC_COVERAGE`).
- Some metrics only exist when an agent or feature is enabled. Their absence is reported with a specific
  reason instead of `METRIC_NO_DATA`: `LAMBDA_INSIGHTS_NOT_ENABLED` (Lambda Insights) and
  `CONTAINER_INSIGHTS_NOT_ENABLED` (CloudWatch Container Insights).
- `MetricStatistics.zeroFraction` (share of datapoints equal to 0, null without datapoints) is used by
  `redshift-pause-schedule` to estimate idle hours.

### Discovery placeholders and missing metadata

Discovery records explicit placeholders when an API call fails. Rules never read them as real zeros:

| Placeholder                                                       | Rules affected                      | Outcome                                                                                                                                             |
| ----------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| EKS cluster `state: 'unknown'`                                    | all EKS rules                       | `NOT_EVALUATED` (`CLUSTER_DETAILS_UNAVAILABLE`)                                                                                                     |
| EKS node group `status: null` (sizes are placeholders 0)          | all EKS rules                       | `NOT_EVALUATED` (`NODEGROUP_DETAILS_UNAVAILABLE: <names>`)                                                                                          |
| DynamoDB `state: 'unknown'`, billing mode / table class `UNKNOWN` | all DynamoDB rules                  | `NOT_EVALUATED` (`TABLE_DETAILS_UNAVAILABLE`)                                                                                                       |
| DynamoDB `autoScalingEnabled: null`                               | `dynamodb-overprovisioned-capacity` | `NOT_EVALUATED` (`AUTOSCALING_UNKNOWN`)                                                                                                             |
| EFS `lifecycle: null`                                             | `efs-missing-lifecycle`             | `NOT_EVALUATED` (`LIFECYCLE_CONFIGURATION_UNKNOWN`)                                                                                                 |
| Backup vault `state: 'unknown'` (listing failed)                  | both vault rules                    | `NOT_EVALUATED` (`RECOVERY_POINTS_UNAVAILABLE`)                                                                                                     |
| Backup vault `truncated: true`                                    | both vault rules                    | totals are a lower bound: detection may fire ("at least" in evidence); nothing found is `NOT_EVALUATED` (`TRUNCATED_LISTING`), never `NOT_DETECTED` |
| Backup plan `state: 'unknown'`                                    | `backup-excessive-retention`        | `NOT_EVALUATED` (`PLAN_DETAILS_UNAVAILABLE`)                                                                                                        |

AWS reports no creation time for Lambda functions and CloudFront distributions (`createdAt: null`). Rules
without an age gate are unaffected. Rules with an age gate (`idle-eks-cluster`, `unused-efs`,
`unused-dynamodb-table`) fall back to the observed period (`observableDays`) when `createdAt` is null, and
say so in the age evidence; if neither is known the result is `NOT_EVALUATED` (`CREATION_TIME_UNKNOWN`).

AWS Backup plans and vaults are discovered without tags (`tags: {}`), so the ignore tag cannot exclude
them. Disable the rule instead, or adjust its thresholds.

### Rules defined relative to another rule

`RuleContext.ruleThresholds` carries the effective thresholds of every rule in the run (enabled or not).
`dynamodb-overprovisioned-capacity` uses it to evaluate the `dynamodb-capacity-mode` condition with that
rule's (possibly overridden) thresholds, so the two rules are mutually exclusive even with tenant
overrides. When the map is absent (unit tests), the other rule's defaults are used.

## Rules

| Rule ID                               | Resource                | Category        | Default severity          |
| ------------------------------------- | ----------------------- | --------------- | ------------------------- |
| `idle-ec2`                            | EC2_INSTANCE            | IDLE            | MEDIUM                    |
| `unattached-ebs`                      | EBS_VOLUME              | UNUSED          | MEDIUM                    |
| `unassociated-eip`                    | ELASTIC_IP              | UNUSED          | LOW                       |
| `underutilized-rds`                   | RDS_INSTANCE            | OVERPROVISIONED | MEDIUM (HIGH when unused) |
| `old-ebs-snapshots`                   | EBS_SNAPSHOT            | RETENTION       | LOW                       |
| `idle-nat-gateway`                    | NAT_GATEWAY             | IDLE            | MEDIUM                    |
| `lambda-overprovisioned-memory`       | LAMBDA_FUNCTION         | OVERPROVISIONED | MEDIUM                    |
| `lambda-arm64-migration`              | LAMBDA_FUNCTION         | OVERPROVISIONED | MEDIUM                    |
| `lambda-idle-provisioned-concurrency` | LAMBDA_FUNCTION         | IDLE            | MEDIUM                    |
| `lambda-near-timeout`                 | LAMBDA_FUNCTION         | OVERPROVISIONED | LOW                       |
| `idle-eks-cluster`                    | EKS_CLUSTER             | IDLE            | MEDIUM                    |
| `underutilized-eks-nodes`             | EKS_CLUSTER             | OVERPROVISIONED | MEDIUM                    |
| `eks-oversized-requests`              | EKS_CLUSTER             | OVERPROVISIONED | MEDIUM                    |
| `underutilized-elasticache`           | ELASTICACHE_CLUSTER     | OVERPROVISIONED | MEDIUM                    |
| `idle-elasticache`                    | ELASTICACHE_CLUSTER     | IDLE            | MEDIUM                    |
| `idle-cloudfront-distribution`        | CLOUDFRONT_DISTRIBUTION | IDLE            | MEDIUM                    |
| `cloudfront-compression-disabled`     | CLOUDFRONT_DISTRIBUTION | OVERPROVISIONED | LOW                       |
| `unused-efs`                          | EFS_FILE_SYSTEM         | UNUSED          | MEDIUM                    |
| `efs-missing-lifecycle`               | EFS_FILE_SYSTEM         | OVERPROVISIONED | MEDIUM                    |
| `dynamodb-overprovisioned-capacity`   | DYNAMODB_TABLE          | OVERPROVISIONED | MEDIUM                    |
| `dynamodb-capacity-mode`              | DYNAMODB_TABLE          | OVERPROVISIONED | MEDIUM                    |
| `unused-dynamodb-table`               | DYNAMODB_TABLE          | UNUSED          | MEDIUM                    |
| `idle-redshift-cluster`               | REDSHIFT_CLUSTER        | IDLE            | MEDIUM                    |
| `redshift-pause-schedule`             | REDSHIFT_CLUSTER        | IDLE            | MEDIUM                    |
| `backup-excessive-retention`          | BACKUP_PLAN             | RETENTION       | MEDIUM                    |
| `backup-vault-old-recovery-points`    | BACKUP_VAULT            | RETENTION       | MEDIUM                    |
| `backup-redundant-plans`              | BACKUP_VAULT            | OVERPROVISIONED | MEDIUM                    |

The final severity is `max(base severity, savings tier)`. The savings tier is applied by the savings
engine (see `savings-estimation.md`).

### idle-ec2

The rule fires only when every condition below holds. A low average CPU on its own is never enough.

| Threshold              | Default | Meaning                                                                         |
| ---------------------- | ------- | ------------------------------------------------------------------------------- |
| `cpuAverageMaxPercent` | 5       | Average `CPUUtilization:Average` must be below this                             |
| `cpuMaximumMaxPercent` | 10      | Maximum of `CPUUtilization:Maximum` must be below this                          |
| `networkMaxMbPerDay`   | 5       | `NetworkIn:Sum` + `NetworkOut:Sum` per day (MB = 10^6 bytes) must be below this |
| `minObservationDays`   | 14      | Minimum observable days                                                         |
| `minCoverage`          | 0.8     | Minimum coverage for every metric listed above                                  |

- States `stopped`, `stopping`, `terminated` and `shutting-down` give `NOT_DETECTED`, which resolves an
  earlier idle finding. Other states that are not `running` give `NOT_EVALUATED`.
- Confidence is HIGH when coverage is at least 95% and there are at least 28 observable days.
  Otherwise it is MEDIUM. Risk is MEDIUM.
- The savings request is `EC2_INSTANCE_STOP`. Price List attributes are derived from `PlatformDetails`
  and tenancy.
  - Unsupported platforms and Dedicated Host tenancy get no savings request. Dedicated Hosts are billed
    per host. In both cases the reason is recorded as `pricing.unsupported` evidence.
  - Spot and capacity-block lifecycles are passed through, and the savings engine reports them as
    unavailable.

### unattached-ebs

| Threshold               | Default | Meaning                                                              |
| ----------------------- | ------- | -------------------------------------------------------------------- |
| `minAgeDays`            | 7       | Volumes younger than this are not flagged                            |
| `highConfidenceAgeDays` | 30      | Volumes older than this get HIGH confidence; younger ones get MEDIUM |

- The rule fires when the volume state is `available` and it has no active attachments.
- Evidence includes:
  - size, type and age
  - tags
  - the number and date of discovered snapshots that reference the volume
- Risk is LOW when a snapshot exists and MEDIUM otherwise.
- The steps tell the user to snapshot the volume first if they are in doubt. CloudSentry never deletes
  volumes.
- If the creation time is unknown, the result is `NOT_EVALUATED`.

### unassociated-eip

- The rule fires when the address has no association ID, no instance ID and no network interface ID.
- Confidence is HIGH. Risk is MEDIUM, because a released address may not be recoverable and may be on
  external allowlists.

### underutilized-rds

| Threshold               | Default | Meaning                                     |
| ----------------------- | ------- | ------------------------------------------- |
| `cpuAverageMaxPercent`  | 10      | Average CPU below this                      |
| `cpuMaximumMaxPercent`  | 40      | Peak hourly CPU below this                  |
| `connectionsAverageMax` | 5       | Average `DatabaseConnections` below this    |
| `iopsAverageMax`        | 50      | Average `ReadIOPS` + `WriteIOPS` below this |
| `minObservationDays`    | 14      |                                             |
| `minCoverage`           | 0.8     |                                             |

- If `DatabaseConnections:Maximum` is 0 for the whole period, the database is treated as unused:
  - action `STOP_DATABASE` (`RDS_STOP`)
  - severity HIGH, risk HIGH
- Otherwise the action is `RIGHTSIZE_DATABASE` to the next smaller class in the same family.
  - Size order: micro, small, medium, large, xlarge, 2xlarge, 4xlarge, 8xlarge, 12xlarge, 16xlarge,
    24xlarge.
  - Burstable `db.t*` families can go down to micro. Other families stop at large.
  - When no smaller size exists, the target is null and savings are reported as unavailable.
- Aurora and cluster members (`dbClusterIdentifier` set) are `NOT_EVALUATED`.
- Multi-AZ is noted in the evidence.
- `FreeStorageSpace:Minimum` is reported as evidence. RDS storage cannot be shrunk in place.
- Engines that are not open source (Oracle, SQL Server, Aurora and others) produce `databaseEngine: null`,
  so savings are reported as unavailable.

### old-ebs-snapshots

| Threshold       | Default | Meaning                                                    |
| --------------- | ------- | ---------------------------------------------------------- |
| `retentionDays` | 180     | Snapshots older than this are flagged for retention review |

Some snapshots are never flagged. They get `NOT_EVALUATED` with one of these reasons:

- `SNAPSHOT_NOT_COMPLETED`: the snapshot is not completed.
- `MANAGED_BY_AWS_BACKUP`: the snapshot has the tag `aws:backup:source-resource`, or its description
  mentions AWS Backup.
- `MANAGED_BY_DLM`: the snapshot has the tag `aws:dlm:lifecycle-policy-id`.
- `AMI_BACKING_SNAPSHOT`: the description contains `Created by CreateImage`.

An old snapshot is not assumed to be unnecessary:

- Confidence is LOW. It is MEDIUM only when the source volume no longer exists and the snapshot is more
  than twice the retention age.
- Risk is HIGH when the source volume is gone, because the snapshot may be the only remaining copy of
  that data. Otherwise risk is MEDIUM.
- The action is always a review (`REVIEW_SNAPSHOT_RETENTION`), never a deletion.
- Archive-tier snapshots get no savings request.

### idle-nat-gateway

| Threshold              | Default | Meaning                                                                      |
| ---------------------- | ------- | ---------------------------------------------------------------------------- |
| `maxGbPerDay`          | 1       | `BytesOutToDestination` + `BytesInFromDestination` per day (GB = 10^9 bytes) |
| `maxActiveConnections` | 10      | `ActiveConnectionCount:Maximum` below this                                   |
| `minObservationDays`   | 14      |                                                                              |
| `minCoverage`          | 0.8     |                                                                              |

- Low traffic does not prove the gateway can be removed, so the rule is conservative:
  - Risk is always HIGH.
  - Confidence is never HIGH. It is MEDIUM with at least 95% coverage and at least 28 days, and LOW
    otherwise.
- The action is `REVIEW_NAT_GATEWAY`. The steps cover route tables, infrequent egress and VPC endpoints.

## Extended service rules

The contract between discovery, detection and savings for these services is
[`extended-services.md`](./extended-services.md). Every metric-based rule below has `minObservationDays`
(default 14) and `minCoverage` thresholds in addition to the ones listed. Unless stated otherwise,
`minCoverage` defaults to 0.8.

Findings on the same resource can overlap: for example `idle-elasticache` and `underutilized-elasticache`,
`unused-efs` and `efs-missing-lifecycle`, or `unused-dynamodb-table` and
`dynamodb-overprovisioned-capacity`. The delete action supersedes the rightsizing one; savings of
overlapping findings must not be added together. Only the DynamoDB capacity pair and the Redshift pair are
mutually exclusive by design.

### Lambda

Lambda publishes metrics only for periods in which a function was invoked, so hourly coverage measures
invocation frequency, not telemetry completeness. Lambda rules therefore default `minCoverage` to **0**
(a series with no datapoints at all is still `NOT_EVALUATED`). Tenants can raise it. Billed duration is
`Duration:Sum` (ms) / 1000 × 30 / observed days.

#### lambda-overprovisioned-memory

| Threshold                     | Default | Meaning                                                                      |
| ----------------------------- | ------- | ---------------------------------------------------------------------------- |
| `minMemoryMb`                 | 512     | Only functions with at least this much memory (MB) are evaluated             |
| `maxMemoryUtilizationPercent` | 40      | Peak Lambda Insights `memory_utilization:Maximum` must be below this (%)     |
| `memoryHeadroomFactor`        | 1.3     | Recommended memory = max(128, roundUp64(peak `used_memory_max` × factor)) MB |
| `minCoverage`                 | 0       | See above                                                                    |

- Requires `Invocations:Sum` > 0. Zero invocations (data present) is `NOT_DETECTED`; NO_DATA is
  `NOT_EVALUATED`.
- **Prerequisite: Lambda Insights.** Without it the memory metrics are NO_DATA and the result is
  `NOT_EVALUATED` (`LAMBDA_INSIGHTS_NOT_ENABLED`). Memory use is never guessed.
- If the recommendation is not smaller than the current size, the result is `NOT_DETECTED`.
- Confidence MEDIUM, risk MEDIUM: Lambda allocates CPU in proportion to memory, so duration may grow
  (the savings estimate is an upper bound). Savings: `LAMBDA_MEMORY_RIGHTSIZE`; null (with
  `pricing.unsupported` evidence) if billed duration cannot be read.

#### lambda-arm64-migration

| Threshold             | Default | Meaning                                                         |
| --------------------- | ------- | --------------------------------------------------------------- |
| `minMonthlyGbSeconds` | 100000  | memory GB × monthly billed seconds must be at least this (GB-s) |

- Applies to `x86_64`, `Zip` package type, and managed runtimes in the `nodejs*`, `python3.*`, `java*`,
  `dotnet*`, `ruby*` and `provided.al2*` families. Legacy runtimes of those families that were never
  offered on arm64 (`nodejs10.x` and older, `python3.6`/`3.7`, `java8` on Amazon Linux 1, `ruby2.5`,
  `dotnetcore1.0`-`2.1`) are excluded. Everything else is `NOT_DETECTED`.
- Confidence LOW (native dependencies and binaries cannot be inspected), risk MEDIUM. Savings:
  `LAMBDA_ARM64_MIGRATION`.

#### lambda-idle-provisioned-concurrency

| Threshold               | Default | Meaning                                                                             |
| ----------------------- | ------- | ----------------------------------------------------------------------------------- |
| `maxUtilizationPercent` | 20      | Peak `ProvisionedConcurrencyUtilization:Maximum:<qualifier>` must be below this (%) |
| `headroomFactor`        | 1.5     | Recommended = ceil(allocated × peak% / 100 × factor), minimum 0                     |
| `minCoverage`           | 0       | See above                                                                           |

- Evaluated per provisioned concurrency configuration (alias or version) with `allocated > 0`, using the
  per-qualifier key. The scanner stores the utilization as a percent (CloudWatch's 0-1 ratio × 100).
- One finding per function aggregates the flagged configurations; the savings request
  (`LAMBDA_PROVISIONED_CONCURRENCY_REDUCE`) sums their current and recommended allocations.
- Lambda stops emitting the utilization metric while a function is not invoked, so a completely idle
  allocation often shows NO_DATA. Only when `Invocations:Sum` is AVAILABLE and sums to 0 is that read as 0%
  utilization (evidence: "no invocations; utilization metric not emitted"). If invocations are also NO_DATA,
  or were non-zero, the configuration is `NOT_EVALUATED`.
- Configurations that cannot be evaluated are listed in the evidence when others are flagged; if none is
  flagged and any could not be evaluated, the result is `NOT_EVALUATED`.
- Confidence MEDIUM, risk MEDIUM (traffic spikes would fall back to on-demand concurrency with cold starts).

#### lambda-near-timeout

| Threshold      | Default | Meaning                                                           |
| -------------- | ------- | ----------------------------------------------------------------- |
| `timeoutRatio` | 0.8     | p95 of hourly `Duration:Maximum` must be at least ratio × timeout |

- Requires `Invocations:Sum` > 0. Severity LOW, confidence MEDIUM, risk LOW. Action
  `REVIEW_FUNCTION_DURATION`: time spent waiting near the timeout is billed and risks timeouts and retries.
  No savings are claimed (`savingsRequest: null`). Errors and throttles are included as evidence when
  available.

### EKS

Container Insights metrics are NO_DATA unless the CloudWatch agent / add-on is installed. Utilization rules
then return `NOT_EVALUATED` (`CONTAINER_INSIGHTS_NOT_ENABLED`). Discovery only sees **managed** node groups
and Fargate profiles; self-managed and Karpenter nodes are visible only through Container Insights
(`cluster_node_count`).

#### idle-eks-cluster

| Threshold    | Default | Meaning                                    |
| ------------ | ------- | ------------------------------------------ |
| `minAgeDays` | 7       | Clusters younger than this are not flagged |

- Fires for ACTIVE clusters with total node group desired size 0, no Fargate profiles and Auto Mode
  disabled. If Container Insights reports any node (`cluster_node_count` > 0) the result is `NOT_DETECTED`;
  if it is unavailable, the evidence states that self-managed nodes cannot be ruled out.
- Confidence MEDIUM, risk HIGH. Savings `EKS_CLUSTER_DELETE` always uses the STANDARD control-plane rate:
  an EXTENDED upgrade policy is a policy, not proof of extended-support billing (noted in evidence).

#### underutilized-eks-nodes

| Threshold                  | Default | Meaning                                                            |
| -------------------------- | ------- | ------------------------------------------------------------------ |
| `maxCpuPercent`            | 30      | p95 of hourly `node_cpu_utilization:Average` below this (%)        |
| `maxMemoryPercent`         | 40      | p95 of hourly `node_memory_utilization:Average` below this (%)     |
| `targetUtilizationPercent` | 70      | required = max(1, ceil(nodes × max(CPU p95, memory p95) / target)) |
| `minNodes`                 | 2       | Minimum total desired nodes across managed node groups             |

- Removable = nodes − required; 0 or less is `NOT_DETECTED`. Auto Mode clusters are `NOT_EVALUATED`
  (`AUTO_MODE_ENABLED`).
- Pricing uses the node group with the most desired nodes (ties broken by name): operating system Windows
  when its AMI type starts with `WINDOWS`, else Linux; its capacity type is passed through so Spot is
  reported as unavailable by the savings engine. Node groups with several instance types (mixed) get no
  savings request.
- Confidence MEDIUM (LOW when Container Insights sees more nodes than managed node groups want), risk
  MEDIUM. Pod scheduling constraints (PodDisruptionBudgets, anti-affinity, DaemonSets) are not visible.

#### eks-oversized-requests

| Threshold            | Default | Meaning                                              |
| -------------------- | ------- | ---------------------------------------------------- |
| `minReservedPercent` | 70      | Average `node_*_reserved_capacity` at least this (%) |
| `maxUsedPercent`     | 25      | Average `node_*_utilization` at most this (%)        |

- Evaluated separately for CPU and memory; either side detects. `NOT_DETECTED` requires both sides to be
  evaluated; one missing side with the other clear is `NOT_EVALUATED`.
- Confidence MEDIUM. No savings (`null`): they depend on workload changes.

### ElastiCache

#### underutilized-elasticache

| Threshold           | Default | Meaning                                                                   |
| ------------------- | ------- | ------------------------------------------------------------------------- |
| `maxCpuPercent`     | 10      | Average CPU below this (%)                                                |
| `maxCpuPeakPercent` | 40      | Maximum hourly CPU below this (%)                                         |
| `maxMemoryPercent`  | 30      | Maximum `DatabaseMemoryUsagePercentage` below this (%, Redis/Valkey only) |

- Redis/Valkey use `EngineCPUUtilization` when it is available, else `CPUUtilization`. Memcached has no
  comparable memory metric: memory is not checked and confidence is LOW. Redis/Valkey confidence is HIGH
  with at least 95% coverage over 28 days, else MEDIUM.
- Target = next smaller size in the same family on the ladder micro, small, medium, large, xlarge, 2xlarge,
  4xlarge, 8xlarge, 12xlarge, 16xlarge, 24xlarge (shared with RDS). Burstable `cache.t*` families go down to
  micro; other families stop at large, their smallest size. No smaller size gives `targetNodeType: null`
  (savings unavailable). Replication group members are noted: node type changes apply to the whole group.

#### idle-elasticache

| Threshold        | Default | Meaning                                                    |
| ---------------- | ------- | ---------------------------------------------------------- |
| `maxConnections` | 0       | `CurrConnections:Maximum` over the window at or below this |

- NO_DATA is `NOT_EVALUATED`. Connections above the threshold are `NOT_DETECTED` at any coverage.
- Risk HIGH. The steps require a final snapshot for Redis/Valkey (Memcached cannot be snapshotted).
  Savings: `ELASTICACHE_DELETE`.

### CloudFront

Distributions are global: their region is `global` (also in finding IDs) and their metrics come from
us-east-1. They have no creation time, so the observation period is the lookback window.

#### idle-cloudfront-distribution

| Threshold     | Default | Meaning                                   |
| ------------- | ------- | ----------------------------------------- |
| `maxRequests` | 100     | `Requests:Sum` over the window below this |

- Enabled distributions only. CloudFront has no fixed monthly fee, so no savings are claimed. Request
  totals at or above the threshold are `NOT_DETECTED` at any coverage; lower totals need `minCoverage`.
- Limitation: if CloudFront publishes no datapoints for hours without requests, a low-traffic distribution
  has low coverage and is `NOT_EVALUATED`; lower `minCoverage` to evaluate such distributions. A
  distribution with no datapoints at all is `NOT_EVALUATED`.

#### cloudfront-compression-disabled

| Threshold       | Default | Meaning                                                                     |
| --------------- | ------- | --------------------------------------------------------------------------- |
| `minGbPerMonth` | 10      | `BytesDownloaded:Sum` normalised to 30 days at least this (GB = 10^9 bytes) |

- Fires when the default cache behavior has `Compress: false`; an unknown setting is `NOT_EVALUATED`.
  Traffic above the threshold is conclusive at any coverage; traffic below it needs `minCoverage`.
- Severity LOW, confidence LOW (the reduction depends on content type), no savings. Only the default
  cache behavior is checked.

### EFS

Sizes are converted with GiB (2^30 bytes), matching how AWS bills storage per GB-month.

#### unused-efs

| Threshold    | Default | Meaning                                        |
| ------------ | ------- | ---------------------------------------------- |
| `minAgeDays` | 7       | File systems younger than this are not flagged |

- Fires when the file system has no mount targets (metadata only, confidence HIGH), or when
  `ClientConnections:Maximum` is 0 and `DataReadIOBytes` + `DataWriteIOBytes` sum to 0 over the window
  (confidence from coverage). Any observed activity is `NOT_DETECTED`, even if another metric is missing;
  NO_DATA is `NOT_EVALUATED`.
- Risk HIGH; back up first. Savings `EFS_DELETE` (One Zone classes when the file system has an
  availability zone). Provisioned throughput is billed separately and not included.

#### efs-missing-lifecycle

| Threshold       | Default | Meaning                                    |
| --------------- | ------- | ------------------------------------------ |
| `minStandardGb` | 50      | Standard-class storage at least this (GiB) |

- Fires when the lifecycle configuration is known and has no transition to IA. Confidence LOW, risk LOW
  (the access pattern is unknown; IA reads are charged). Savings `EFS_LIFECYCLE_TO_IA` (upper bound).

### DynamoDB

Consumption is read from hourly `ConsumedReadCapacityUnits:Sum` / `ConsumedWriteCapacityUnits:Sum`
datapoints converted to units per second (Sum / 3600); `Maximum` is never used because it is the largest
single request, not a rate. DynamoDB publishes these metrics even for tables without traffic (zero
values), so `minCoverage` stays 0.8. **Hourly granularity hides bursts shorter than an hour**: the
"peak" is the busiest hour's average rate, which is why recommendations keep headroom and confidence is
MEDIUM. Global secondary indexes are excluded from the analysis and the estimates.

#### dynamodb-overprovisioned-capacity

| Threshold               | Default | Meaning                                                                            |
| ----------------------- | ------- | ---------------------------------------------------------------------------------- |
| `maxUtilizationPercent` | 30      | p95 hourly units per second below this share of provisioned capacity (%), per side |
| `headroomFactor`        | 2       | Recommended = max(1, ceil(busiest-hour units per second × factor)), per side       |

- Provisioned mode without auto scaling only (`autoScalingEnabled: null` is `NOT_EVALUATED`). Each side
  (reads, writes) is flagged independently; unflagged sides keep their capacity.
- A side with throttle events in the window is never reduced: bursts already exceed its capacity.
- Mutually exclusive with `dynamodb-capacity-mode`: tables meeting that rule's condition (with its
  effective thresholds) are `NOT_DETECTED` here, even when that rule is disabled.
- Savings `DYNAMODB_RIGHTSIZE_PROVISIONED`.

#### dynamodb-capacity-mode

| Threshold                      | Default | Meaning                                                                                                       |
| ------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------- |
| `maxAverageUtilizationPercent` | 15      | Average units per second below this share of provisioned capacity on every side with provisioned capacity (%) |
| `minPeakToAverage`             | 4       | Busiest hour / average at least this on at least one side                                                     |

- Provisioned mode (auto scaling or not; an auto-scaled table's current capacity is noted). Sides with 0
  provisioned capacity are ignored; a side without traffic is not spiky.
- Savings `DYNAMODB_SWITCH_TO_ON_DEMAND` with consumed units normalised to 30 days. Rules cannot see
  prices, so the savings engine reports UNAVAILABLE when on-demand is not cheaper at the observed traffic
  (at us-east-1 prices the break-even is roughly 29% average utilization).
- Confidence MEDIUM, risk LOW.

#### unused-dynamodb-table

| Threshold    | Default | Meaning                                  |
| ------------ | ------- | ---------------------------------------- |
| `minAgeDays` | 30      | Tables younger than this are not flagged |

- Fires when consumed read and write capacity both sum to 0 over the window. Traffic is conclusive at any
  coverage; NO_DATA is `NOT_EVALUATED`.
- Risk HIGH (export or back up first). Deletion protection does not prevent detection but is noted.
  Global table replicas lower confidence to MEDIUM: traffic in other regions is not included.
- Savings `DYNAMODB_DELETE_TABLE` (provisioned capacity counted only for provisioned tables).

### Redshift

#### idle-redshift-cluster

- Fires for `available` clusters whose `DatabaseConnections:Maximum` is 0 in every hour (thresholds:
  `minObservationDays`, `minCoverage`). Any connection is `NOT_DETECTED`; paused clusters are
  `NOT_DETECTED`.
- Confidence from coverage, risk MEDIUM: data sharing consumers, Spectrum and scheduled queries may not
  open connections to this cluster. Savings `REDSHIFT_PAUSE` with `pausableFraction: 1`. RA3 managed
  storage keeps being billed while paused (noted).

#### redshift-pause-schedule

| Threshold         | Default | Meaning                                                                    |
| ----------------- | ------- | -------------------------------------------------------------------------- |
| `minIdleFraction` | 0.4     | Share (0-1) of hours with zero `DatabaseConnections:Maximum` at least this |

- Uses `zeroFraction` of `DatabaseConnections:Maximum`; fully idle clusters (maximum 0) are left to
  `idle-redshift-cluster`, so the two rules never both fire.
- Idle hours are counted, not located: scattered idle hours cannot all be paused, so the estimate is an
  upper bound (`pausableFraction = zeroFraction`) and confidence is MEDIUM.

### AWS Backup

#### backup-excessive-retention

| Threshold          | Default | Meaning                                                                               |
| ------------------ | ------- | ------------------------------------------------------------------------------------- |
| `maxRetentionDays` | 365     | Rules retaining recovery points longer than this (days), or indefinitely, are flagged |

- Evidence lists up to 20 offending rules with their vault, cold-storage setting and copy actions (copy
  actions have their own lifecycle, which discovery does not capture). Confidence LOW (compliance
  requirements are unknown), risk MEDIUM. No savings on the plan: retention cost is measured on vaults.

#### backup-vault-old-recovery-points

| Threshold          | Default | Meaning                                              |
| ------------------ | ------- | ---------------------------------------------------- |
| `maxRetentionDays` | 365     | Recovery points at least this old are flagged (days) |

- Vault summaries keep recovery points in age buckets (`BACKUP_AGE_BUCKETS_DAYS`: 0, 30, 90, 180, 365,
  730). The threshold **snaps up** to the next bucket boundary (for example 400 -> 730), so points between
  the threshold and the boundary are not counted; the evidence says when snapping happened. Thresholds
  above 730 days cannot be evaluated (`THRESHOLD_BEYOND_AGE_BUCKETS`).
- Fires when bytes in qualifying buckets are greater than 0. Confidence LOW, risk HIGH (backups are often
  mandatory; Vault Lock may prevent early deletion, noted). Savings `BACKUP_RETENTION_REDUCE`: EBS/EC2 bytes
  are priced, other bytes are listed as unpriced.

#### backup-redundant-plans

- Fires when discovery found resources whose recovery points in the last 35 days were created by two or
  more backup plans. Evidence lists up to 10 resources with their plan IDs (discovery caps the list at 50).
- Confidence MEDIUM, risk MEDIUM: overlaps can be intentional (daily and monthly plans with different
  retention, cross-region copies). No savings: overlap volume cannot be measured from metadata.

## Adding a rule

1. Create `services/analyzer/src/rules/<rule-id>.ts` using `defineRule`. Give every threshold a description.
2. Register the rule in `RULES` (`catalog.ts`). The catalog is served at `GET /rules`.
3. Add tests that cover detected, not-detected and not-evaluated cases (including missing data), plus
   threshold overrides.
4. Never change an existing `ruleId`, because it is part of the finding ID. Bump `version` when the
   rule's semantics change.

## Overlapping findings (supersession)

Some rules describe the same waste at different strengths on one resource. After all rules run, the engine
(`applySupersession` in `services/analyzer/src/engine.ts`) keeps only the stronger finding so estimated savings are
never counted twice in totals:

| Stronger rule (kept)    | Weaker rule (dropped on the same resource)                    |
| ----------------------- | ------------------------------------------------------------- |
| `idle-elasticache`      | `underutilized-elasticache`                                   |
| `unused-efs`            | `efs-missing-lifecycle`                                       |
| `unused-dynamodb-table` | `dynamodb-overprovisioned-capacity`, `dynamodb-capacity-mode` |
| `idle-eks-cluster`      | `underutilized-eks-nodes`, `eks-oversized-requests`           |
| `idle-redshift-cluster` | `redshift-pause-schedule`                                     |

The weaker rule's evaluation becomes `NOT_DETECTED` with reason `SUPERSEDED_BY:<rule>`, so a weaker finding opened
by an earlier scan is resolved rather than left open with stale savings.

`lambda-arm64-migration` and `lambda-overprovisioned-memory` are complementary (both can be applied). When both
fire, the arm64 saving is priced at the rightsized memory so the two estimates add up instead of overlapping.
