'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TERMINAL_SCAN_STATUSES,
  type AccountOnboardingInstructions,
  type AccountVerificationResult,
  type CloudAccount,
  type CloudResource,
  type CostAnalytics,
  type CreateAccountResponse,
  type DetectionSettings,
  type DownloadUrlResponse,
  type FindingRecord,
  type MeResponse,
  type NotificationPreferences,
  type OverviewAnalytics,
  type RecommendationRecord,
  type ReportRecord,
  type ResourceAnalytics,
  type ResourceDetailResponse,
  type RuleDefinitionSummary,
  type SavingsAnalytics,
  type ScanExecution,
  type ScanResultsResponse,
  type ScanSchedule,
} from '@cloudsentry/shared-types';
import type {
  CreateAccountRequest,
  CreateReportRequest,
  CreateScheduleRequest,
  DetectionSettingsRequest,
  NotificationPreferencesRequest,
  UpdateAccountRequest,
  UpdateFindingRequest,
  UpdateRecommendationRequest,
  UpdateScheduleRequest,
} from '@cloudsentry/validators';
import { api, type Page, type QueryParams } from './api';
import { newIdempotencyKey } from './utils';

export const queryKeys = {
  me: ['me'] as const,
  accounts: ['accounts'] as const,
  account: (id: string) => ['accounts', id] as const,
  onboarding: (id: string) => ['accounts', id, 'onboarding'] as const,
  scans: (q: QueryParams) => ['scans', q] as const,
  scan: (id: string) => ['scan', id] as const,
  scanResults: (id: string) => ['scan', id, 'results'] as const,
  resources: (q: QueryParams) => ['resources', q] as const,
  resource: (key: string) => ['resource', key] as const,
  findings: (q: QueryParams) => ['findings', q] as const,
  finding: (id: string) => ['finding', id] as const,
  recommendations: (q: QueryParams) => ['recommendations', q] as const,
  recommendation: (id: string) => ['recommendation', id] as const,
  overview: (accountId?: string) => ['analytics', 'overview', accountId ?? 'all'] as const,
  costs: (q: QueryParams) => ['analytics', 'costs', q] as const,
  resourceAnalytics: (accountId?: string) => ['analytics', 'resources', accountId ?? 'all'] as const,
  savings: (accountId?: string) => ['analytics', 'savings', accountId ?? 'all'] as const,
  schedules: ['schedules'] as const,
  reports: ['reports'] as const,
  notificationSettings: ['settings', 'notifications'] as const,
  detectionSettings: ['settings', 'detection'] as const,
  rules: ['rules'] as const,
};

export function isTerminalScan(status: ScanExecution['status']): boolean {
  return TERMINAL_SCAN_STATUSES.includes(status);
}

/** How long after completion to keep polling for SendNotifications to record its result. */
const NOTIFICATION_SETTLE_MS = 60_000;

/**
 * Whether the scan detail view should keep polling. The workflow marks a scan COMPLETED /
 * PARTIALLY_COMPLETED in GenerateScanSummary, before SendNotifications runs, so stopping at the
 * terminal status would freeze that step as running. Keep polling briefly until it settles.
 */
export function shouldPollScan(scan: ScanExecution, now: number = Date.now()): boolean {
  if (!isTerminalScan(scan.status)) return true;
  if (scan.status !== 'COMPLETED' && scan.status !== 'PARTIALLY_COMPLETED') return false;
  const notify = scan.steps.SendNotifications;
  if (notify && notify.status !== 'RUNNING') return false;
  const completedAt = scan.completedAt ? Date.parse(scan.completedAt) : Number.NaN;
  return Number.isFinite(completedAt) && now - completedAt < NOTIFICATION_SETTLE_MS;
}

// ---------------- Identity ----------------
export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: () => api.get<MeResponse>('/auth/me') });
}

