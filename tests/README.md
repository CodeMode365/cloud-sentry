# Integration tests

These tests exercise real repository code against **DynamoDB Local** (`pnpm dev:db`) and the full
scan pipeline with **mocked AWS SDK clients** (aws-sdk-client-mock). They verify tenant isolation,
finding lifecycle/deduplication, scan locking/idempotency, API authorization and workflow behaviour.

They do **not** prove real AWS integration. Real-account verification is a separate, manual step
documented in `docs/deployment.md` ("Verifying a deployment").

When DynamoDB Local is not reachable at `DYNAMODB_ENDPOINT` (default `http://localhost:8000`), the
suites are skipped with a message instead of failing.
