import { describe, expect, it } from 'vitest';
import { recommendationIdFor } from '@cloudsentry/utilities';
import {
  ARTIFACT_KEYS,
  type ArtifactEnvelope,
  type DetectionResult,
  type RecommendationDraft,
} from '@cloudsentry/shared-types';
import { silentLogger } from '@cloudsentry/utilities';
import { baseState, envelope, issue, MemoryArtifacts, NOW, PREFIX } from './__fixtures__/issues';
import { generateRecommendations } from './generate';
import { runGenerateRecommendationsStep } from './step-generate';

describe('generateRecommendations', () => {
  it('creates one deterministic recommendation per finding', () => {
    const a = issue();
    const drafts = generateRecommendations([a, a, issue({ resourceId: 'vol-2' })]);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]?.recommendationId).toBe(recommendationIdFor(a.findingId));
    expect(drafts[0]?.title).toBe('Delete unattached EBS volume vol-0abc');
    expect(drafts[0]?.description).toContain('read-only');
    expect(drafts[0]?.suggestedAction).toEqual(a.suggestedAction);
    expect([drafts[0]?.confidence, drafts[0]?.riskLevel]).toEqual(['HIGH', 'MEDIUM']);
  });

  it('prefers the resource name in titles', () => {
    const [d] = generateRecommendations([
      issue({
        resourceName: 'build-runner',
        suggestedAction: { type: 'STOP_INSTANCE', summary: 's', steps: [] },
      }),
    ]);
    expect(d?.title).toBe('Stop idle EC2 instance build-runner');
  });
});

describe('runGenerateRecommendationsStep', () => {
  it('reads detection results and writes drafts', async () => {
    const artifacts = new MemoryArtifacts();
    const detection: DetectionResult = { issues: [issue()], evaluations: [], rulesExecuted: [] };
    await artifacts.putJson(ARTIFACT_KEYS.detection(PREFIX), envelope(detection));
    const out = await runGenerateRecommendationsStep(
      baseState({ detection: { status: 'SUCCEEDED', artifactKey: ARTIFACT_KEYS.detection(PREFIX) } }),
      { artifacts, logger: silentLogger, now: () => NOW },
    );
    expect(out).toEqual({
      status: 'SUCCEEDED',
      artifactKey: ARTIFACT_KEYS.recommendations(PREFIX),
      counts: { issues: 1, recommendations: 1 },
    });
    const written = await artifacts.getJson<ArtifactEnvelope<RecommendationDraft[]>>(
      ARTIFACT_KEYS.recommendations(PREFIX),
    );
    expect(written.data).toHaveLength(1);
  });

  it('rejects artifacts from another scan', async () => {
    const artifacts = new MemoryArtifacts();
    await artifacts.putJson(
      ARTIFACT_KEYS.detection(PREFIX),
      envelope({ issues: [], evaluations: [], rulesExecuted: [] }, { scanId: 'scan_other' }),
    );
    await expect(
      runGenerateRecommendationsStep(
        baseState({ detection: { status: 'SUCCEEDED', artifactKey: ARTIFACT_KEYS.detection(PREFIX) } }),
        { artifacts, logger: silentLogger, now: () => NOW },
      ),
    ).rejects.toThrow(/does not belong/);
  });
});
