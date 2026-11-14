# CloudSentry

**Find cloud waste. Understand the impact. Optimize with confidence.**

CloudSentry is an AWS-native FinOps platform. It connects to customer AWS accounts through a read-only
cross-account IAM role, discovers resources across regions, collects CloudWatch utilization and Cost Explorer
spend, runs deterministic waste-detection rules, prices savings with the AWS Price List API, and presents
evidence-backed recommendations in a dashboard. It never modifies customer resources.

## Status

| Area                                                                                                                                                    | State                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Monorepo, shared packages, typed contracts                                                                                                              | Implemented                                                                                                                          |
| Discovery (EC2, EBS, Elastic IP, RDS, snapshots, NAT gateways, ALB/NLB/GWLB, Lambda, EKS, ElastiCache, CloudFront, EFS, DynamoDB, Redshift, AWS Backup) | Implemented, unit tested with SDK mocks                                                                                              |
| CloudWatch metrics (GetMetricData, batching, NO_DATA vs zero, reuse)                                                                                    | Implemented, unit tested with SDK mocks                                                                                              |
| Cost Explorer (monthly/daily/service/region, unfinalized flags, optional resource-level)                                                                | Implemented, unit tested with SDK mocks                                                                                              |
| Detection rules (27, see docs/architecture/extended-services.md) and savings engine                                                                     | Implemented, unit tested                                                                                                             |
| AWS Price List integration                                                                                                                              | Implemented; **verified against the live Price List API** for EC2, EBS gp3, snapshots, public IPv4, RDS PostgreSQL, NAT in us-east-1 |
| Finding/recommendation lifecycle, dedupe, tenant isolation                                                                                              | Implemented, integration tested on DynamoDB Local                                                                                    |
| Step Functions workflow, EventBridge Scheduler, SNS, Cognito, API Gateway, CloudFront                                                                   | Implemented in CDK; `cdk synth` succeeds; **not deployed**                                                                           |
| Real cross-account scan against a live AWS account                                                                                                      | **Not yet verified** (see "Verifying a deployment" in `docs/deployment.md`)                                                          |
| Dashboard (Next.js static export)                                                                                                                       | Implemented; builds; consumes the real API                                                                                           |

Tests: 205 automated tests (unit + integration). Integration tests use DynamoDB Local and mocked AWS SDK
clients; they do not prove live AWS behaviour.

## Repository layout

```
apps/web                 Next.js dashboard (static export, served by CloudFront)
services/api             HTTP API: one Lambda per domain, local dev server, synthetic seed
services/scanner         Workflow steps, discovery, metrics, Cost Explorer, normalization
services/analyzer        Deterministic detection rule engine
services/recommendation  Recommendation drafts, Price List pricing engine, savings estimation
services/reporting       Report assembly, PDF/JSON rendering
packages/shared-types    Domain types and workflow/artifact contracts
packages/validators      Zod schemas (API input, env, AWS identifiers, cron)
packages/utilities       Logger, errors, retry, ids, stats, cursors, EMF metrics
packages/aws-clients     Client defaults, cross-account credentials, role verifier, artifact store
packages/database        DynamoDB single-table repositories
packages/core            Application services shared by API and workers
infrastructure           AWS CDK app (6 stacks per stage)
tests                    Cross-package integration tests
docs                     Architecture, security, API, decisions, deployment
```

## Quick start (local development)

Prerequisites: Node.js 22, pnpm 9, Docker (for DynamoDB Local).

```bash
pnpm install
pnpm dev:db           # DynamoDB Local on :8000
pnpm dev:api          # API on http://127.0.0.1:4000 (local auth, filesystem artifacts)
pnpm dev:web          # Dashboard on http://localhost:3000 (proxies /api to :4000)
```

Register in the dashboard. Locally the email confirmation code is printed in the API log (nothing is emailed).
Sign in once, then optionally load clearly labelled synthetic data:

```bash
pnpm seed:synthetic -- --email you@example.com
```

Local scans of a real account run in-process using your AWS credentials, which must be able to call
`sts:AssumeRole` on the customer role. Root credentials cannot assume roles; use an IAM user or role.
Details: [docs/development.md](docs/development.md).

## Quality gates

```bash
pnpm typecheck
pnpm lint
pnpm test             # requires DynamoDB Local for the integration suite (skipped otherwise)
pnpm audit:deps
```

On machines with little memory, add `--concurrency=2` (for example `pnpm turbo run test --concurrency=1`).

## Deployment

See [docs/deployment.md](docs/deployment.md). Short version, with a non-root IAM principal:

```bash
pnpm --filter @cloudsentry/web build
pnpm cdk bootstrap -c stage=dev
pnpm cdk deploy --all -c stage=dev
```

## Documentation

- [Architecture overview and contracts](docs/architecture/overview.md)
- [Discovery and metrics](docs/architecture/discovery-and-metrics.md)
- [Extended services (Lambda, EKS, ElastiCache, CloudFront, EFS, DynamoDB, Redshift, Backup)](docs/architecture/extended-services.md)
- [Detection rules](docs/architecture/detection-rules.md)
- [Savings estimation](docs/architecture/savings-estimation.md)
- [API reference](docs/api/README.md)
- [Security overview](docs/security/overview.md) and [IAM design](docs/security/iam.md)
- [Architecture decision records](docs/decisions/)
- [Local development](docs/development.md)
- [Deployment](docs/deployment.md)
