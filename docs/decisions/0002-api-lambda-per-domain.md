# ADR 0002: HTTP API with one Lambda per API domain

Status: accepted (2026-11-14)

## Decision

API Gateway HTTP API routes to eight domain Lambdas (auth, accounts, scans, inventory, analytics, schedules,
reports, settings) that share one router/composition codebase (`services/api`). Domain logic lives in
`packages/core`; handlers are thin.

## Why

Least privilege per function (only api-scans may start executions, only api-accounts may AssumeRole, only
api-auth reads the Cognito client secret), smaller bundles, independent scaling and error isolation, without
duplicating routing code. A single "Lambda-lith" would grant every route every permission.

## Consequences

Eight functions to monitor (alarms are generated per function). Cold starts are per domain.
