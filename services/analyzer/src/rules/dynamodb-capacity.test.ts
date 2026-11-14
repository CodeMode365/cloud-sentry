import { describe, expect, it } from 'vitest';
import { ctxFor } from '../__fixtures__/context';
import { dynamoDbMetrics, dynamoDbTable, type CapacityProfileSpec } from '../__fixtures__/resources';
import { dynamoDbCapacityModeRule as modeRule } from './dynamodb-capacity-mode';
import { dynamoDbOverprovisionedCapacityRule as overRule } from './dynamodb-overprovisioned-capacity';
import { CAPACITY_MODE_DEFAULTS, DYNAMODB_CAPACITY_MODE_RULE_ID } from './dynamodb-shared';

const overCtx = (o = {}, peer: Record<string, number> = {}) => ({
  ...ctxFor(overRule.defaultThresholds, o),
  ruleThresholds: new Map([[DYNAMODB_CAPACITY_MODE_RULE_ID, { ...CAPACITY_MODE_DEFAULTS, ...peer }]]),
});
const modeCtx = (o = {}) => ctxFor(modeRule.defaultThresholds, o);

/** Spiky low traffic: avg 2% / 2% of provisioned, busiest hour 10x / 5x the average. */
const spiky = () => dynamoDbMetrics({ read: { avg: 2, p95: 8, max: 20 }, write: { avg: 1, p95: 3, max: 5 } });

describe('dynamodb-overprovisioned-capacity', () => {
  it('recommends max(1, ceil(busiest hour x 2)) per side for steady low traffic', () => {
    const out = overRule.evaluate(dynamoDbTable({ utilization: dynamoDbMetrics() }), overCtx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.suggestedAction.type).toBe('RIGHTSIZE_TABLE_CAPACITY');
    expect(out.confidence).toBe('MEDIUM');
    expect(out.savingsRequest).toEqual({
      kind: 'DYNAMODB_RIGHTSIZE_PROVISIONED',
      region: 'us-east-1',
      tableClass: 'STANDARD',
      currentRcu: 100,
      currentWcu: 50,
      recommendedRcu: 24,
      recommendedWcu: 12,
    });
    expect(out.evidence.find((e) => e.key === 'read.p95Utilization')).toMatchObject({
      value: 10,
      threshold: '< 30',
    });
    expect(out.evidence.some((e) => e.key === 'granularity.note')).toBe(true);
  });

  it('keeps a side unchanged when it is busy or throttled', () => {
    const busyRead = overRule.evaluate(
      dynamoDbTable({ utilization: dynamoDbMetrics({ read: { avg: 30, p95: 40, max: 45 } }) }),
      overCtx(),
    );
    expect(busyRead.outcome === 'DETECTED' && busyRead.savingsRequest).toMatchObject({
      recommendedRcu: 100,
      recommendedWcu: 12,
    });
    const throttled = overRule.evaluate(
      dynamoDbTable({ utilization: dynamoDbMetrics({ writeThrottles: 7 }) }),
      overCtx(),
    );
    expect(throttled.outcome === 'DETECTED' && throttled.savingsRequest).toMatchObject({
      recommendedRcu: 24,
      recommendedWcu: 50,
    });
  });

  it('honours threshold overrides', () => {
    const r = dynamoDbTable({ utilization: dynamoDbMetrics() });
    expect(overRule.evaluate(r, overCtx({ maxUtilizationPercent: 5 })).outcome).toBe('NOT_DETECTED');
    expect(overRule.evaluate(r, overCtx({ headroomFactor: 5 }))).toMatchObject({
      savingsRequest: { recommendedRcu: 60, recommendedWcu: 30 },
    });
  });

  it('is NOT_EVALUATED when auto scaling is unknown and NOT_DETECTED when it is enabled or on-demand', () => {
    const util = dynamoDbMetrics();
    expect(
      overRule.evaluate(
        dynamoDbTable({ attributes: { autoScalingEnabled: null }, utilization: util }),
        overCtx(),
      ),
    ).toMatchObject({
      outcome: 'NOT_EVALUATED',
      reason: expect.stringMatching(/^AUTOSCALING_UNKNOWN/),
    });
    expect(
      overRule.evaluate(
        dynamoDbTable({ attributes: { autoScalingEnabled: true }, utilization: util }),
        overCtx(),
      ).outcome,
    ).toBe('NOT_DETECTED');
    const onDemand = dynamoDbTable({
      attributes: {
        billingMode: 'PAY_PER_REQUEST',
        provisionedReadCapacityUnits: null,
        provisionedWriteCapacityUnits: null,
      },
      utilization: util,
    });
    expect(overRule.evaluate(onDemand, overCtx()).outcome).toBe('NOT_DETECTED');
    expect(modeRule.evaluate(onDemand, modeCtx()).outcome).toBe('NOT_DETECTED');
  });

  it('treats NO_DATA as NOT_EVALUATED', () => {
    expect(
      overRule.evaluate(dynamoDbTable({ utilization: dynamoDbMetrics({ read: null }) }), overCtx()),
    ).toEqual({
      outcome: 'NOT_EVALUATED',
      reason: 'METRIC_NO_DATA: ConsumedReadCapacityUnits:Sum',
    });
  });
});

