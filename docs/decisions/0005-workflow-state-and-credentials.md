# ADR 0005: Small workflow state, S3 artifacts, no credentials in state

Status: accepted (2026-11-14)

## Decision

The Step Functions state carries only IDs and small step summaries. Every step writes bulky output to S3
(`scans/<tenant>/<account>/<scanId>/...`) and returns `{ status, artifactKey }`. Each Lambda that needs the
customer account performs its own AssumeRole. Execution name = scanId (idempotent start). Business failures
(one region, one resource type, Cost Explorer disabled) are reported as PARTIAL/FAILED step results rather than
thrown, so scans complete partially. A global Catch marks the scan FAILED and releases the account lock.

## Why

Step Functions payloads are limited to 256 KB and execution history is visible to operators; temporary
credentials must never appear there. Per-region and per-type isolation is a spec requirement.

## Consequences

A few extra STS calls per scan (one per worker, memoized within a worker). Artifacts expire with the
`scans/` lifecycle rule. Persistence is idempotent per scanId so retried steps never double-count.
