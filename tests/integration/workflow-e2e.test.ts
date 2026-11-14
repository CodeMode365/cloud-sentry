import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CustomerAwsClients, FileSystemArtifactStore } from '@cloudsentry/aws-clients';
import { InProcessScanStarter } from '@cloudsentry/api';
import { ScanService, type ScanWorkflowStarter } from '@cloudsentry/core';
import type { Repositories } from '@cloudsentry/database';
import { createWorkerRuntime, type WorkerRuntime } from '@cloudsentry/scanner';
import { silentLogger } from '@cloudsentry/utilities';
import { available, freshRepositories } from '../helpers/ddb';
import { account, seedTenant } from '../helpers/fixtures';
import { ce, customerDynamoDb, installBaselineMocks, pricing, sts } from '../helpers/aws-mocks';

/** Routes the customer-side DynamoDB client to a mocked instance (DynamoDB Local serves the platform table). */
class TestCustomerClients extends CustomerAwsClients {
  override dynamodb() {
    return customerDynamoDb;
  }
}

const ACCT = '555555555555';
const TENANT = 'ten_E2E';

describe.skipIf(!available)('scan workflow end-to-end (mocked AWS APIs, DynamoDB Local)', () => {
  let repos: Repositories;
  let rt: WorkerRuntime;
  let runner: InProcessScanStarter;
  let scans: ScanService;

  const noStart: ScanWorkflowStarter = {
    start: async (i) => ({ executionArn: `test:${i.scanId}` }),
    stop: async () => undefined,
  };

  async function runScan() {
    const { scan } = await scans.startScan({
      tenantId: TENANT,
      accountId: ACCT,
      trigger: 'MANUAL',
      triggeredBy: 'owner',
    });
    await runner.execute({ tenantId: TENANT, accountId: ACCT, scanId: scan.scanId, trigger: 'MANUAL' });
    return (await repos.scans.get(TENANT, scan.scanId))!;
  }

  beforeAll(async () => {
    repos = await freshRepositories('e2e');
    await seedTenant(repos, TENANT, 'owner');
    await repos.accounts.create(account(TENANT, ACCT));
    const artifacts = new FileSystemArtifactStore(
      mkdtempSync(join(tmpdir(), 'cs-e2e-')),
      'test-secret',
      'http://localhost',
    );
    rt = createWorkerRuntime(
      {
        TABLE_NAME: repos.table.tableName,
        STAGE: 'local',
        METRICS_REUSE_HOURS: '0',
        COST_REFRESH_HOURS: '0',
      },
      {
        repos,
        artifacts,
        logger: silentLogger,
        clientsFor: (a, scanId) =>
          new TestCustomerClients(
            { accountId: a.accountId, roleArn: a.roleArn, externalId: a.externalId, sessionLabel: scanId },
            { credentials: async () => ({ accessKeyId: 'test', secretAccessKey: 'test' }) },
          ),
      },
    );
    runner = new InProcessScanStarter(() => rt);
    scans = new ScanService(rt.ctx, noStart);
  });

  it('discovers, detects, prices and persists findings on the first scan', async () => {
    installBaselineMocks(ACCT);
    const scan = await runScan();
    expect(scan.status).toBe('COMPLETED');
    expect(scan.summary).toMatchObject({ resourcesDiscovered: 3, newFindings: 3, costDataAvailable: true });
    expect(sts.calls().length).toBeGreaterThan(0);

    const findings = await repos.findings.listAll(TENANT, { accountId: ACCT });
    expect(findings.map((f) => f.ruleId).sort()).toEqual(['idle-ec2', 'unassociated-eip', 'unattached-ebs']);
    const recs = await repos.recommendations.listAll(TENANT, { accountId: ACCT });
    const byRule = Object.fromEntries(recs.map((r) => [r.ruleId, r]));
    expect(byRule['unassociated-eip']?.estimatedMonthlySavings).toBe(3.65);
    expect(byRule['unattached-ebs']?.estimatedMonthlySavings).toBe(8);
    expect(byRule['idle-ec2']?.estimatedMonthlySavings).toBeCloseTo(70.08, 2);
    expect(byRule['idle-ec2']?.savings.pricingSources[0]?.sku).toBe('SKU-BoxUsage:m5.large');
    expect(pricing.calls().length).toBeGreaterThan(0);

    const resources = await repos.resources.listByAccount(TENANT, ACCT);
    const ec2 = resources.find((r) => r.resourceId === 'i-0idle');
    expect(ec2?.utilization?.metrics['CPUUtilization:Average']?.availability).toBe('AVAILABLE');
    expect(ec2?.activeFindingCount).toBe(1);
    const cost = await repos.costs.get(TENANT, ACCT);
    expect(cost).toMatchObject({ source: 'AWS_COST_EXPLORER', availability: 'AVAILABLE' });
    expect(ce.calls().length).toBeGreaterThan(0);
  });

  it('does not duplicate findings on an unchanged re-scan', async () => {
    installBaselineMocks(ACCT);
    const scan = await runScan();
    expect(scan.status).toBe('COMPLETED');
    expect(scan.summary?.newFindings).toBe(0);
    const findings = await repos.findings.listAll(TENANT, { accountId: ACCT });
    expect(findings).toHaveLength(3);
    expect(findings.every((f) => f.occurrenceCount === 2)).toBe(true);
  });

  it('resolves fixed issues, and leaves issues in failed discovery scopes untouched (partial scan)', async () => {
    installBaselineMocks(ACCT, { volumeAttached: true, eipRegionFails: true });
    const scan = await runScan();
    expect(scan.status).toBe('PARTIALLY_COMPLETED');
    expect(scan.errors.some((e) => e.resourceType === 'ELASTIC_IP' && e.region === 'us-east-1')).toBe(true);

    const findings = Object.fromEntries(
      (await repos.findings.listAll(TENANT, { accountId: ACCT })).map((f) => [f.ruleId, f]),
    );
    expect(findings['unattached-ebs']).toMatchObject({
      status: 'RESOLVED',
      resolutionReason: 'NOT_DETECTED',
    });
    // EIP discovery failed: the finding must stay OPEN and the address must not be marked missing.
    expect(findings['unassociated-eip']?.status).toBe('OPEN');
    const eip = (await repos.resources.listByAccount(TENANT, ACCT)).find(
      (r) => r.resourceId === 'eipalloc-0free',
    );
    expect(eip?.lifecycleStatus).toBe('ACTIVE');
    const recs = Object.fromEntries(
      (await repos.recommendations.listAll(TENANT, { accountId: ACCT })).map((r) => [r.ruleId, r]),
    );
    expect(recs['unattached-ebs']?.status).toBe('RESOLVED');
  });

  it('fails the scan cleanly and releases the lock when the role cannot be assumed', async () => {
    installBaselineMocks(ACCT);
    sts.reset();
    sts.rejects(Object.assign(new Error('not authorized'), { name: 'AccessDenied' }));
    const scan = await runScan();
    expect(scan.status).toBe('FAILED');
    expect(scan.errors.at(-1)?.message).toMatch(/ASSUME_ROLE_DENIED/);
    expect(await repos.scans.getLock(TENANT, ACCT, new Date())).toBeNull();
    expect((await repos.accounts.get(TENANT, ACCT))?.status).toBe('ERROR');
  });
});
