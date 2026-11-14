import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostAndUsageWithResourcesCommand,
  type GetCostAndUsageCommandInput,
  type GetCostAndUsageCommandOutput,
} from '@aws-sdk/client-cost-explorer';
import { silentLogger } from '@cloudsentry/utilities';
import { computeRanges, fetchCostSnapshot } from './cost-explorer';

const ceMock = mockClient(CostExplorerClient);
const awsError = (name: string) => Object.assign(new Error(`${name} message`), { name });
const usd = (amount: string) => ({ UnblendedCost: { Amount: amount, Unit: 'USD' } });

function kind(input: GetCostAndUsageCommandInput): 'monthly' | 'daily' | 'services' | 'regions' {
  if (input.Granularity === 'DAILY') return 'daily';
  const group = input.GroupBy?.[0]?.Key;
  if (group === 'SERVICE') return 'services';
  if (group === 'REGION') return 'regions';
  return 'monthly';
}

/** Synthetic Cost Explorer responses for "now" = 2026-11-03. */
function happyPath(input: GetCostAndUsageCommandInput): Partial<GetCostAndUsageCommandOutput> {
  switch (kind(input)) {
    case 'monthly':
      return {
        ResultsByTime: [
          { TimePeriod: { Start: '2026-09-01', End: '2026-10-01' }, Total: usd('100.004'), Estimated: false },
          { TimePeriod: { Start: '2026-10-01', End: '2026-11-01' }, Total: usd('120.5'), Estimated: false },
          { TimePeriod: { Start: '2026-11-01', End: '2026-11-04' }, Total: usd('12.25'), Estimated: true },
        ],
      };
    case 'daily':
      if (!input.NextPageToken) {
        return {
          NextPageToken: 'p2',
          ResultsByTime: [
            { TimePeriod: { Start: '2026-10-01', End: '2026-10-02' }, Total: usd('4'), Estimated: false },
            { TimePeriod: { Start: '2026-10-02', End: '2026-10-03' }, Total: usd('4'), Estimated: false },
            { TimePeriod: { Start: '2026-10-03', End: '2026-10-04' }, Total: usd('4'), Estimated: false },
            { TimePeriod: { Start: '2026-10-04', End: '2026-10-05' }, Total: usd('4'), Estimated: false },
          ],
        };
      }
      return {
        ResultsByTime: [
          { TimePeriod: { Start: '2026-11-01', End: '2026-11-02' }, Total: usd('5'), Estimated: true },
          { TimePeriod: { Start: '2026-11-02', End: '2026-11-03' }, Total: usd('5.25'), Estimated: true },
          { TimePeriod: { Start: '2026-11-03', End: '2026-11-04' }, Total: usd('2'), Estimated: true },
        ],
      };
    case 'services':
      return {
        ResultsByTime: [
          {
            TimePeriod: { Start: '2026-11-01', End: '2026-11-04' },
            Total: {},
            Groups: [
              { Keys: ['Amazon Elastic Compute Cloud - Compute'], Metrics: usd('8') },
              { Keys: ['Amazon Simple Storage Service'], Metrics: usd('4.25') },
              { Keys: ['Tax'], Metrics: usd('0') },
            ],
            Estimated: true,
          },
        ],
      };
    case 'regions':
      return {
        ResultsByTime: [
          {
            TimePeriod: { Start: '2026-11-01', End: '2026-11-04' },
            Groups: [
              { Keys: ['us-east-1'], Metrics: usd('10') },
              { Keys: ['global'], Metrics: usd('2.25') },
            ],
          },
        ],
      };
  }
}

beforeEach(() => ceMock.reset());

