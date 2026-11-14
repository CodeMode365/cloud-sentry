import { describe, expect, it } from 'vitest';
import type { DetectedIssue, DetectionResult, SavingsRequest } from '@cloudsentry/shared-types';
import { applySupersession } from './engine';

function issue(
  ruleId: string,
  resourceKey: string,
  savingsRequest: SavingsRequest | null = null,
): DetectedIssue {
  return {
    findingId: `fnd_${ruleId}_${resourceKey}`,
    ruleId,
    ruleName: ruleId,
    ruleVersion: 1,
    category: 'IDLE',
    resourceType: 'ELASTICACHE_CLUSTER',
    resourceKey,
    accountId: '111122223333',
    region: 'us-east-1',
    resourceId: resourceKey,
    resourceName: null,
    title: ruleId,
    description: '',
    baseSeverity: 'MEDIUM',
    confidence: 'MEDIUM',
    riskLevel: 'MEDIUM',
    evidence: [],
    thresholds: {},
    suggestedAction: { type: 'DELETE_CACHE_CLUSTER', summary: '', steps: [] },
    savingsRequest,
  };
}

function result(issues: DetectedIssue[]): DetectionResult {
  return {
    issues,
    evaluations: issues.map((i) => ({
      ruleId: i.ruleId,
      resourceKey: i.resourceKey,
      resourceType: i.resourceType,
      accountId: i.accountId,
      region: i.region,
      resourceId: i.resourceId,
      outcome: 'DETECTED' as const,
    })),
    rulesExecuted: [],
  };
}

describe('applySupersession', () => {
  it('drops the weaker finding on the same resource and marks it NOT_DETECTED (so it resolves)', () => {
    const out = applySupersession(
      result([
        issue('idle-elasticache', 'r1'),
        issue('underutilized-elasticache', 'r1'),
        issue('underutilized-elasticache', 'r2'),
      ]),
    );
    expect(out.issues.map((i) => `${i.ruleId}|${i.resourceKey}`).sort()).toEqual([
      'idle-elasticache|r1',
      'underutilized-elasticache|r2',
    ]);
    const weaker = out.evaluations.find(
      (e) => e.ruleId === 'underutilized-elasticache' && e.resourceKey === 'r1',
    );
    expect(weaker).toMatchObject({ outcome: 'NOT_DETECTED', reason: 'SUPERSEDED_BY:idle-elasticache' });
  });

  it('covers DynamoDB, EFS, EKS and Redshift overlaps', () => {
    const out = applySupersession(
      result([
        issue('unused-dynamodb-table', 't'),
        issue('dynamodb-capacity-mode', 't'),
        issue('dynamodb-overprovisioned-capacity', 't'),
        issue('unused-efs', 'f'),
        issue('efs-missing-lifecycle', 'f'),
        issue('idle-redshift-cluster', 'c'),
        issue('redshift-pause-schedule', 'c'),
      ]),
    );
    expect(out.issues.map((i) => i.ruleId).sort()).toEqual([
      'idle-redshift-cluster',
      'unused-dynamodb-table',
      'unused-efs',
    ]);
  });

  it('prices arm64 migration at the rightsized memory when both Lambda rules fire', () => {
    const memory = issue('lambda-overprovisioned-memory', 'fn', {
      kind: 'LAMBDA_MEMORY_RIGHTSIZE',
      region: 'us-east-1',
      architecture: 'x86_64',
      currentMemoryMb: 2048,
      recommendedMemoryMb: 512,
      monthlyDurationSeconds: 1_000_000,
    });
    const arm = issue('lambda-arm64-migration', 'fn', {
      kind: 'LAMBDA_ARM64_MIGRATION',
      region: 'us-east-1',
      memoryMb: 2048,
      monthlyDurationSeconds: 1_000_000,
    });
    const out = applySupersession(result([memory, arm]));
    const priced = out.issues.find((i) => i.ruleId === 'lambda-arm64-migration');
    expect(priced?.savingsRequest).toMatchObject({ kind: 'LAMBDA_ARM64_MIGRATION', memoryMb: 512 });
    expect(priced?.evidence.at(-1)?.key).toBe('pricing.memoryAfterRightsizing');
    // Alone, the arm64 request keeps the configured memory.
    expect(applySupersession(result([arm])).issues[0]?.savingsRequest).toMatchObject({ memoryMb: 2048 });
  });
});
