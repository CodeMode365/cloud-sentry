import { beforeAll, describe, expect, it } from 'vitest';
import type { Repositories } from '@cloudsentry/database';
import { AnalyticsService, InventoryService, type ServiceContext } from '@cloudsentry/core';
import type { CloudResource, FindingRecord } from '@cloudsentry/shared-types';
import { encodeCursor, findingIdFor, fixedClock, resourceKeyFor, silentLogger } from '@cloudsentry/utilities';
import { available, freshRepositories } from '../helpers/ddb';
import { NOW, account, seedTenant } from '../helpers/fixtures';

const ACCT = '123456789012';

function resource(tenantId: string, id: string): CloudResource {
  return {
    tenantId,
    accountId: ACCT,
    region: 'us-east-1',
    resourceType: 'ELASTIC_IP',
    resourceId: id,
    resourceKey: resourceKeyFor(ACCT, 'us-east-1', 'ELASTIC_IP', id),
    arn: null,
    name: null,
    state: 'unassociated',
    tags: {},
    createdAt: null,
    attributes: {
      allocationId: id,
      publicIp: null,
      associationId: null,
      instanceId: null,
      networkInterfaceId: null,
      privateIpAddress: null,
      domain: 'vpc',
    },
    utilization: null,
    lifecycleStatus: 'ACTIVE',
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    lastSeenScanId: 'scan_x',
    activeFindingCount: 1,
    updatedAt: NOW,
    version: 1,
  };
}

function finding(tenantId: string, resourceId: string): FindingRecord {
  const findingId = findingIdFor(ACCT, 'us-east-1', 'unassociated-eip', resourceId);
  return {
    findingId,
    tenantId,
    accountId: ACCT,
    region: 'us-east-1',
    resourceType: 'ELASTIC_IP',
    resourceKey: resourceKeyFor(ACCT, 'us-east-1', 'ELASTIC_IP', resourceId),
    resourceId,
    resourceName: null,
    ruleId: 'unassociated-eip',
    ruleName: 'Unassociated Elastic IP',
    ruleVersion: 1,
    category: 'UNUSED',
    title: 'Unassociated Elastic IP',
    description: 'd',
    severity: 'LOW',
    confidence: 'HIGH',
    status: 'OPEN',
    evidence: [],
    thresholds: {},
    estimatedMonthlySavings: 3.65,
    savingsEstimateType: 'POINT',
    currency: 'USD',
    firstDetectedAt: NOW,
    lastDetectedAt: NOW,
    lastEvaluatedAt: NOW,
    occurrenceCount: 1,
    reopenCount: 0,
    resolvedAt: null,
    resolutionReason: null,
    lastScanId: 'scan_x',
    statusNote: null,
    statusUpdatedBy: null,
    statusUpdatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
  };
}

describe.skipIf(!available)('tenant isolation (DynamoDB Local)', () => {
  let repos: Repositories;
  let ctx: ServiceContext;
  const A = { tenantId: 'ten_A' };
  const B = { tenantId: 'ten_B' };
  let authA: Awaited<ReturnType<typeof seedTenant>>['auth'];
  let authB: Awaited<ReturnType<typeof seedTenant>>['auth'];

  beforeAll(async () => {
    repos = await freshRepositories('isolation');
    ctx = { repos, logger: silentLogger, clock: fixedClock(NOW) };
    authA = (await seedTenant(repos, A.tenantId, 'userA')).auth;
    authB = (await seedTenant(repos, B.tenantId, 'userB')).auth;
    // Both tenants connect the SAME AWS account ID; data must stay separate.
    await repos.accounts.create(account(A.tenantId, ACCT));
    await repos.accounts.create(account(B.tenantId, ACCT, { alias: 'b-view' }));
    await repos.resources.putMany([
      resource(A.tenantId, 'eipalloc-a1'),
      resource(A.tenantId, 'eipalloc-a2'),
      resource(B.tenantId, 'eipalloc-b1'),
    ]);
    await repos.findings.putVersioned(finding(A.tenantId, 'eipalloc-a1'), null);
    await repos.findings.putVersioned(finding(B.tenantId, 'eipalloc-b1'), null);
  });

  it('keeps accounts with the same AWS account ID separate per tenant', async () => {
    expect((await repos.accounts.get(A.tenantId, ACCT))?.alias).toBe(`acct-${ACCT}`);
    expect((await repos.accounts.get(B.tenantId, ACCT))?.alias).toBe('b-view');
  });

  it('never returns another tenant’s resources or findings', async () => {
    const inv = new InventoryService(ctx);
    const resourcesA = await inv.listResources(authA, { limit: 25, order: 'desc' });
    expect(resourcesA.items.map((r) => r.resourceId).sort()).toEqual(['eipalloc-a1', 'eipalloc-a2']);
    const findingsB = await inv.listFindings(authB, { limit: 25 });
    expect(findingsB.items.map((f) => f.tenantId)).toEqual(['ten_B']);
  });

  it('returns NOT_FOUND for another tenant’s record IDs (no existence leak)', async () => {
    const inv = new InventoryService(ctx);
    const foreign = finding(A.tenantId, 'eipalloc-a1');
    await expect(inv.getFinding(authB, foreign.findingId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(inv.updateFinding(authB, foreign.findingId, { status: 'SUPPRESSED' })).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
    await expect(
      inv.getResource(authB, resourceKeyFor(ACCT, 'us-east-1', 'ELASTIC_IP', 'eipalloc-a1')),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects forged pagination cursors that point into another tenant', async () => {
    const inv = new InventoryService(ctx);
    const forged = encodeCursor({ PK: 'TENANT#ten_A#FINDINGS', SK: 'FINDING#fnd_0' }) as string;
    await expect(inv.listFindings(authB, { limit: 1, cursor: forged })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    const forgedResource = encodeCursor({ PK: 'TENANT#ten_A#RESOURCES', SK: 'RES#' }) as string;
    await expect(
      inv.listResources(authB, { limit: 1, order: 'desc', cursor: forgedResource }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('paginates a tenant’s own data with exact cursors', async () => {
    const inv = new InventoryService(ctx);
    const page1 = await inv.listResources(authA, { limit: 1, order: 'desc' });
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await inv.listResources(authA, {
      limit: 1,
      order: 'desc',
      cursor: page1.nextCursor as string,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]?.resourceId).not.toBe(page1.items[0]?.resourceId);
  });

  it('scopes analytics to the caller tenant', async () => {
    const analytics = new AnalyticsService(ctx);
    const a = await analytics.overview(authA);
    const b = await analytics.overview(authB);
    expect(a.resources.total).toBe(2);
    expect(b.resources.total).toBe(1);
    expect(b.findings.active).toBe(1);
  });
});
