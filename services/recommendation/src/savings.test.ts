import { describe, expect, it } from 'vitest';
import type { SavingsRequest } from '@cloudsentry/shared-types';
import {
  ARTIFACT_KEYS,
  type ArtifactEnvelope,
  type PricedRecommendationDraft,
} from '@cloudsentry/shared-types';
import { silentLogger } from '@cloudsentry/utilities';
import {
  baseState,
  envelope,
  FakePriceProvider,
  issue,
  MemoryArtifacts,
  NOW,
  PREFIX,
} from './__fixtures__/issues';
import { generateRecommendations, recommendationFor } from './generate';
import { escalateSeverity, estimateRequestSavings, estimateSavings, severityForSavings } from './savings';
import { runEstimateSavingsStep } from './step-savings';

const ec2: SavingsRequest = {
  kind: 'EC2_INSTANCE_STOP',
  region: 'us-east-1',
  instanceType: 't3.large',
  operatingSystem: 'Linux',
  tenancy: 'Shared',
  preInstalledSw: 'NA',
  licenseModel: 'No License required',
  nonOnDemandLifecycle: null,
};

describe('estimateRequestSavings', () => {
  const pricing = new FakePriceProvider();

  it.each<[string, SavingsRequest, number, 'POINT' | 'UPPER_BOUND']>([
    ['EC2 stop', ec2, 60.74, 'POINT'], // 0.0832 * 730
    [
      'EBS delete',
      { kind: 'EBS_VOLUME_DELETE', region: 'us-east-1', volumeType: 'gp3', sizeGiB: 100 },
      8,
      'POINT',
    ],
    ['EIP release', { kind: 'ELASTIC_IP_RELEASE', region: 'us-east-1' }, 3.65, 'POINT'],
    [
      'RDS rightsize',
      {
        kind: 'RDS_RIGHTSIZE',
        region: 'us-east-1',
        databaseEngine: 'PostgreSQL',
        currentClass: 'db.m5.2xlarge',
        targetClass: 'db.m5.xlarge',
        multiAz: false,
      },
      259.88,
      'POINT',
    ],
    [
      'RDS stop',
      {
        kind: 'RDS_STOP',
        region: 'us-east-1',
        databaseEngine: 'PostgreSQL',
        instanceClass: 'db.m5.2xlarge',
        multiAz: false,
      },
      519.76,
      'POINT',
    ],
    ['snapshot', { kind: 'EBS_SNAPSHOT_DELETE', region: 'us-east-1', sizeGiB: 50 }, 2.5, 'UPPER_BOUND'],
    ['NAT', { kind: 'NAT_GATEWAY_DELETE', region: 'us-east-1' }, 32.85, 'POINT'],
  ])('%s', async (_name, request, monthly, estimateType) => {
    const est = await estimateRequestSavings(request, pricing, NOW);
    expect(est.status).toBe('ESTIMATED');
    expect(est.monthly).toBe(monthly);
    expect(est.annual).toBeCloseTo(monthly * 12, 0);
    expect(est.estimateType).toBe(estimateType);
    expect(est.currency).toBe('USD');
    expect(est.pricingSources.length).toBeGreaterThan(0);
    expect(est.assumptions.some((a) => a.includes('not a guaranteed'))).toBe(true);
    expect(est.assumptions.some((a) => a.includes('Savings Plans'))).toBe(true);
  });

  it('passes Multi-AZ deployment option to RDS price lookups', async () => {
    const p = new FakePriceProvider();
    await estimateRequestSavings(
      {
        kind: 'RDS_STOP',
        region: 'eu-west-1',
        databaseEngine: 'MySQL',
        instanceClass: 'db.m5.2xlarge',
        multiAz: true,
      },
      p,
      NOW,
    );
    expect(p.calls[0]).toMatchObject({
      kind: 'RDS_INSTANCE_HOURLY',
      deploymentOption: 'Multi-AZ',
      databaseEngine: 'MySQL',
      region: 'eu-west-1',
    });
  });

  it('is UNAVAILABLE when the price is missing, never a guess', async () => {
    const est = await estimateRequestSavings(ec2, new FakePriceProvider({}), NOW);
    expect(est).toMatchObject({ status: 'UNAVAILABLE', monthly: null, annual: null });
    expect(est.unavailableReason).toMatch(/^NO_MATCHING_PRICE/);
  });

  it('is UNAVAILABLE for non-on-demand instances without calling the pricing API', async () => {
    const p = new FakePriceProvider();
    const est = await estimateRequestSavings({ ...ec2, nonOnDemandLifecycle: 'spot' }, p, NOW);
    expect(est.status).toBe('UNAVAILABLE');
    expect(p.calls).toHaveLength(0);
  });

  it('handles RDS rightsizing without a target, unsupported engines and non-cheaper targets', async () => {
    const base = {
      kind: 'RDS_RIGHTSIZE' as const,
      region: 'us-east-1',
      currentClass: 'db.m5.2xlarge',
      multiAz: false,
    };
    expect(
      (
        await estimateRequestSavings(
          { ...base, databaseEngine: 'PostgreSQL', targetClass: null },
          pricing,
          NOW,
        )
      ).status,
    ).toBe('UNAVAILABLE');
    expect(
      (
        await estimateRequestSavings(
          { ...base, databaseEngine: null, targetClass: 'db.m5.xlarge' },
          pricing,
          NOW,
        )
      ).status,
    ).toBe('UNAVAILABLE');
    const inverted = new FakePriceProvider({ 'RDS:db.m5.2xlarge': 0.1, 'RDS:db.m5.xlarge': 0.2 });
    const est = await estimateRequestSavings(
      { ...base, databaseEngine: 'PostgreSQL', targetClass: 'db.m5.xlarge' },
      inverted,
      NOW,
    );
    expect(est.unavailableReason).toMatch(/not cheaper/);
  });

  it('is UNAVAILABLE without a savings request', async () => {
    const est = await estimateRequestSavings(null, pricing, NOW, 'custom reason');
    expect(est).toMatchObject({ status: 'UNAVAILABLE', unavailableReason: 'custom reason' });
  });
});