describe('dynamodb-capacity-mode', () => {
  it('flags spiky low-utilization tables with normalised monthly units', () => {
    const out = modeRule.evaluate(dynamoDbTable({ utilization: spiky() }), modeCtx());
    expect(out.outcome).toBe('DETECTED');
    if (out.outcome !== 'DETECTED') return;
    expect(out.suggestedAction.type).toBe('SWITCH_CAPACITY_MODE');
    // read: 2 units/s x 3600 x 720 hours = 5,184,000 over 30 days
    expect(out.savingsRequest).toEqual({
      kind: 'DYNAMODB_SWITCH_TO_ON_DEMAND',
      region: 'us-east-1',
      tableClass: 'STANDARD',
      provisionedRcu: 100,
      provisionedWcu: 50,
      monthlyReadUnits: 5_184_000,
      monthlyWriteUnits: 2_592_000,
    });
    expect(out.evidence.find((e) => e.key === 'read.peakToAverage')?.value).toBe(10);
  });

  it('is NOT_DETECTED for steady traffic, high average utilization or zero traffic', () => {
    expect(modeRule.evaluate(dynamoDbTable({ utilization: dynamoDbMetrics() }), modeCtx()).outcome).toBe(
      'NOT_DETECTED',
    );
    const busy = dynamoDbMetrics({ read: { avg: 20, p95: 60, max: 90 }, write: { avg: 1, p95: 3, max: 5 } });
    expect(modeRule.evaluate(dynamoDbTable({ utilization: busy }), modeCtx()).outcome).toBe('NOT_DETECTED');
    const zero = dynamoDbMetrics({ read: { avg: 0, p95: 0, max: 0 }, write: { avg: 0, p95: 0, max: 0 } });
    expect(modeRule.evaluate(dynamoDbTable({ utilization: zero }), modeCtx()).outcome).toBe('NOT_DETECTED');
  });

  it('ignores sides with zero provisioned capacity and still evaluates auto-scaled tables', () => {
    const noWrites = dynamoDbTable({
      attributes: { provisionedWriteCapacityUnits: 0 },
      utilization: spiky(),
    });
    expect(modeRule.evaluate(noWrites, modeCtx()).outcome).toBe('DETECTED');
    const scaled = modeRule.evaluate(
      dynamoDbTable({ attributes: { autoScalingEnabled: true }, utilization: spiky() }),
      modeCtx(),
    );
    expect(
      scaled.outcome === 'DETECTED' && scaled.evidence.some((e) => e.key === 'table.autoScalingNote'),
    ).toBe(true);
  });

  it('honours threshold overrides', () => {
    const r = dynamoDbTable({ utilization: spiky() });
    expect(modeRule.evaluate(r, modeCtx({ minPeakToAverage: 50 })).outcome).toBe('NOT_DETECTED');
    expect(modeRule.evaluate(r, modeCtx({ maxAverageUtilizationPercent: 1 })).outcome).toBe('NOT_DETECTED');
  });
});

describe('dynamodb capacity rules are mutually exclusive', () => {
  const profiles: [string, CapacityProfileSpec, CapacityProfileSpec][] = [
    ['steady', { avg: 8, p95: 10, max: 12 }, { avg: 4, p95: 5, max: 6 }],
    ['spiky', { avg: 2, p95: 8, max: 20 }, { avg: 1, p95: 3, max: 5 }],
    ['spiky reads only', { avg: 2, p95: 6, max: 10 }, { avg: 4, p95: 5, max: 6 }],
    ['busy', { avg: 50, p95: 80, max: 95 }, { avg: 30, p95: 45, max: 48 }],
    ['idle', { avg: 0, p95: 0, max: 0 }, { avg: 0, p95: 0, max: 0 }],
    ['near thresholds', { avg: 14.9, p95: 29, max: 60 }, { avg: 1, p95: 2, max: 4 }],
  ];
  it.each(profiles)('never detects both rules (%s)', (_name, read, write) => {
    const r = dynamoDbTable({ utilization: dynamoDbMetrics({ read, write }) });
    const outcomes = [overRule.evaluate(r, overCtx()).outcome, modeRule.evaluate(r, modeCtx()).outcome];
    expect(outcomes.filter((o) => o === 'DETECTED').length).toBeLessThanOrEqual(1);
  });

  it('hands spiky tables to dynamodb-capacity-mode and respects its overridden thresholds', () => {
    const r = dynamoDbTable({ utilization: spiky() });
    expect(overRule.evaluate(r, overCtx()).outcome).toBe('NOT_DETECTED');
    expect(modeRule.evaluate(r, modeCtx()).outcome).toBe('DETECTED');
    // With the capacity-mode rule made stricter, the table is no longer "spiky" for either rule.
    expect(overRule.evaluate(r, overCtx({}, { minPeakToAverage: 50 })).outcome).toBe('DETECTED');
    expect(modeRule.evaluate(r, modeCtx({ minPeakToAverage: 50 })).outcome).toBe('NOT_DETECTED');
  });

  it('falls back to capacity-mode defaults when no peer thresholds are supplied', () => {
    const r = dynamoDbTable({ utilization: spiky() });
    expect(overRule.evaluate(r, ctxFor(overRule.defaultThresholds)).outcome).toBe('NOT_DETECTED');
  });

  it('does not evaluate tables whose details could not be read', () => {
    const unknown = dynamoDbTable({
      state: 'unknown',
      attributes: { billingMode: 'UNKNOWN', tableClass: 'UNKNOWN' },
      utilization: spiky(),
    });
    for (const out of [overRule.evaluate(unknown, overCtx()), modeRule.evaluate(unknown, modeCtx())]) {
      expect(out.outcome === 'NOT_EVALUATED' && out.reason).toMatch(/^TABLE_DETAILS_UNAVAILABLE/);
    }
  });
});
