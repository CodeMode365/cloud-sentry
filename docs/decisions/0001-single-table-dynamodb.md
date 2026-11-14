# ADR 0001: Single-table DynamoDB with tenant-prefixed partition keys

Status: accepted (2026-11-14)

## Context

All reads are tenant-scoped (accounts, scans, resources, findings, recommendations, schedules, reports).
Typical tenants have hundreds to low thousands of resources. Spec requires tenant isolation, GSIs for common
access patterns, TTL, conditional writes and pagination.

## Decision

One table (`PK`, `SK`, one overloaded `GSI1`, TTL attribute `expiresAt`). Every tenant partition key starts with
`TENANT#<tenantId>`. Deterministic IDs (finding = hash(account, region, rule, resource); recommendation =
hash(finding); schedule = `sch_<accountId>`) make duplicates impossible by construction. Keys are built only in
`packages/database/src/keys.ts`; services use repository interfaces.

## Consequences

- Isolation is a property of key construction plus cursor validation; tested in `tests/integration`.
- Filtered list queries (severity, status) use FilterExpressions inside one tenant partition. Fine at expected
  volume; very large tenants would need additional GSIs or a search index.
- Sorting resources by arbitrary fields loads up to 5,000 items and sorts in memory (documented cap).
- A future `dynamodb:LeadingKeys` IAM condition is possible because all tenant keys share a prefix.