describe('severity escalation', () => {
  it('maps savings to tiers and never lowers base severity', () => {
    expect(severityForSavings(null)).toBeNull();
    expect(severityForSavings(10)).toBeNull();
    expect(severityForSavings(25)).toBe('MEDIUM');
    expect(severityForSavings(250)).toBe('HIGH');
    expect(severityForSavings(1000)).toBe('CRITICAL');
    expect(escalateSeverity('LOW', 300)).toBe('HIGH');
    expect(escalateSeverity('HIGH', 30)).toBe('HIGH');
    expect(escalateSeverity('MEDIUM', null)).toBe('MEDIUM');
  });

  it('escalates drafts and uses pricing.unsupported evidence as the reason', async () => {
    const priced = await estimateSavings(
      recommendationFor(
        issue({
          baseSeverity: 'LOW',
          savingsRequest: {
            kind: 'EBS_VOLUME_DELETE',
            region: 'us-east-1',
            volumeType: 'gp3',
            sizeGiB: 5000,
          },
        }),
      ),
      new FakePriceProvider(),
      NOW,
    );
    expect(priced.savings.monthly).toBe(400);
    expect(priced.severity).toBe('HIGH');
    const unsupported = await estimateSavings(
      recommendationFor(
        issue({
          savingsRequest: null,
          evidence: [{ key: 'pricing.unsupported', label: 'x', value: 'Platform not supported' }],
        }),
      ),
      new FakePriceProvider(),
      NOW,
    );
    expect(unsupported.savings.unavailableReason).toBe('Platform not supported');
  });
});

describe('runEstimateSavingsStep', () => {
  it('prices drafts, deduplicates identical lookups and writes the artifact', async () => {
    const artifacts = new MemoryArtifacts();
    const drafts = generateRecommendations([
      issue({ resourceId: 'vol-1' }),
      issue({ resourceId: 'vol-2' }),
      issue({ resourceId: 'vol-3', savingsRequest: null }),
    ]);
    await artifacts.putJson(ARTIFACT_KEYS.recommendations(PREFIX), envelope(drafts));
    const pricing = new FakePriceProvider();
    const out = await runEstimateSavingsStep(
      baseState({
        recommendations: { status: 'SUCCEEDED', artifactKey: ARTIFACT_KEYS.recommendations(PREFIX) },
      }),
      { artifacts, pricing, logger: silentLogger, now: () => NOW },
    );
    expect(out.status).toBe('SUCCEEDED');
    expect(out.counts).toMatchObject({
      recommendations: 3,
      priced: 2,
      unavailable: 1,
      priceLookups: 1,
      errors: 0,
    });
    expect(pricing.calls).toHaveLength(1);
    const written = await artifacts.getJson<ArtifactEnvelope<PricedRecommendationDraft[]>>(
      ARTIFACT_KEYS.savings(PREFIX),
    );
    expect(written.data.map((d) => d.savings.monthly)).toEqual([8, 8, null]);
  });

  it('reports PARTIAL when the pricing API fails', async () => {
    const artifacts = new MemoryArtifacts();
    await artifacts.putJson(
      ARTIFACT_KEYS.recommendations(PREFIX),
      envelope(generateRecommendations([issue()])),
    );
    const out = await runEstimateSavingsStep(
      baseState({
        recommendations: { status: 'SUCCEEDED', artifactKey: ARTIFACT_KEYS.recommendations(PREFIX) },
      }),
      {
        artifacts,
        pricing: {
          getPrice: async (query) => ({
            query,
            price: null,
            unavailableReason: 'PRICING_API_ERROR: AccessDeniedException: denied',
          }),
        },
        logger: silentLogger,
        now: () => NOW,
      },
    );
    expect(out.status).toBe('PARTIAL');
    expect(out.counts).toMatchObject({ pricingApiErrors: 1, unavailable: 1 });
  });

  it('records unexpected estimation errors per recommendation', async () => {
    const artifacts = new MemoryArtifacts();
    await artifacts.putJson(
      ARTIFACT_KEYS.recommendations(PREFIX),
      envelope(generateRecommendations([issue()])),
    );
    const out = await runEstimateSavingsStep(
      baseState({
        recommendations: { status: 'SUCCEEDED', artifactKey: ARTIFACT_KEYS.recommendations(PREFIX) },
      }),
      {
        artifacts,
        pricing: {
          getPrice: async () => {
            throw new Error('unexpected');
          },
        },
        logger: silentLogger,
        now: () => NOW,
      },
    );
    expect(out.status).toBe('PARTIAL');
    const written = await artifacts.getJson<ArtifactEnvelope<PricedRecommendationDraft[]>>(
      ARTIFACT_KEYS.savings(PREFIX),
    );
    expect(written.data[0]?.savings.unavailableReason).toBe('ESTIMATION_ERROR: unexpected');
  });
});
