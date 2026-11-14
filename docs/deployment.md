# Deploying CloudSentry

CloudSentry is deployed with the AWS CDK app in `infrastructure/`. The app creates six stacks per stage
(`dev`, `staging`, `prod`):

| Stack                               | Contents                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `CloudSentry-<stage>-Data`          | DynamoDB table `cloudsentry-<stage>-main`, private artifacts bucket                                                |
| `CloudSentry-<stage>-Auth`          | Cognito user pool and app client, client secret in Secrets Manager                                                 |
| `CloudSentry-<stage>-Workflow`      | Scan workflow Lambdas, Step Functions state machine, SNS notifications topic, EventBridge Scheduler group and role |
| `CloudSentry-<stage>-Api`           | HTTP API, domain Lambdas, report generator                                                                         |
| `CloudSentry-<stage>-Web`           | Dashboard bucket and CloudFront distribution (`/api/*` routed to the HTTP API)                                     |
| `CloudSentry-<stage>-Observability` | Alarms, ops alarm topic, CloudWatch dashboard                                                                      |

> Nothing in this repository has been deployed by its authors. Treat the first deployment as a test
> deployment into a non-production account and verify it as described below.

## 1. Prerequisites

- Node.js 22 and pnpm 9 (`npm i -g pnpm@9`).
- Docker is **not** required: Lambda bundles are built locally with esbuild (an `infrastructure` dev dependency).
- An AWS account dedicated to CloudSentry (the "platform account"). Customers will trust this account ID.
- Credentials for a **non-root IAM principal** (an IAM Identity Center permission set or IAM role) with
  permissions to deploy CloudFormation, IAM, Lambda, DynamoDB, S3, CloudFront, Cognito, Step Functions,
  EventBridge Scheduler, SNS, Secrets Manager and CloudWatch. Do not deploy with root credentials: root cannot be
  scoped, bypasses permission boundaries, and every action it takes is maximally privileged. Use `aws sso login`
  or `aws login` with an administrator permission set for the first deployment, then narrow it.

Check which identity you are using before any deploy:

```bash
aws sts get-caller-identity   # Arn must NOT end in :root
```

## 2. Configure the stage

Stage configuration lives in `infrastructure/environments/{dev,staging,prod}.ts` (retention, throttling, memory,
PITR, deletion protection, artifact retention). Per-deployment values come from environment variables:

| Variable                                                     | Required                      | Meaning                                                                                                       |
| ------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `CLOUDSENTRY_ACCOUNT`                                        | prod: yes; otherwise optional | Target account. Defaults to the CLI's current account for dev/staging. Prod refuses to synthesize without it. |
| `CLOUDSENTRY_REGION`                                         | no                            | Defaults to the CLI region, then `us-east-1`.                                                                 |
| `CLOUDSENTRY_ALARM_EMAIL`                                    | no                            | Subscribed to the ops alarm topic (confirm the email SNS sends).                                              |
| `CLOUDSENTRY_WEB_DOMAIN` + `CLOUDSENTRY_WEB_CERTIFICATE_ARN` | no (both or neither)          | Custom dashboard domain; the ACM certificate must be in `us-east-1`.                                          |
| `CLOUDSENTRY_DASHBOARD_URL`                                  | no                            | Link used in notification emails. Set it after the first deploy (see section 6).                              |

`PLATFORM_ACCOUNT_ID` (the account customers trust) is not configured manually: the stacks set it on every
Lambda from the deployment account (`AWS::AccountId`), and it is printed as the `PlatformAccountId` output.

## 3. Bootstrap (once per account and region)

```bash
pnpm install
pnpm cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
```

Bootstrapping creates the CDK staging bucket and deployment roles. If the region differs, bootstrap that region.

## 4. Build and deploy

```bash
# 1. Quality gates
pnpm typecheck && pnpm lint && pnpm test

# 2. Build the static dashboard (the Web stack uploads apps/web/out if it exists; otherwise it warns and deploys an empty site)
pnpm --filter @cloudsentry/web build

# 3. Review the changes
pnpm cdk diff --all -c stage=dev

# 4. Deploy
pnpm cdk deploy --all -c stage=dev
```

For prod: `CLOUDSENTRY_ACCOUNT=<id> pnpm cdk deploy --all -c stage=prod`. The prod configuration retains the
table, buckets and user pool on stack deletion and enables DynamoDB deletion protection and PITR.

## 5. Outputs

