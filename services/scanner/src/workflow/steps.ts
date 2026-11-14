import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { DescribeRegionsCommand } from '@aws-sdk/client-ec2';
import { classifyAssumeRoleError } from '@cloudsentry/aws-clients';
import { persistScanResults, runTrackedStep } from '@cloudsentry/core';
import {
  ARTIFACT_KEYS,
  DEFAULT_LOOKBACK_DAYS,
  type ArtifactEnvelope,
  type AssumeRoleOutput,
  type CloudAccount,
  type CostSnapshot,
  type DetectionResult,
  type DiscoveredResource,
  type DiscoveryWorkerInput,
  type DiscoveryWorkerOutput,
  type NormalizedResource,
  type PersistOutcome,
  type PricedRecommendationDraft,
  type ResolveRegionsOutput,
  type ResourceType,
  type ResourceUtilization,
  type ScanError,
  type ScanSummary,
  type ScanWorkflowState,
  type StepArtifactOutput,
  type ValidateAccountOutput,
} from '@cloudsentry/shared-types';
import {
  AppError,
  NotFoundError,
  PreconditionFailedError,
  awsErrorName,
  emitMetric,
  errorMessage,
} from '@cloudsentry/utilities';
import { runRegionalDiscovery } from '../discovery';
import { collectUtilization, partitionForReuse } from '../metrics';
import { fetchCostSnapshot } from '../costs';
import { normalizeResources } from '../normalize';
import type { WorkerRuntime } from './runtime';

function envelope<T>(state: ScanWorkflowState, data: T, now: Date): ArtifactEnvelope<T> {
  return {
    schemaVersion: 1,
    tenantId: state.tenantId,
    accountId: state.accountId,
    scanId: state.scanId,
    createdAt: now.toISOString(),
    data,
  };
}

function prefixOf(state: ScanWorkflowState): string {
  if (!state.validation?.artifactsPrefix)
    throw new AppError('INTERNAL_ERROR', 'Workflow state is missing validation output', 500);
  return state.validation.artifactsPrefix;
}

async function loadAccount(rt: WorkerRuntime, state: ScanWorkflowState): Promise<CloudAccount> {
  const account = await rt.repos.accounts.get(state.tenantId, state.accountId);
  if (!account) throw new NotFoundError('Account', state.accountId);
  return account;
}

async function readArtifact<T>(rt: WorkerRuntime, key: string | null | undefined): Promise<T | null> {
  if (!key) return null;
  const env = await rt.artifacts.getJson<ArtifactEnvelope<T>>(key);
  return env.data;
}

// ---------------------------------------------------------------- ValidateAccount
export async function validateAccount(
  rt: WorkerRuntime,
  state: ScanWorkflowState,
): Promise<ValidateAccountOutput> {
  const scan = await rt.lifecycle.markRunning(state.tenantId, state.scanId);
  const startedAt = rt.clock.now().toISOString();
  const account = await loadAccount(rt, state);
  if (account.dataSource !== 'AWS')
    throw new PreconditionFailedError('Only AWS-connected accounts can be scanned');
  if (account.status !== 'CONNECTED') {
    await rt.lifecycle.step(
      state.tenantId,
      state.scanId,
      'ValidateAccount',
      'FAILED',
      'Account is not connected',
      startedAt,
    );
    throw new PreconditionFailedError('Account connection is not verified');
  }
  const settings = await rt.repos.settings.getDetectionSettings(state.tenantId);
  await rt.lifecycle.step(state.tenantId, state.scanId, 'ValidateAccount', 'SUCCEEDED', null, startedAt);
  return {
    regions: scan.regions,
    lookbackDays: settings?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS,
    artifactsPrefix: scan.artifactsPrefix,
  };
}

