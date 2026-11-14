# ADR 0006: Deterministic rules; savings only from identified price sources

Status: accepted (2026-11-14)

## Decision

Waste detection is a set of pure, versioned, independently tested rules with configurable thresholds. No LLM is
involved in deciding whether a resource is idle or safe to remove. Rules return DETECTED, NOT_DETECTED or
NOT_EVALUATED (insufficient data); only NOT_DETECTED resolves an existing finding. Savings come from the AWS
Price List API (cached in DynamoDB), with formulas, assumptions and SKUs recorded on every estimate; when no
unambiguous price exists the estimate is UNAVAILABLE.

## Why

Recommendations must be explainable and reproducible, and the spec forbids invented pricing or utilization.

## Consequences

On-demand list prices overstate savings for resources covered by Reserved Instances or Savings Plans; this is
stated in every estimate's assumptions. Snapshot savings are UPPER_BOUND because snapshots are incremental.
