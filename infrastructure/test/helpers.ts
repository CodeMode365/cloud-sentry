import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { buildCloudSentry, type CloudSentryStacks } from '../app';
import { allHandlerEntriesExist, missingHandlerEntries } from '../constructs/handlers';

export const TEST_ACCOUNT = '123456789012';
export const TEST_REGION = 'us-east-1';

export const handlersPresent = allHandlerEntriesExist();
if (!handlersPresent) {
  console.warn(
    `[infrastructure tests] Skipping synthesis tests: ${missingHandlerEntries().length} Lambda handler entry ` +
      `file(s) do not exist yet (e.g. ${missingHandlerEntries()[0]}). NodejsFunction requires entries to exist.`,
  );
}

let cached: { stacks: CloudSentryStacks; templates: Record<string, Template> } | undefined;

/** Synthesizes the dev stage once (bundling skipped) and returns templates keyed by stack role. */
export function synth(): {
  stacks: CloudSentryStacks;
  templates: Record<keyof Omit<CloudSentryStacks, 'config'>, Template>;
} {
  if (!cached) {
    const app = new App({ context: { stage: 'dev', 'aws:cdk:bundling-stacks': [] } });
    const stacks = buildCloudSentry(app, {
      CDK_DEFAULT_ACCOUNT: TEST_ACCOUNT,
      CDK_DEFAULT_REGION: TEST_REGION,
    });
    const templates: Record<string, Template> = {};
    for (const key of ['data', 'auth', 'workflow', 'api', 'web', 'observability'] as const) {
      templates[key] = Template.fromStack(stacks[key]);
    }
    cached = { stacks, templates };
  }
  return cached as {
    stacks: CloudSentryStacks;
    templates: Record<keyof Omit<CloudSentryStacks, 'config'>, Template>;
  };
}

type PolicyStatementJson = {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Condition?: unknown;
};

/** All IAM policy statements (inline policies and managed policies) in a template. */
export function iamStatements(template: Template): PolicyStatementJson[] {
  const out: PolicyStatementJson[] = [];
  for (const type of ['AWS::IAM::Policy', 'AWS::IAM::ManagedPolicy']) {
    for (const resource of Object.values(template.findResources(type))) {
      const doc = (resource as { Properties: { PolicyDocument: { Statement: PolicyStatementJson[] } } })
        .Properties.PolicyDocument;
      out.push(...doc.Statement);
    }
  }
  for (const resource of Object.values(template.findResources('AWS::IAM::Role'))) {
    const policies = (
      resource as { Properties: { Policies?: { PolicyDocument: { Statement: PolicyStatementJson[] } }[] } }
    ).Properties.Policies;
    for (const p of policies ?? []) out.push(...p.PolicyDocument.Statement);
  }
  return out;
}

export function actionsOf(statement: PolicyStatementJson): string[] {
  return Array.isArray(statement.Action) ? statement.Action : [statement.Action];
}

/** Policies attached to the execution role of a function identified by its physical name suffix. */
export function statementsForFunction(template: Template, functionIdSuffix: string): PolicyStatementJson[] {
  const functions = template.findResources('AWS::Lambda::Function', {
    Properties: { FunctionName: `cloudsentry-dev-${functionIdSuffix}` },
  });
  const fn = Object.values(functions)[0] as
    { Properties: { Role: { 'Fn::GetAtt': [string, string] } } } | undefined;
  if (!fn) throw new Error(`Function cloudsentry-dev-${functionIdSuffix} not found`);
  const roleLogicalId = fn.Properties.Role['Fn::GetAtt'][0];
  const policies = template.findResources('AWS::IAM::Policy');
  return Object.values(policies)
    .filter((p) =>
      ((p as { Properties: { Roles: { Ref: string }[] } }).Properties.Roles ?? []).some(
        (r) => r.Ref === roleLogicalId,
      ),
    )
    .flatMap(
      (p) =>
        (p as { Properties: { PolicyDocument: { Statement: PolicyStatementJson[] } } }).Properties
          .PolicyDocument.Statement,
    );
}