// ---------------------------------------------------------------- AssumeCustomerRole
export async function assumeCustomerRole(
  rt: WorkerRuntime,
  state: ScanWorkflowState,
): Promise<AssumeRoleOutput> {
  await rt.lifecycle.assertActive(state.tenantId, state.scanId);
  const startedAt = rt.clock.now().toISOString();
  const account = await loadAccount(rt, state);
  const clients = rt.clientsFor(account, state.scanId);
  let callerAccountId: string;
  try {
    const identity = await clients
      .sts(state.validation?.regions[0] ?? 'us-east-1')
      .send(new GetCallerIdentityCommand({}));
    callerAccountId = identity.Account ?? '';
  } catch (error) {
    const classified = classifyAssumeRoleError(error);
    await rt.lifecycle.step(
      state.tenantId,
      state.scanId,
      'AssumeCustomerRole',
      'FAILED',
      classified.message,
      startedAt,
    );
    await rt.repos.accounts.update(state.tenantId, state.accountId, { status: 'ERROR' });
    throw new AppError('UPSTREAM_ERROR', `${classified.code}: ${classified.message}`, 502);
  }
  if (callerAccountId !== state.accountId) {
    const msg = `Role resolved to account ${callerAccountId}, expected ${state.accountId}`;
    await rt.lifecycle.step(state.tenantId, state.scanId, 'AssumeCustomerRole', 'FAILED', msg, startedAt);
    throw new AppError('PRECONDITION_FAILED', `ACCOUNT_MISMATCH: ${msg}`, 412);
  }
  await rt.lifecycle.step(state.tenantId, state.scanId, 'AssumeCustomerRole', 'SUCCEEDED', null, startedAt);
  return { verified: true, callerAccountId, regions: state.validation?.regions ?? [] };
}

// ---------------------------------------------------------------- DiscoverResources (region resolution)
export async function resolveRegions(
  rt: WorkerRuntime,
  state: ScanWorkflowState,
): Promise<ResolveRegionsOutput> {
  await rt.lifecycle.assertActive(state.tenantId, state.scanId);
  await rt.lifecycle.step(state.tenantId, state.scanId, 'DiscoverResources', 'RUNNING');
  const account = await loadAccount(rt, state);
  const configured = state.role?.regions ?? state.validation?.regions ?? [];
  const clients = rt.clientsFor(account, state.scanId);
  try {
    const out = await clients
      .ec2(configured[0] ?? 'us-east-1')
      .send(new DescribeRegionsCommand({ AllRegions: false }));
    const enabled = new Set((out.Regions ?? []).map((r) => r.RegionName));
    return {
      regions: configured.filter((r) => enabled.has(r)),
      skippedRegions: configured
        .filter((r) => !enabled.has(r))
        .map((region) => ({ region, reason: 'REGION_NOT_ENABLED' })),
    };
  } catch (error) {
    rt.logger.warn('DescribeRegions failed; scanning configured regions as-is', {
      awsError: awsErrorName(error),
    });
    return { regions: configured, skippedRegions: [] };
  }
}

// ---------------------------------------------------------------- Discovery workers
export async function discoverType(
  rt: WorkerRuntime,
  resourceType: ResourceType,
  input: ScanWorkflowState | DiscoveryWorkerInput,
): Promise<DiscoveryWorkerOutput> {
  const started = Date.now();
  // The state machine passes a DiscoveryWorkerInput; the local runner passes the full state.
  const state: ScanWorkflowState =
    'artifactsPrefix' in input
      ? {
          tenantId: input.tenantId,
          accountId: input.accountId,
          scanId: input.scanId,
          trigger: input.trigger,
          validation: {
            regions: input.regions,
            lookbackDays: DEFAULT_LOOKBACK_DAYS,
            artifactsPrefix: input.artifactsPrefix,
          },
          regionsResolved: { regions: input.regions, skippedRegions: [] },
        }
      : input;
  await rt.lifecycle.assertActive(state.tenantId, state.scanId);
  const account = await loadAccount(rt, state);
  const regions = state.regionsResolved?.regions ?? state.validation?.regions ?? [];
  const clients = rt.clientsFor(account, state.scanId);
  const logger = rt.logger.child({ resourceType });
  const result = await runRegionalDiscovery(resourceType, regions, clients, {
    accountId: state.accountId,
    logger,
  });
  const key = ARTIFACT_KEYS.discovery(prefixOf(state), resourceType);
  await rt.artifacts.putJson(key, envelope(state, result.resources, rt.clock.now()));
  if (result.regionsFailed.length)
    emitMetric('DiscoveryFailures', result.regionsFailed.length, 'Count', { ResourceType: resourceType });
  return {
    resourceType,
    status:
      result.regionsFailed.length === 0 ? 'SUCCEEDED' : result.regionsSucceeded.length ? 'PARTIAL' : 'FAILED',
    resourceCount: result.resources.length,
    regionsSucceeded: result.regionsSucceeded,
    regionsFailed: result.regionsFailed,
    artifactKey: key,
    durationMs: Date.now() - started,
  };
}

