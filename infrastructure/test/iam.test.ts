import { describe, expect, it } from 'vitest';
import { actionsOf, handlersPresent, iamStatements, statementsForFunction, synth } from './helpers';

describe.skipIf(!handlersPresent)('IAM least privilege', () => {
  it('never grants wildcard actions', () => {
    const { templates } = synth();
    for (const [stack, template] of Object.entries(templates)) {
      for (const statement of iamStatements(template)) {
        if (statement.Effect !== 'Allow') continue;
        for (const action of actionsOf(statement)) {
          expect(action, `${stack}: ${JSON.stringify(statement)}`).not.toBe('*');
          expect(action, `${stack}: ${JSON.stringify(statement)}`).not.toMatch(/^[a-z0-9-]+:\*$/);
        }
      }
    }
  });

  it('scopes every sts:AssumeRole grant to CloudSentry* customer roles', () => {
    const { templates } = synth();
    let found = 0;
    for (const template of [templates.workflow, templates.api]) {
      for (const statement of iamStatements(template)) {
        if (!actionsOf(statement).includes('sts:AssumeRole')) continue;
        found++;
        expect(actionsOf(statement)).toEqual(['sts:AssumeRole']);
        expect(statement.Resource).toBe('arn:aws:iam::*:role/CloudSentry*');
      }
    }
    // assume-role, resolve-regions, 16 discovery workers, collect-metrics, analyze-costs + api-accounts.
    expect(found).toBe(21);
  });

  it('gives customer-account access only to functions that need it', () => {
    const { templates } = synth();
    const hasAssume = (tpl: typeof templates.workflow, id: string) =>
      statementsForFunction(tpl, id).some((s) => actionsOf(s).includes('sts:AssumeRole'));
    expect(hasAssume(templates.workflow, 'discover-ec2')).toBe(true);
    expect(hasAssume(templates.workflow, 'persist-results')).toBe(false);
    expect(hasAssume(templates.workflow, 'execute-detection-rules')).toBe(false);
    expect(hasAssume(templates.api, 'api-inventory')).toBe(false);
    expect(hasAssume(templates.api, 'api-accounts')).toBe(true);
  });

  it('lets persist-results write its persisted.json artifact', () => {
    const { templates } = synth();
    const actions = statementsForFunction(templates.workflow, 'persist-results').flatMap(actionsOf);
    expect(actions).toContain('s3:GetObject');
    expect(actions).toContain('s3:PutObject');
  });

  it('never grants DynamoDB Scan or table management', () => {
    const { templates } = synth();
    for (const template of Object.values(templates)) {
      for (const statement of iamStatements(template)) {
        for (const action of actionsOf(statement)) {
          expect([
            'dynamodb:Scan',
            'dynamodb:DeleteTable',
            'dynamodb:UpdateTable',
            'dynamodb:*',
          ]).not.toContain(action);
        }
      }
    }
  });

  it('restricts the scheduler execution role to invoking the scheduled-scan trigger', () => {
    const { templates } = synth();
    const role = Object.values(
      templates.workflow.findResources('AWS::IAM::Role', {
        Properties: { RoleName: 'cloudsentry-dev-scheduler' },
      }),
    )[0] as { Properties: { AssumeRolePolicyDocument: { Statement: { Condition: unknown }[] } } };
    expect(role.Properties.AssumeRolePolicyDocument.Statement[0]?.Condition).toMatchObject({
      StringEquals: { 'aws:SourceAccount': '123456789012' },
    });
  });

  it('grants pricing:GetProducts only to estimate-savings', () => {
    const { templates } = synth();
    const withPricing = iamStatements(templates.workflow).filter((s) =>
      actionsOf(s).includes('pricing:GetProducts'),
    );
    expect(withPricing).toHaveLength(1);
    expect(
      statementsForFunction(templates.workflow, 'estimate-savings').some((s) =>
        actionsOf(s).includes('pricing:GetProducts'),
      ),
    ).toBe(true);
  });
});
