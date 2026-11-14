import { describe, expect, it } from 'vitest';
import { ctxFor } from '../__fixtures__/context';
import { daysAgo, dynamoDbMetrics, dynamoDbTable } from '../__fixtures__/resources';
import { unusedDynamoDbTableRule as rule } from './unused-dynamodb-table';

const ctx = (o = {}) => ctxFor(rule.defaultThresholds, o);
const zero = { avg: 0, p95: 0, max: 0 };
const idle = (o: { coverage?: number; observableDays?: number } = {}) =>
  dynamoDbMetrics({ read: zero, write: zero, ...o });

describe('unused-dynamodb-table', () => {
  it('flags tables with zero consumed capacity (data present) with HIGH risk', () => {
    const out = rule.evaluate(dynamoDbTable({ utilization: idle() }), ctx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.riskLevel).toBe('HIGH');
    expect(out.confidence).toBe('HIGH');
    expect(out.suggestedAction.type).toBe('DELETE_TABLE');
    expect(out.savingsRequest).toEqual({
      kind: 'DYNAMODB_DELETE_TABLE',
      region: 'us-east-1',
      tableClass: 'STANDARD',
      billingMode: 'PROVISIONED',
      provisionedRcu: 100,
      provisionedWcu: 50,
      storageGb: 5,
    });
  });

  it('treats NO_DATA as NOT_EVALUATED, never as zero traffic', () => {
    expect(
      rule.evaluate(dynamoDbTable({ utilization: dynamoDbMetrics({ read: null, write: null }) }), ctx()),
    ).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'METRIC_NO_DATA: ConsumedReadCapacityUnits:Sum',
    });
  });

  it('treats observed traffic as conclusive at any coverage but needs coverage to conclude unused', () => {
    expect(
      rule.evaluate(dynamoDbTable({ utilization: dynamoDbMetrics({ coverage: 0.1 }) }), ctx()).outcome,
    ).toBe('NOT_DETECTED');
    const out = rule.evaluate(dynamoDbTable({ utilization: idle({ coverage: 0.5 }) }), ctx());
    expect(out.outcome === 'NOT_EVALUATED' && out.reason).toMatch(/^INSUFFICIENT_METRIC_COVERAGE/);
  });

  it('applies the age gate (overridable) and falls back to the observed period when createdAt is null', () => {
    const young = dynamoDbTable({ createdAt: daysAgo(20), utilization: idle({ observableDays: 20 }) });
    expect(rule.evaluate(young, ctx()).outcome).toBe('NOT_DETECTED');
    expect(rule.evaluate(young, ctx({ minAgeDays: 10 })).outcome).toBe('DETECTED');
    const noCreated = rule.evaluate(dynamoDbTable({ createdAt: null, utilization: idle() }), ctx());
    expect(
      noCreated.outcome === 'DETECTED' && noCreated.evidence.find((e) => e.key === 'table.ageDays')?.label,
    ).toMatch(/creation time unknown/);
    expect(rule.evaluate(dynamoDbTable({ createdAt: null }), ctx())).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'CREATION_TIME_UNKNOWN',
    });
  });

  it('still detects protected tables, with a note, and prices on-demand tables without capacity', () => {
    const protectedOut = rule.evaluate(
      dynamoDbTable({ attributes: { deletionProtectionEnabled: true }, utilization: idle() }),
      ctx(),
    );
    expect(protectedOut.outcome === 'DETECTED' && protectedOut.riskLevel).toBe('HIGH');
    expect(
      protectedOut.outcome === 'DETECTED' &&
        protectedOut.evidence.some((e) => e.key === 'table.deletionProtectionNote'),
    ).toBe(true);
    const onDemand = rule.evaluate(
      dynamoDbTable({
        attributes: {
          billingMode: 'PAY_PER_REQUEST',
          provisionedReadCapacityUnits: null,
          provisionedWriteCapacityUnits: null,
        },
        utilization: idle(),
      }),
      ctx(),
    );
    expect(onDemand.outcome === 'DETECTED' && onDemand.savingsRequest).toMatchObject({
      billingMode: 'PAY_PER_REQUEST',
      provisionedRcu: 0,
      provisionedWcu: 0,
    });
  });

  it('lowers confidence for global table replicas and skips unreadable tables', () => {
    const replica = rule.evaluate(
      dynamoDbTable({ attributes: { replicaRegions: ['eu-west-1'] }, utilization: idle() }),
      ctx(),
    );
    expect(replica.outcome === 'DETECTED' && replica.confidence).toBe('MEDIUM');
    const unknown = rule.evaluate(
      dynamoDbTable({ state: 'unknown', attributes: { billingMode: 'UNKNOWN' }, utilization: idle() }),
      ctx(),
    );
    expect(unknown.outcome === 'NOT_EVALUATED' && unknown.reason).toMatch(/^TABLE_DETAILS_UNAVAILABLE/);
  });
});