async function loadDiscovered(rt: WorkerRuntime, state: ScanWorkflowState): Promise<DiscoveredResource[]> {
  const all: DiscoveredResource[] = [];
  for (const d of state.discovery ?? []) {
    if (!d.artifactKey) continue;
    all.push(...((await readArtifact<DiscoveredResource[]>(rt, d.artifactKey)) ?? []));
  }
  return all;
}

/** Records the Parallel discovery outcome on the scan (runs at the start of the metrics step). */
async function recordDiscovery(rt: WorkerRuntime, state: ScanWorkflowState): Promise<void> {
  const discovery = state.discovery ?? [];
  await rt.repos.scans.setDiscovery(state.tenantId, state.scanId, discovery);
  const now = rt.clock.now().toISOString();
  const errors: ScanError[] = [];
  for (const d of discovery) {
    for (const f of d.regionsFailed) {
      errors.push({
        step: 'DiscoverResources',
        code: f.errorCode,
        message: f.message,
        at: now,
        resourceType: d.resourceType,
        region: f.region,
      });
    }
    if (d.status === 'FAILED' && d.regionsFailed.length === 0) {
      errors.push({
        step: 'DiscoverResources',
        code: 'WORKER_FAILED',
        message: d.errorMessage ?? 'Discovery worker failed',
        at: now,
        resourceType: d.resourceType,
      });
    }
  }
  for (const s of state.regionsResolved?.skippedRegions ?? []) {
    errors.push({
      step: 'DiscoverResources',
      code: s.reason,
      message: `Region ${s.region} skipped`,
      at: now,
      region: s.region,
    });
  }
  await rt.lifecycle.recordErrors(state.tenantId, state.scanId, errors);
  const statuses = discovery.map((d) => d.status);
  const status = statuses.every((s) => s === 'SUCCEEDED')
    ? 'SUCCEEDED'
    : statuses.every((s) => s === 'FAILED')
      ? 'FAILED'
      : 'PARTIAL';
  await rt.lifecycle.step(
    state.tenantId,
    state.scanId,
    'DiscoverResources',
    status,
    `${discovery.reduce((s, d) => s + d.resourceCount, 0)} resources`,
  );
}