// ---------------- Accounts ----------------
export function useAccounts() {
  return useQuery({
    queryKey: queryKeys.accounts,
    queryFn: () => api.all<CloudAccount>('/accounts'),
  });
}

export function useAccount(accountId: string | null) {
  return useQuery({
    queryKey: queryKeys.account(accountId ?? ''),
    queryFn: () => api.get<CloudAccount>(`/accounts/${encodeURIComponent(accountId ?? '')}`),
    enabled: !!accountId,
  });
}

export function useOnboarding(accountId: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.onboarding(accountId ?? ''),
    queryFn: () =>
      api.get<AccountOnboardingInstructions>(`/accounts/${encodeURIComponent(accountId ?? '')}/onboarding`),
    enabled: !!accountId && enabled,
    staleTime: 5 * 60_000,
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAccountRequest) => api.post<CreateAccountResponse>('/accounts', input),
    onSuccess: (res) => {
      qc.setQueryData(queryKeys.account(res.account.accountId), res.account);
      qc.setQueryData(queryKeys.onboarding(res.account.accountId), res.onboarding);
      void qc.invalidateQueries({ queryKey: queryKeys.accounts });
    },
  });
}

export function useUpdateAccount(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAccountRequest) =>
      api.patch<CloudAccount>(`/accounts/${encodeURIComponent(accountId)}`, input),
    onSuccess: (account) => {
      qc.setQueryData(queryKeys.account(accountId), account);
      void qc.invalidateQueries({ queryKey: queryKeys.accounts });
    },
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => api.delete(`/accounts/${encodeURIComponent(accountId)}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.accounts });
      void qc.invalidateQueries({ queryKey: ['analytics'] });
      void qc.invalidateQueries({ queryKey: queryKeys.schedules });
    },
  });
}

/** The verify endpoint may return the updated account or the verification result; both are accepted. */
export function extractVerification(
  payload: CloudAccount | AccountVerificationResult,
): AccountVerificationResult | null {
  if ('permissionChecks' in payload) return payload;
  return payload.lastVerification;
}

export function useVerifyAccount(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { roleArn?: string }) =>
      api.post<CloudAccount | AccountVerificationResult>(
        `/accounts/${encodeURIComponent(accountId)}/verify`,
        input,
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.account(accountId) });
      void qc.invalidateQueries({ queryKey: queryKeys.accounts });
    },
  });
}

export function useStartScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, regions }: { accountId: string; regions?: string[] }) =>
      api.post<ScanExecution>(
        `/accounts/${encodeURIComponent(accountId)}/scans`,
        regions ? { regions } : {},
        {
          'Idempotency-Key': newIdempotencyKey(),
        },
      ),
    onSuccess: (scan) => {
      qc.setQueryData(queryKeys.scan(scan.scanId), scan);
      void qc.invalidateQueries({ queryKey: ['scans'] });
      void qc.invalidateQueries({ queryKey: queryKeys.accounts });
    },
  });
}

// ---------------- Scans ----------------
export function useScans(query: QueryParams, options: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.scans(query),
    queryFn: ({ signal }) => api.page<ScanExecution>('/scans', query, signal),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => {
      if (!options.poll) return false;
      const page = q.state.data as Page<ScanExecution> | undefined;
      return page?.data.some((s) => !isTerminalScan(s.status)) ? 5000 : false;
    },
  });
}

export function useScan(scanId: string | null) {
  return useQuery({
    queryKey: queryKeys.scan(scanId ?? ''),
    queryFn: () => api.get<ScanExecution>(`/scans/${encodeURIComponent(scanId ?? '')}`),
    enabled: !!scanId,
    refetchInterval: (q) => {
      const scan = q.state.data as ScanExecution | undefined;
      return scan && shouldPollScan(scan) ? 5000 : false;
    },
  });
}

export function useScanResults(scanId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.scanResults(scanId ?? ''),
    queryFn: () => api.get<ScanResultsResponse>(`/scans/${encodeURIComponent(scanId ?? '')}/results`),
    enabled: !!scanId && enabled,
  });
}

export function useCancelScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scanId: string) => api.post<ScanExecution>(`/scans/${encodeURIComponent(scanId)}/cancel`),
    onSuccess: (scan) => {
      qc.setQueryData(queryKeys.scan(scan.scanId), scan);
      void qc.invalidateQueries({ queryKey: ['scans'] });
    },
  });
}

// ---------------- Resources ----------------
export function useResources(query: QueryParams) {
  return useQuery({
    queryKey: queryKeys.resources(query),
    queryFn: ({ signal }) => api.page<CloudResource>('/resources', query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useResource(resourceKey: string | null) {
  return useQuery({
    queryKey: queryKeys.resource(resourceKey ?? ''),
    queryFn: () => api.get<ResourceDetailResponse>(`/resources/${encodeURIComponent(resourceKey ?? '')}`),
    enabled: !!resourceKey,
  });
}

// ---------------- Findings ----------------
export function useFindings(query: QueryParams) {
  return useQuery({
    queryKey: queryKeys.findings(query),
    queryFn: ({ signal }) => api.page<FindingRecord>('/findings', query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useFinding(findingId: string | null) {
  return useQuery({
    queryKey: queryKeys.finding(findingId ?? ''),
    queryFn: () => api.get<FindingRecord>(`/findings/${encodeURIComponent(findingId ?? '')}`),
    enabled: !!findingId,
  });
}

export function useUpdateFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId, ...input }: UpdateFindingRequest & { findingId: string }) =>
      api.patch<FindingRecord>(`/findings/${encodeURIComponent(findingId)}`, input),
    onSuccess: (finding) => {
      qc.setQueryData(queryKeys.finding(finding.findingId), finding);
      void qc.invalidateQueries({ queryKey: ['findings'] });
      void qc.invalidateQueries({ queryKey: ['analytics'] });
      void qc.invalidateQueries({ queryKey: ['resource'] });
    },
  });
}

// ---------------- Recommendations ----------------
export function useRecommendations(query: QueryParams) {
  return useQuery({
    queryKey: queryKeys.recommendations(query),
    queryFn: ({ signal }) => api.page<RecommendationRecord>('/recommendations', query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useRecommendation(id: string | null) {
  return useQuery({
    queryKey: queryKeys.recommendation(id ?? ''),
    queryFn: () => api.get<RecommendationRecord>(`/recommendations/${encodeURIComponent(id ?? '')}`),
    enabled: !!id,
  });
}

type RecommendationListCache = Page<RecommendationRecord>;

/** Optimistically updates status in every cached list and the detail entry; rolls back on error. */
export function useUpdateRecommendation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      recommendationId,
      ...input
    }: UpdateRecommendationRequest & { recommendationId: string }) =>
      api.patch<RecommendationRecord>(`/recommendations/${encodeURIComponent(recommendationId)}`, input),
    onMutate: async (variables) => {
      await qc.cancelQueries({ queryKey: ['recommendations'] });
      await qc.cancelQueries({ queryKey: queryKeys.recommendation(variables.recommendationId) });
      const lists = qc.getQueriesData<RecommendationListCache>({ queryKey: ['recommendations'] });
      const detail = qc.getQueryData<RecommendationRecord>(
        queryKeys.recommendation(variables.recommendationId),
      );
      const patch = (r: RecommendationRecord): RecommendationRecord =>
        r.recommendationId === variables.recommendationId ? { ...r, status: variables.status } : r;
      for (const [key, value] of lists) {
        if (value) qc.setQueryData<RecommendationListCache>(key, { ...value, data: value.data.map(patch) });
      }
      if (detail) qc.setQueryData(queryKeys.recommendation(variables.recommendationId), patch(detail));
      return { lists, detail };
    },
    onError: (_error, variables, context) => {
      for (const [key, value] of context?.lists ?? []) qc.setQueryData(key, value);
      if (context?.detail)
        qc.setQueryData(queryKeys.recommendation(variables.recommendationId), context.detail);
    },
    onSuccess: (rec) => {
      qc.setQueryData(queryKeys.recommendation(rec.recommendationId), rec);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['recommendations'] });
      void qc.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}

// ---------------- Analytics ----------------
export function useOverview(accountId?: string) {
  return useQuery({
    queryKey: queryKeys.overview(accountId),
    queryFn: () => api.get<OverviewAnalytics>('/analytics/overview', { accountId }),
    refetchInterval: 60_000,
  });
}

export function useCostAnalytics(query: { accountId?: string; months: number }) {
  return useQuery({
    queryKey: queryKeys.costs(query),
    queryFn: () => api.get<CostAnalytics>('/analytics/costs', query),
    placeholderData: keepPreviousData,
  });
}

export function useResourceAnalytics(accountId?: string) {
  return useQuery({
    queryKey: queryKeys.resourceAnalytics(accountId),
    queryFn: () => api.get<ResourceAnalytics>('/analytics/resources', { accountId }),
  });
}

export function useSavingsAnalytics(accountId?: string) {
  return useQuery({
    queryKey: queryKeys.savings(accountId),
    queryFn: () => api.get<SavingsAnalytics>('/analytics/savings', { accountId }),
  });
}

// ---------------- Schedules ----------------
export function useSchedules() {
  return useQuery({ queryKey: queryKeys.schedules, queryFn: () => api.all<ScanSchedule>('/schedules') });
}

export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateScheduleRequest) => api.post<ScanSchedule>('/schedules', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.schedules }),
  });
}

export function useUpdateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ scheduleId, ...input }: UpdateScheduleRequest & { scheduleId: string }) =>
      api.patch<ScanSchedule>(`/schedules/${encodeURIComponent(scheduleId)}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.schedules }),
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scheduleId: string) => api.delete(`/schedules/${encodeURIComponent(scheduleId)}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.schedules }),
  });
}

// ---------------- Reports ----------------
export function useReports() {
  return useQuery({
    queryKey: queryKeys.reports,
    queryFn: () => api.page<ReportRecord>('/reports', { limit: 50 }),
    refetchInterval: (q) => {
      const page = q.state.data as Page<ReportRecord> | undefined;
      return page?.data.some((r) => r.status === 'PENDING' || r.status === 'GENERATING') ? 4000 : false;
    },
  });
}

export function useCreateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReportRequest) => api.post<ReportRecord>('/reports', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.reports }),
  });
}

export async function fetchReportDownloadUrl(reportId: string): Promise<DownloadUrlResponse> {
  return api.get<DownloadUrlResponse>(`/reports/${encodeURIComponent(reportId)}/download`);
}

// ---------------- Settings ----------------
export function useNotificationSettings() {
  return useQuery({
    queryKey: queryKeys.notificationSettings,
    queryFn: () => api.get<NotificationPreferences | null>('/settings/notifications'),
  });
}

export function useUpdateNotificationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NotificationPreferencesRequest) =>
      api.put<NotificationPreferences>('/settings/notifications', input),
    onSuccess: (prefs) => qc.setQueryData(queryKeys.notificationSettings, prefs),
  });
}

export function useDetectionSettings() {
  return useQuery({
    queryKey: queryKeys.detectionSettings,
    queryFn: () => api.get<DetectionSettings | null>('/settings/detection'),
  });
}

export function useUpdateDetectionSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DetectionSettingsRequest) => api.put<DetectionSettings>('/settings/detection', input),
    onSuccess: (settings) => qc.setQueryData(queryKeys.detectionSettings, settings),
  });
}

export function useRules() {
  return useQuery({
    queryKey: queryKeys.rules,
    queryFn: () => api.get<RuleDefinitionSummary[]>('/rules'),
    staleTime: 10 * 60_000,
  });
}