| Output                                                                               | Stack         | Use                                                                                        |
| ------------------------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------ |
| `DashboardUrl`                                                                       | Web           | Open the dashboard. API is served at `<DashboardUrl>/api/v1`.                              |
| `ApiUrl`, `ApiId`                                                                    | Api           | Direct HTTP API endpoint (prefer the CloudFront URL so the refresh cookie is first-party). |
| `UserPoolId`, `UserPoolClientId`, `UserPoolClientSecretArn`                          | Auth          | Cognito configuration (already wired into the API Lambdas).                                |
| `TableName`, `ArtifactsBucketName`                                                   | Data          | Data stores.                                                                               |
| `StateMachineArn`, `NotificationsTopicArn`, `ScheduleGroupName`, `PlatformAccountId` | Workflow      | Workflow resources; `PlatformAccountId` is what customer roles trust.                      |
| `OpsAlarmsTopicArn`, `DashboardName`                                                 | Observability | Operations.                                                                                |

## 6. Post-deployment steps

1. If you set `CLOUDSENTRY_ALARM_EMAIL`, confirm the SNS subscription email.
2. Redeploy with `CLOUDSENTRY_DASHBOARD_URL=<DashboardUrl output>` so notification emails link to the dashboard
   (the CloudFront domain is only known after the first deploy, and the Workflow stack cannot reference the Web
   stack without a dependency cycle).
3. Cognito sends verification codes with its default sender, which has a low daily quota. For production, configure
   Amazon SES as the user pool email sender.
4. Optionally enable Cost Explorer in the platform account (customers' Cost Explorer is accessed through their role).

## 7. Verifying a deployment

Do not consider a deployment successful until each check passes:

1. `aws cloudformation describe-stacks --query "Stacks[?starts_with(StackName,'CloudSentry-dev')].[StackName,StackStatus]"`
   shows six `*_COMPLETE` stacks.
2. Open `DashboardUrl`; register a user, confirm the emailed code, and log in.
3. `curl -i <DashboardUrl>/api/v1/accounts` without a token returns `401` (gateway JWT authorizer).
4. Connect a test AWS account with the onboarding template, then **Verify** it: all permission probes should be `ALLOWED`.
5. Start a manual scan; in the Step Functions console the execution of `cloudsentry-dev-scan` should reach `COMPLETE`.
   Partial failures appear as `PARTIALLY_COMPLETED` scans with per-region errors, not as failed executions.
6. Create a schedule and confirm it appears in EventBridge Scheduler under the `cloudsentry-dev` group.
7. Check the `cloudsentry-dev-operations` CloudWatch dashboard and that no alarms are in `ALARM`.

## 8. Teardown

```bash
pnpm cdk destroy --all -c stage=dev
```

Dev and staging use `RemovalPolicy.DESTROY` with bucket auto-delete, so all data is removed. Prod resources with
state (table, buckets, user pool, secrets, log groups) are retained and must be deleted manually if intended.
EventBridge Scheduler schedules created by the API live in the `cloudsentry-<stage>` group, which is deleted with
the Workflow stack in dev/staging.

## 9. Cost expectations

CloudSentry is serverless; idle cost is low but not zero. Main drivers:

| Item                                                             | Notes                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CloudWatch alarms                                                | 67 alarms (Errors + Throttles for each of 30 Lambdas, plus 7 workflow/API/application alarms) at USD 0.10/alarm-month ≈ USD 6.70/month. Set `alarms.perFunction: false` to keep only the 7.                                 |
| AWS Cost Explorer API                                            | USD 0.01 per request, billed to the **account whose credentials make the call** (the customer account, via its role). Each cost refresh issues ~4-5 requests; refreshes are limited by `COST_REFRESH_HOURS` (default 12 h). |
| CloudWatch GetMetricData                                         | USD 0.01 per 1,000 metrics requested, billed to the customer account. Reuse window `METRICS_REUSE_HOURS` (default 6 h).                                                                                                     |
| Step Functions Standard                                          | USD 0.025 per 1,000 state transitions; one scan is ~30-40 transitions.                                                                                                                                                      |
| Lambda, DynamoDB on-demand, S3, API Gateway HTTP API, CloudFront | Pay per use; negligible at low volume.                                                                                                                                                                                      |
| Cognito Essentials                                               | Free up to 10,000 monthly active users.                                                                                                                                                                                     |
| Secrets Manager                                                  | USD 0.40/month for the client secret.                                                                                                                                                                                       |
| X-Ray                                                            | Tracing is enabled on Lambdas and the state machine; first 100,000 traces/month are free.                                                                                                                                   |

Customers should be told that scans issue billed Cost Explorer and CloudWatch API requests in their accounts.