// ---------------------------------------------------------------- CollectCloudWatchMetrics
export async function collectMetrics(
  rt: WorkerRuntime,
  state: ScanWorkflowState,
): Promise<StepArtifactOutput> {
  await recordDiscovery(rt, state);
  return runTrackedStep(rt.lifecycle, state, 'CollectCloudWatchMetrics', async () => {
    const account = await loadAccount(rt, state);
    const discovered = await loadDiscovered(rt, state);
    const lookbackDays = state.validation?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const now = rt.clock.now();
    const previous = new Map<string, ResourceUtilization | null>(
      (await rt.repos.resources.listByAccount(state.tenantId, state.accountId)).map((r) => [
        r.resourceKey,
        r.utilization,
      ]),
    );
    const { reuse, collect } = partitionForReuse(discovered, previous, {
      reuseHours: rt.config.METRICS_REUSE_HOURS,
      lookbackDays,
      now,
    });
    const clients = rt.clientsFor(account, state.scanId);
    const collected = collect.length
      ? await collectUtilization(collect, clients, { lookbackDays, now, logger: rt.logger })
      : { utilization: new Map<string, ResourceUtilization>(), regionErrors: [], apiCalls: 0 };
    const merged: Record<string, ResourceUtilization> = Object.fromEntries([
      ...reuse,
      ...collected.utilization,
    ]);
    const key = ARTIFACT_KEYS.metrics(prefixOf(state));
    await rt.artifacts.putJson(
      key,
      envelope(state, { utilization: merged, regionErrors: collected.regionErrors }, now),
    );
    if (collected.regionErrors.length) {
      await rt.lifecycle.recordErrors(
        state.tenantId,
        state.scanId,
        collected.regionErrors.map((e) => ({
          step: 'CollectCloudWatchMetrics',
          code: e.errorCode,
          message: e.message,
          at: now.toISOString(),
          region: e.region,
        })),
      );
    }
    return {
      status: collected.regionErrors.length ? 'PARTIAL' : 'SUCCEEDED',
      artifactKey: key,
      message: `${collected.utilization.size} collected, ${reuse.size} reused, ${collected.apiCalls} GetMetricData calls`,
      counts: { collected: collected.utilization.size, reused: reuse.size, apiCalls: collected.apiCalls },
    };
  });
}

// ---------------------------------------------------------------- AnalyzeAWSCosts
export async function analyzeCosts(rt: WorkerRuntime, state: ScanWorkflowState): Promise<StepArtifactOutput> {
  return runTrackedStep(rt.lifecycle, state, 'AnalyzeAWSCosts', async () => {
    const now = rt.clock.now();
    const existing = await rt.repos.costs.get(state.tenantId, state.accountId);
    const ageHours = existing
      ? (now.getTime() - new Date(existing.retrievedAt).getTime()) / 3_600_000
      : Infinity;
    const key = ARTIFACT_KEYS.costs(prefixOf(state));
    if (existing && existing.availability !== 'UNAVAILABLE' && ageHours < rt.config.COST_REFRESH_HOURS) {
      await rt.artifacts.putJson(key, envelope(state, existing, now));
      return {
        status: 'SUCCEEDED',
        artifactKey: key,
        message: `Reused Cost Explorer data from ${existing.retrievedAt}`,
      };
    }
    const account = await loadAccount(rt, state);
    const data = await fetchCostSnapshot(rt.clientsFor(account, state.scanId).costExplorer(), {
      now,
      months: 6,
      includeResourceLevel: false,
      logger: rt.logger,
    });
    const snapshot: CostSnapshot = {
      ...data,
      tenantId: state.tenantId,
      accountId: state.accountId,
      scanId: state.scanId,
    };
    await rt.repos.costs.put(snapshot);
    await rt.artifacts.putJson(key, envelope(state, snapshot, now));
    if (snapshot.availability !== 'AVAILABLE') {
      emitMetric('CostAnalysisFailures', 1);
      await rt.lifecycle.recordErrors(
        state.tenantId,
        state.scanId,
        snapshot.errors.map((e) => ({
          step: 'AnalyzeAWSCosts',
          code: e.code,
          message: `${e.query}: ${e.message}`,
          at: now.toISOString(),
        })),
      );
    }
    const out: StepArtifactOutput = {
      status:
        snapshot.availability === 'AVAILABLE'
          ? 'SUCCEEDED'
          : snapshot.availability === 'PARTIAL'
            ? 'PARTIAL'
            : 'FAILED',
      artifactKey: key,
    };
    if (snapshot.unavailableReason) out.message = snapshot.unavailableReason;
    return out;
  });
}

