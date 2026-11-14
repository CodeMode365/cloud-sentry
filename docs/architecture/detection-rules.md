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

## Rules

| Rule ID             | Resource     | Category        | Default severity          |
| ------------------- | ------------ | --------------- | ------------------------- |
| `idle-ec2`          | EC2_INSTANCE | IDLE            | MEDIUM                    |
| `unattached-ebs`    | EBS_VOLUME   | UNUSED          | MEDIUM                    |
| `unassociated-eip`  | ELASTIC_IP   | UNUSED          | LOW                       |
| `underutilized-rds` | RDS_INSTANCE | OVERPROVISIONED | MEDIUM (HIGH when unused) |
| `old-ebs-snapshots` | EBS_SNAPSHOT | RETENTION       | LOW                       |
| `idle-nat-gateway`  | NAT_GATEWAY  | IDLE            | MEDIUM                    |

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

## Adding a rule

1. Create `services/analyzer/src/rules/<rule-id>.ts` using `defineRule`. Give every threshold a description.
2. Register the rule in `RULES` (`catalog.ts`). The catalog is served at `GET /rules`.
3. Add tests that cover detected, not-detected and not-evaluated cases (including missing data), plus
   threshold overrides.
4. Never change an existing `ruleId`, because it is part of the finding ID. Bump `version` when the
   rule's semantics change.
