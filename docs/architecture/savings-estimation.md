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
pattern below; the pattern may carry a region prefix such as `USW2-`. It reads on-demand price
dimensions in the expected unit. The filters were verified against live responses.

| Query            | Service   | Filters                                                                                               | usagetype                                               | Unit  |
| ---------------- | --------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----- |
| EC2 instance     | AmazonEC2 | regionCode, instanceType, operatingSystem, tenancy, capacitystatus=Used, preInstalledSw, licenseModel | `BoxUsage:` / `DedicatedUsage:` / `HostBoxUsage:`       | Hrs   |
| EBS storage      | AmazonEC2 | regionCode, productFamily=Storage, volumeApiName                                                      | `EBS:VolumeUsage[.type]`                                | GB-Mo |
| EBS snapshot     | AmazonEC2 | regionCode, productFamily=Storage Snapshot                                                            | `EBS:SnapshotUsage` (not archive)                       | GB-Mo |
| Idle public IPv4 | AmazonVPC | regionCode, group=VPCPublicIPv4Address                                                                | `PublicIPv4:IdleAddress`                                | Hrs   |
| RDS instance     | AmazonRDS | regionCode, instanceType, databaseEngine, deploymentOption                                            | `InstanceUsage:` / `Multi-AZUsage:` (never `UnusedBox`) | Hrs   |
| NAT Gateway      | AmazonEC2 | regionCode, productFamily=NAT Gateway                                                                 | `NatGateway-Hours` (not Regional/Bytes/Prvd)            | Hrs   |

The lookup fails safe:

- No matching price gives `NO_MATCHING_PRICE`.
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

Every estimate also carries these assumptions:

- It uses public on-demand list prices. Taxes, credits and private discounts are not applied.
- Reserved Instance and Savings Plans coverage is not considered.
- It is not a guaranteed saving.

`pricingSources` records the exact query, unit price, SKU and effective date behind each number.

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