// ---------------------------------------------------------------- NormalizeResourceData
export async function normalize(rt: WorkerRuntime, state: ScanWorkflowState): Promise<StepArtifactOutput> {
  return runTrackedStep(rt.lifecycle, state, 'NormalizeResourceData', async () => {
    const discovered = await loadDiscovered(rt, state);
    let utilization = new Map<string, ResourceUtilization>();
    if (state.metrics?.artifactKey) {
      try {
        const m = await readArtifact<{ utilization: Record<string, ResourceUtilization> }>(
          rt,
          state.metrics.artifactKey,
        );
        utilization = new Map(Object.entries(m?.utilization ?? {}));
      } catch (error) {
        rt.logger.warn('Metrics artifact unavailable; continuing without utilization', { error });
      }
    }
    const succeededRegionsByType: Partial<Record<ResourceType, string[]>> = {};
    for (const d of state.discovery ?? []) succeededRegionsByType[d.resourceType] = d.regionsSucceeded;
    const normalized = normalizeResources(discovered, utilization, { succeededRegionsByType });
    const key = ARTIFACT_KEYS.normalized(prefixOf(state));
    await rt.artifacts.putJson(key, envelope(state, normalized, rt.clock.now()));
    return {
      status: 'SUCCEEDED',
      artifactKey: key,
      counts: {
        resources: normalized.length,
        withUtilization: normalized.filter((r) => r.utilization).length,
      },
    };
  });
}

// ---------------------------------------------------------------- PersistResults
export async function persistResults(
  rt: WorkerRuntime,
  state: ScanWorkflowState,
): Promise<StepArtifactOutput> {
  return runTrackedStep(rt.lifecycle, state, 'PersistResults', async () => {
    const normalized = (await readArtifact<NormalizedResource[]>(rt, state.normalized?.artifactKey)) ?? [];
    const detection = (await readArtifact<DetectionResult>(rt, state.detection?.artifactKey)) ?? {
      issues: [],
      evaluations: [],
      rulesExecuted: [],
    };
    const priced = (await readArtifact<PricedRecommendationDraft[]>(rt, state.savings?.artifactKey)) ?? [];
    const outcome = await persistScanResults(
      rt.repos,
      {
        tenantId: state.tenantId,
        accountId: state.accountId,
        scanId: state.scanId,
        now: rt.clock.now().toISOString(),
        normalized,
        discovery: state.discovery ?? [],
        detection,
        priced,
      },
      rt.logger,
    );
    const key = ARTIFACT_KEYS.persisted(prefixOf(state));
    await rt.artifacts.putJson(key, envelope(state, outcome, rt.clock.now()));
    return {
      status: 'SUCCEEDED',
      artifactKey: key,
      counts: {
        newFindings: outcome.newFindingIds.length,
        resolvedFindings: outcome.resolvedFindingIds.length,
        resources: outcome.resourcesUpserted,
      },
    };
  });
}

// ---------------------------------------------------------------- GenerateScanSummary
export async function generateSummary(
  rt: WorkerRuntime,
  state: ScanWorkflowState,
): Promise<StepArtifactOutput> {
  return runTrackedStep(rt.lifecycle, state, 'GenerateScanSummary', async () => {
    const outcome = await readArtifact<PersistOutcome>(rt, state.persisted?.artifactKey);
    const normalized = (await readArtifact<NormalizedResource[]>(rt, state.normalized?.artifactKey)) ?? [];
    const byType: ScanSummary['resourcesByType'] = {};
    for (const r of normalized) byType[r.resourceType] = (byType[r.resourceType] ?? 0) + 1;
    const summary: ScanSummary = {
      resourcesDiscovered: normalized.length,
      resourcesByType: byType,
      findingsDetected: outcome?.findingsDetected ?? 0,
      newFindings: outcome?.newFindingIds.length ?? 0,
      reopenedFindings: outcome?.reopenedFindingIds.length ?? 0,
      resolvedFindings: outcome?.resolvedFindingIds.length ?? 0,
      criticalFindings: outcome?.criticalFindings ?? 0,
      openRecommendations: outcome?.openRecommendations ?? 0,
      potentialMonthlySavings: outcome?.potentialMonthlySavings ?? 0,
      metricsCoverage: {
        resourcesWithMetrics: normalized.filter((r) => r.utilization).length,
        resourcesWithoutMetrics: normalized.filter((r) => !r.utilization).length,
      },
      costDataAvailable: state.costs?.status === 'SUCCEEDED' || state.costs?.status === 'PARTIAL',
    };
    const partial =
      (state.discovery ?? []).some((d) => d.status !== 'SUCCEEDED') ||
      (state.regionsResolved?.skippedRegions.length ?? 0) > 0 ||
      [
        state.metrics,
        state.costs,
        state.normalized,
        state.detection,
        state.recommendations,
        state.savings,
      ].some((s) => !s || s.status === 'FAILED' || s.status === 'PARTIAL');
    const key = ARTIFACT_KEYS.summary(prefixOf(state));
    await rt.artifacts.putJson(key, envelope(state, summary, rt.clock.now()));
    const scan = await rt.lifecycle.complete(state.tenantId, state.scanId, summary, partial);
    if (scan.durationMs !== null) emitMetric('ScanDurationMs', scan.durationMs, 'Milliseconds');
    if (scan.trigger === 'SCHEDULED') {
      await rt.schedules.recordExecution(state.tenantId, scan.triggeredBy, {
        status: scan.status,
        scanId: scan.scanId,
      });
    }
    return { status: partial ? 'PARTIAL' : 'SUCCEEDED', artifactKey: key, message: scan.status };
  });
}