describe('computeRanges', () => {
  it('uses an exclusive end of tomorrow so Start < End on the first day of a month', () => {
    const r = computeRanges(new Date('2026-11-01T00:30:00Z'), 6);
    expect(r).toEqual({
      today: '2026-11-01',
      endExclusive: '2026-11-02',
      currentMonthStart: '2026-11-01',
      previousMonthStart: '2026-10-01',
      trendStart: '2026-05-01',
      resourceLevelStart: '2026-10-19',
    });
    expect(r.currentMonthStart < r.endExclusive).toBe(true);
  });

  it('handles year boundaries', () => {
    const r = computeRanges(new Date('2027-01-15T10:00:00Z'), 6);
    expect(r.previousMonthStart).toBe('2026-12-01');
    expect(r.trendStart).toBe('2026-07-01');
  });
});

describe('fetchCostSnapshot', () => {
  it('parses trend, daily (with pagination), breakdowns, and unfinalized flags', async () => {
    ceMock.on(GetCostAndUsageCommand).callsFake(happyPath);
    const snapshot = await fetchCostSnapshot(new CostExplorerClient({ region: 'us-east-1' }), {
      now: new Date('2026-11-03T15:00:00Z'),
      months: 6,
      includeResourceLevel: false,
      logger: silentLogger,
    });

    const calls = ceMock.commandCalls(GetCostAndUsageCommand).map((c) => c.args[0].input);
    expect(calls).toHaveLength(5); // monthly, daily x2 pages, services, regions
    expect(calls[0]?.TimePeriod).toEqual({ Start: '2026-05-01', End: '2026-11-04' });
    expect(calls[1]?.TimePeriod).toEqual({ Start: '2026-10-01', End: '2026-11-04' });
    expect(calls[2]?.NextPageToken).toBe('p2');

    expect(snapshot.availability).toBe('AVAILABLE');
    expect(snapshot.unavailableReason).toBeNull();
    expect(snapshot.currency).toBe('USD');
    expect(snapshot.costMetric).toBe('UnblendedCost');
    expect(snapshot.monthlyTrend).toEqual([
      { month: '2026-09', amount: 100, unfinalized: false },
      { month: '2026-10', amount: 120.5, unfinalized: false },
      { month: '2026-11', amount: 12.25, unfinalized: true },
    ]);
    expect(snapshot.daily).toHaveLength(7);
    expect(snapshot.currentMonth).toEqual({
      amount: 12.25,
      unfinalized: true,
      start: '2026-11-01',
      end: '2026-11-03',
    });
    expect(snapshot.previousMonth).toEqual({
      amount: 120.5,
      unfinalized: false,
      start: '2026-10-01',
      end: '2026-10-31',
    });
    expect(snapshot.previousMonthToDate).toEqual({ amount: 12, unfinalized: false });
    expect(snapshot.services).toEqual([
      { key: 'Amazon Elastic Compute Cloud - Compute', amount: 8 },
      { key: 'Amazon Simple Storage Service', amount: 4.25 },
    ]);
    expect(snapshot.regions).toEqual([
      { key: 'us-east-1', amount: 10 },
      { key: 'global', amount: 2.25 },
    ]);
    expect(snapshot.resourceLevel.availability).toBe('UNAVAILABLE');
    expect(ceMock.commandCalls(GetCostAndUsageWithResourcesCommand)).toHaveLength(0);
    expect(snapshot.errors).toEqual([]);
  });

  it('reports PARTIAL when some queries fail and keeps the others', async () => {
    ceMock.on(GetCostAndUsageCommand).callsFake((input: GetCostAndUsageCommandInput) => {
      if (kind(input) === 'services') throw awsError('LimitExceededException');
      return happyPath(input);
    });
    const snapshot = await fetchCostSnapshot(new CostExplorerClient({ region: 'us-east-1' }), {
      now: new Date('2026-11-03T15:00:00Z'),
      months: 6,
      includeResourceLevel: false,
      logger: silentLogger,
    });
    expect(snapshot.availability).toBe('PARTIAL');
    expect(snapshot.services).toEqual([]);
    expect(snapshot.regions).toHaveLength(2);
    expect(snapshot.errors).toEqual([
      { query: 'services', code: 'LimitExceededException', message: 'LimitExceededException message' },
    ]);
    expect(snapshot.unavailableReason).toContain('LimitExceededException');
  });

  it('reports UNAVAILABLE with an actionable reason when access is denied', async () => {
    ceMock.on(GetCostAndUsageCommand).rejects(awsError('AccessDeniedException'));
    const snapshot = await fetchCostSnapshot(new CostExplorerClient({ region: 'us-east-1' }), {
      now: new Date('2026-11-03T15:00:00Z'),
      months: 6,
      includeResourceLevel: false,
      logger: silentLogger,
    });
    expect(snapshot.availability).toBe('UNAVAILABLE');
    expect(snapshot.unavailableReason).toBe('Cost Explorer access denied or not enabled for this account');
    expect(snapshot.currentMonth).toBeNull();
    expect(snapshot.previousMonth).toBeNull();
    expect(snapshot.monthlyTrend).toEqual([]);
    expect(snapshot.errors).toHaveLength(4);
  });

  it('collects resource-level EC2 costs when enabled', async () => {
    ceMock.on(GetCostAndUsageCommand).callsFake(happyPath);
    ceMock
      .on(GetCostAndUsageWithResourcesCommand)
      .resolvesOnce({
        NextPageToken: 'r2',
        ResultsByTime: [
          {
            Groups: [
              { Keys: ['i-1'], Metrics: usd('1.111') },
              { Keys: ['i-2'], Metrics: usd('3') },
            ],
          },
        ],
      })
      .resolvesOnce({ ResultsByTime: [{ Groups: [{ Keys: ['i-1'], Metrics: usd('1.111') }] }] });
    const snapshot = await fetchCostSnapshot(new CostExplorerClient({ region: 'us-east-1' }), {
      now: new Date('2026-11-03T15:00:00Z'),
      months: 6,
      includeResourceLevel: true,
      logger: silentLogger,
    });
    const input = ceMock.commandCalls(GetCostAndUsageWithResourcesCommand)[0]?.args[0].input;
    expect(input?.TimePeriod).toEqual({ Start: '2026-10-21', End: '2026-11-04' });
    expect(input?.Filter?.Dimensions?.Values).toEqual(['Amazon Elastic Compute Cloud - Compute']);
    expect(snapshot.resourceLevel.availability).toBe('AVAILABLE');
    expect(snapshot.resourceLevel.items).toEqual([
      { resourceId: 'i-2', service: 'Amazon Elastic Compute Cloud - Compute', amount: 3 },
      { resourceId: 'i-1', service: 'Amazon Elastic Compute Cloud - Compute', amount: 2.22 },
    ]);
  });

  it('marks resource-level data unavailable when the account has not opted in', async () => {
    ceMock.on(GetCostAndUsageCommand).callsFake(happyPath);
    ceMock.on(GetCostAndUsageWithResourcesCommand).rejects(awsError('DataUnavailableException'));
    const snapshot = await fetchCostSnapshot(new CostExplorerClient({ region: 'us-east-1' }), {
      now: new Date('2026-11-03T15:00:00Z'),
      months: 6,
      includeResourceLevel: true,
      logger: silentLogger,
    });
    expect(snapshot.availability).toBe('AVAILABLE');
    expect(snapshot.resourceLevel.availability).toBe('UNAVAILABLE');
    expect(snapshot.resourceLevel.reason).toContain('opting in');
    expect(snapshot.errors.map((e) => e.query)).toEqual(['resourceLevel']);
  });

  it('queries valid ranges on the first day of the month', async () => {
    ceMock.on(GetCostAndUsageCommand).resolves({ ResultsByTime: [] });
    await fetchCostSnapshot(new CostExplorerClient({ region: 'us-east-1' }), {
      now: new Date('2026-12-01T00:05:00Z'),
      months: 6,
      includeResourceLevel: false,
      logger: silentLogger,
    });
    for (const call of ceMock.commandCalls(GetCostAndUsageCommand)) {
      const period = call.args[0].input.TimePeriod;
      expect(period?.Start && period.End && period.Start < period.End).toBe(true);
      expect(period?.End).toBe('2026-12-02');
    }
  });
});
