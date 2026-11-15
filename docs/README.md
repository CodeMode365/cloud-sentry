<img src="assets/cover.png" alt="CloudSentry: find cloud waste, understand the impact, optimize with confidence. Read-only cost optimization for AWS accounts." width="100%">

# CloudSentry documentation

Everything about how CloudSentry works, how to run it, and how it keeps connected AWS accounts safe. New to
CloudSentry? The [project README](../README.md) gives a plain-language introduction first.

<img src="assets/how-it-works.svg" alt="Six steps: connect a read-only role, scan resources and usage, detect waste with transparent rules, estimate savings with AWS list prices, review recommendations, stay informed with alerts and reports." width="100%">

## <img src="assets/icons/upload.svg" width="28" height="28" align="absmiddle" alt=""> Get started

|                                                                                       |                                     |                                                      |
| ------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------- |
| <img src="assets/icons/terminal.svg" width="20" height="20" align="absmiddle" alt=""> | [Local development](development.md) | Run the dashboard, API and database on your machine  |
| <img src="assets/icons/cloud.svg" width="20" height="20" align="absmiddle" alt="">    | [Deployment](deployment.md)         | Deploy the six serverless stacks to AWS with the CDK |

## <img src="assets/icons/layers.svg" width="28" height="28" align="absmiddle" alt=""> How it works

|                                                                                       |                                                                |                                                               |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| <img src="assets/icons/layers.svg" width="20" height="20" align="absmiddle" alt="">   | [Architecture overview](architecture/overview.md)              | Layers, packages, data model, scan workflow and API contracts |
| <img src="assets/icons/server.svg" width="20" height="20" align="absmiddle" alt="">   | [Supported services](architecture/extended-services.md)        | Every AWS service and resource type CloudSentry scans         |
| <img src="assets/icons/activity.svg" width="20" height="20" align="absmiddle" alt=""> | [Discovery and metrics](architecture/discovery-and-metrics.md) | How resources, usage metrics and costs are collected          |
| <img src="assets/icons/alert.svg" width="20" height="20" align="absmiddle" alt="">    | [Detection rules](architecture/detection-rules.md)             | What counts as waste, and the thresholds behind each rule     |
| <img src="assets/icons/dollar.svg" width="20" height="20" align="absmiddle" alt="">   | [Savings estimation](architecture/savings-estimation.md)       | How recommendations are priced with AWS list prices           |

## <img src="assets/icons/shield.svg" width="28" height="28" align="absmiddle" alt=""> Security

|                                                                                     |                                           |                                                              |
| ----------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| <img src="assets/icons/shield.svg" width="20" height="20" align="absmiddle" alt=""> | [Security overview](security/overview.md) | The main threats and the controls against them               |
| <img src="assets/icons/key.svg" width="20" height="20" align="absmiddle" alt="">    | [IAM and authentication](security/iam.md) | Every permission on both sides of the cross-account boundary |

## <img src="assets/icons/book.svg" width="28" height="28" align="absmiddle" alt=""> Reference

|                                                                                     |                                |                                            |
| ----------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------ |
| <img src="assets/icons/braces.svg" width="20" height="20" align="absmiddle" alt=""> | [API reference](api/README.md) | REST API v1: endpoints, errors, pagination |
| <img src="assets/icons/book.svg" width="20" height="20" align="absmiddle" alt="">   | [Decision records](decisions/) | Why CloudSentry is built the way it is     |

## <img src="assets/icons/workflow.svg" width="28" height="28" align="absmiddle" alt=""> Architecture at a glance

<img src="assets/architecture.svg" alt="CloudSentry architecture: CloudFront serves the dashboard from S3 and routes /api/v1 to API Gateway with Cognito; Lambda functions use DynamoDB and S3; manual or scheduled scans run a Step Functions workflow that assumes a read-only role in the customer account and sends email alerts through SNS." width="100%">

<img src="assets/scan-workflow.svg" alt="The twelve scan steps run by AWS Step Functions, from validating the account to sending notifications." width="100%">

## <img src="assets/icons/dashboard.svg" width="28" height="28" align="absmiddle" alt=""> Images and icons

The cover, banner, diagrams and icons in [`assets/`](assets/) are generated by
[`scripts/generate-doc-assets.mjs`](../scripts/generate-doc-assets.mjs). Edit the script, not the SVG files, then run
`pnpm docs:assets`. `assets/cover.png` (1280 × 640) can also be uploaded as the repository's social preview image
(GitHub: **Settings → General → Social preview**).
