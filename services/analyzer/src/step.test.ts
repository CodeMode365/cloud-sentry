import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_KEYS,
  type ArtifactEnvelope,
  type DetectionResult,
  type ScanWorkflowState,
} from '@cloudsentry/shared-types';
import type { ArtifactStore } from '@cloudsentry/aws-clients';
import { silentLogger } from '@cloudsentry/utilities';
import { FIXTURE_NOW, elasticIp } from './__fixtures__/resources';
import { runDetectionStep } from './step';

class MemoryArtifacts implements ArtifactStore {
  objects = new Map<string, unknown>();
  async putJson(key: string, value: unknown) {
    this.objects.set(key, JSON.parse(JSON.stringify(value)));
  }
  async getJson<T>(key: string): Promise<T> {
    if (!this.objects.has(key)) throw new Error(`missing ${key}`);
    return this.objects.get(key) as T;
  }
  async putObject() {
    return { sizeBytes: 0 };
  }
  async exists(key: string) {
    return this.objects.has(key);
  }
  async getDownloadUrl() {
    return '';
  }
}

const prefix = 'scans/t1/111122223333/scan_1/';
const state: ScanWorkflowState = {
  tenantId: 't1',
  accountId: '111122223333',
  scanId: 'scan_1',
  trigger: 'MANUAL',
  validation: { regions: ['us-east-1'], lookbackDays: 30, artifactsPrefix: prefix },
  normalized: { status: 'SUCCEEDED', artifactKey: ARTIFACT_KEYS.normalized(prefix) },
};

function envelope(data: unknown, overrides: Partial<ArtifactEnvelope<unknown>> = {}) {
  return {
    schemaVersion: 1,
    tenantId: 't1',
    accountId: '111122223333',
    scanId: 'scan_1',
    createdAt: FIXTURE_NOW.toISOString(),
    data,
    ...overrides,
  };
}

describe('runDetectionStep', () => {
  it('reads normalized resources and writes the detection artifact', async () => {
    const artifacts = new MemoryArtifacts();
    await artifacts.putJson(ARTIFACT_KEYS.normalized(prefix), envelope([elasticIp()]));
    const out = await runDetectionStep(state, {
      artifacts,
      loadDetectionSettings: async () => null,
      logger: silentLogger,
      now: () => FIXTURE_NOW,
    });
    expect(out).toMatchObject({
      status: 'SUCCEEDED',
      artifactKey: ARTIFACT_KEYS.detection(prefix),
      counts: { issues: 1, evaluated: 1, notEvaluated: 0 },
    });
    const written = await artifacts.getJson<ArtifactEnvelope<DetectionResult>>(
      ARTIFACT_KEYS.detection(prefix),
    );
    expect(written.tenantId).toBe('t1');
    expect(written.data.issues[0]?.ruleId).toBe('unassociated-eip');
  });

  it('refuses artifacts that belong to another tenant', async () => {
    const artifacts = new MemoryArtifacts();
    await artifacts.putJson(ARTIFACT_KEYS.normalized(prefix), envelope([], { tenantId: 'other' }));
    await expect(
      runDetectionStep(state, {
        artifacts,
        loadDetectionSettings: async () => null,
        logger: silentLogger,
        now: () => FIXTURE_NOW,
      }),
    ).rejects.toThrow(/does not belong/);
  });

  it('fails clearly when normalized data is missing', async () => {
    await expect(
      runDetectionStep(
        { ...state, normalized: { status: 'FAILED', artifactKey: null } },
        {
          artifacts: new MemoryArtifacts(),
          loadDetectionSettings: async () => null,
          logger: silentLogger,
          now: () => FIXTURE_NOW,
        },
      ),
    ).rejects.toThrow(/unavailable/);
  });
});