// ---------------------------------------------------------------- SendNotifications
export async function sendNotifications(
  rt: WorkerRuntime,
  state: ScanWorkflowState,
): Promise<StepArtifactOutput> {
  const startedAt = rt.clock.now().toISOString();
  await rt.lifecycle.step(state.tenantId, state.scanId, 'SendNotifications', 'RUNNING', null, startedAt);
  try {
    const scan = await rt.lifecycle.load(state.tenantId, state.scanId);
    const outcome = await readArtifact<PersistOutcome>(rt, state.persisted?.artifactKey);
    const result = await rt.notifications.notifyScan(scan, outcome, false);
    if (result.failed) emitMetric('NotificationFailures', result.failed);
    const msg = `${result.sent} sent, ${result.suppressed} deduplicated, ${result.failed} failed`;
    await rt.lifecycle.step(
      state.tenantId,
      state.scanId,
      'SendNotifications',
      result.failed ? 'PARTIAL' : 'SUCCEEDED',
      msg,
      startedAt,
    );
    return { status: result.failed ? 'PARTIAL' : 'SUCCEEDED', artifactKey: null, message: msg };
  } catch (error) {
    // Notification failures never fail a completed scan.
    emitMetric('NotificationFailures', 1);
    rt.logger.error('SendNotifications failed', { error });
    await rt.lifecycle.step(
      state.tenantId,
      state.scanId,
      'SendNotifications',
      'FAILED',
      errorMessage(error),
      startedAt,
    );
    return { status: 'FAILED', artifactKey: null, message: errorMessage(error) };
  }
}

// ---------------------------------------------------------------- MarkScanFailed (global Catch target)
export async function markScanFailed(
  rt: WorkerRuntime,
  state: ScanWorkflowState,
): Promise<StepArtifactOutput> {
  let cause = state.error?.Cause ?? 'Unknown error';
  try {
    const parsed = JSON.parse(cause) as { errorMessage?: string };
    if (parsed.errorMessage) cause = parsed.errorMessage;
  } catch {
    /* Cause is not JSON */
  }
  const scan = await rt.lifecycle.fail(state.tenantId, state.scanId, {
    step: 'Workflow',
    code: state.error?.Error ?? 'WORKFLOW_FAILED',
    message: cause.slice(0, 1000),
    at: rt.clock.now().toISOString(),
  });
  if (scan && scan.status === 'FAILED') {
    try {
      await rt.notifications.notifyScan(scan, null, true);
    } catch (error) {
      emitMetric('NotificationFailures', 1);
      rt.logger.error('Failure notification could not be sent', { error });
    }
    if (scan.trigger === 'SCHEDULED') {
      await rt.schedules.recordExecution(state.tenantId, scan.triggeredBy, {
        status: 'FAILED',
        scanId: scan.scanId,
        error: cause,
      });
    }
  }
  return { status: 'FAILED', artifactKey: null, message: cause.slice(0, 500) };
}
