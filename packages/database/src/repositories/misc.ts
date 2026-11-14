import type {
  CostSnapshot,
  DetectionSettings,
  NotificationPreferences,
  NotificationRecord,
  PriceCache,
  PriceLookupResult,
  ReportRecord,
  ScanSchedule,
} from '@cloudsentry/shared-types';
import { epochSeconds, addDays, sha256Hex } from '@cloudsentry/utilities';
import { ENTITY, keys, tenantPrefix } from '../keys';
import { isConditionFailure, type Page, type Table } from '../table';

// ---------------- Cost snapshots ----------------
export interface CostSnapshotRepository {
  put(snapshot: CostSnapshot): Promise<void>;
  get(tenantId: string, accountId: string): Promise<CostSnapshot | null>;
  list(tenantId: string): Promise<CostSnapshot[]>;
  delete(tenantId: string, accountId: string): Promise<void>;
}

export class DynamoCostSnapshotRepository implements CostSnapshotRepository {
  constructor(private readonly table: Table) {}
  async put(snapshot: CostSnapshot): Promise<void> {
    await this.table.put({
      ...keys.cost(snapshot.tenantId, snapshot.accountId),
      entity: ENTITY.cost,
      ...snapshot,
    });
  }
  get(tenantId: string, accountId: string): Promise<CostSnapshot | null> {
    return this.table.get<CostSnapshot>(keys.cost(tenantId, accountId));
  }
  list(tenantId: string): Promise<CostSnapshot[]> {
    return this.table.queryAll<CostSnapshot>(
      { pk: keys.cost(tenantId, '').PK, skPrefix: keys.costPrefix },
      1000,
    );
  }
  async delete(tenantId: string, accountId: string): Promise<void> {
    await this.table.delete(keys.cost(tenantId, accountId));
  }
}

// ---------------- Schedules ----------------
export interface ScheduleRepository {
  create(schedule: ScanSchedule): Promise<void>;
  get(tenantId: string, scheduleId: string): Promise<ScanSchedule | null>;
  list(tenantId: string, accountId?: string): Promise<ScanSchedule[]>;
  update(
    tenantId: string,
    scheduleId: string,
    changes: Partial<ScanSchedule>,
    expectedVersion?: number,
  ): Promise<ScanSchedule>;
  delete(tenantId: string, scheduleId: string): Promise<void>;
}

export class DynamoScheduleRepository implements ScheduleRepository {
  constructor(private readonly table: Table) {}
  create(schedule: ScanSchedule): Promise<void> {
    return this.table.create(
      { ...keys.schedule(schedule.tenantId, schedule.scheduleId), entity: ENTITY.schedule, ...schedule },
      `A schedule already exists for account ${schedule.accountId}`,
    );
  }
  get(tenantId: string, scheduleId: string): Promise<ScanSchedule | null> {
    return this.table.get<ScanSchedule>(keys.schedule(tenantId, scheduleId));
  }
  async list(tenantId: string, accountId?: string): Promise<ScanSchedule[]> {
    const all = await this.table.queryAll<ScanSchedule>(
      { pk: keys.schedule(tenantId, '').PK, skPrefix: keys.schedulePrefix },
      1000,
    );
    return accountId ? all.filter((s) => s.accountId === accountId) : all;
  }
  update(
    tenantId: string,
    scheduleId: string,
    changes: Partial<ScanSchedule>,
    expectedVersion?: number,
  ): Promise<ScanSchedule> {
    return this.table.patch<ScanSchedule>(
      keys.schedule(tenantId, scheduleId),
      changes,
      expectedVersion === undefined ? {} : { expectedVersion },
    );
  }
  async delete(tenantId: string, scheduleId: string): Promise<void> {
    await this.table.delete(keys.schedule(tenantId, scheduleId));
  }
}

// ---------------- Reports ----------------
export interface ReportRepository {
  create(report: ReportRecord): Promise<void>;
  get(tenantId: string, reportId: string): Promise<ReportRecord | null>;
  list(tenantId: string, page: { limit: number; cursor?: string }): Promise<Page<ReportRecord>>;
  update(tenantId: string, reportId: string, changes: Partial<ReportRecord>): Promise<ReportRecord>;
}

export class DynamoReportRepository implements ReportRepository {
  constructor(private readonly table: Table) {}
  create(report: ReportRecord): Promise<void> {
    return this.table.create(
      { ...keys.report(report.tenantId, report.reportId), entity: ENTITY.report, ...report },
      'Report already exists',
    );
  }
  get(tenantId: string, reportId: string): Promise<ReportRecord | null> {
    return this.table.get<ReportRecord>(keys.report(tenantId, reportId));
  }
  list(tenantId: string, page: { limit: number; cursor?: string }): Promise<Page<ReportRecord>> {
    return this.table.queryPage<ReportRecord>({
      pk: keys.report(tenantId, '').PK,
      skPrefix: keys.reportPrefix,
      limit: page.limit,
      ...(page.cursor ? { cursor: page.cursor } : {}),
      cursorScope: tenantPrefix(tenantId),
      ascending: false,
    });
  }
  update(tenantId: string, reportId: string, changes: Partial<ReportRecord>): Promise<ReportRecord> {
    return this.table.patch<ReportRecord>(keys.report(tenantId, reportId), changes);
  }
}

// ---------------- Notifications ----------------
export interface NotificationRepository {
  record(notification: NotificationRecord, ttlDays?: number): Promise<void>;
  list(tenantId: string, page: { limit: number; cursor?: string }): Promise<Page<NotificationRecord>>;
  /** Claims a dedupe key; returns false when an alert with this key was already sent. */
  claimDedupeKey(tenantId: string, dedupeKey: string, ttlDays: number): Promise<boolean>;
  releaseDedupeKey(tenantId: string, dedupeKey: string): Promise<void>;
}

export class DynamoNotificationRepository implements NotificationRepository {
  constructor(private readonly table: Table) {}
  async record(n: NotificationRecord, ttlDays = 180): Promise<void> {
    await this.table.put({
      ...keys.notification(n.tenantId, n.notificationId),
      entity: ENTITY.notification,
      ...n,
      expiresAt: epochSeconds(addDays(new Date(), ttlDays)),
    });
  }
  list(tenantId: string, page: { limit: number; cursor?: string }): Promise<Page<NotificationRecord>> {
    return this.table.queryPage<NotificationRecord>({
      pk: keys.notificationsPk(tenantId),
      limit: page.limit,
      ...(page.cursor ? { cursor: page.cursor } : {}),
      cursorScope: tenantPrefix(tenantId),
      ascending: false,
    });
  }
  async claimDedupeKey(tenantId: string, dedupeKey: string, ttlDays: number): Promise<boolean> {
    try {
      await this.table.put(
        {
          ...keys.notifyKey(tenantId, sha256Hex(dedupeKey).slice(0, 40)),
          entity: ENTITY.notifyKey,
          dedupeKey,
          expiresAt: epochSeconds(addDays(new Date(), ttlDays)),
        },
        {
          expression: 'attribute_not_exists(PK) OR expiresAt < :now',
          values: { ':now': epochSeconds(new Date()) },
        },
      );
      return true;
    } catch (error) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  }
  async releaseDedupeKey(tenantId: string, dedupeKey: string): Promise<void> {
    await this.table.delete(keys.notifyKey(tenantId, sha256Hex(dedupeKey).slice(0, 40)));
  }
}

// ---------------- Settings ----------------
export interface SettingsRepository {
  getDetectionSettings(tenantId: string): Promise<DetectionSettings | null>;
  putDetectionSettings(settings: DetectionSettings, expectedVersion: number | null): Promise<void>;
  getNotificationPreferences(tenantId: string): Promise<NotificationPreferences | null>;
  putNotificationPreferences(prefs: NotificationPreferences, expectedVersion: number | null): Promise<void>;
}

export class DynamoSettingsRepository implements SettingsRepository {
  constructor(private readonly table: Table) {}
  getDetectionSettings(tenantId: string): Promise<DetectionSettings | null> {
    return this.table.get<DetectionSettings>(keys.detectionSettings(tenantId));
  }
  putDetectionSettings(settings: DetectionSettings, expectedVersion: number | null): Promise<void> {
    return this.table.putVersioned(
      { ...keys.detectionSettings(settings.tenantId), entity: ENTITY.detectionSettings, ...settings },
      expectedVersion,
    );
  }
  getNotificationPreferences(tenantId: string): Promise<NotificationPreferences | null> {
    return this.table.get<NotificationPreferences>(keys.notificationPrefs(tenantId));
  }
  putNotificationPreferences(prefs: NotificationPreferences, expectedVersion: number | null): Promise<void> {
    return this.table.putVersioned(
      { ...keys.notificationPrefs(prefs.tenantId), entity: ENTITY.notificationPrefs, ...prefs },
      expectedVersion,
    );
  }
}

// ---------------- Price cache (global, not tenant data) ----------------
export class DynamoPriceCache implements PriceCache {
  constructor(private readonly table: Table) {}
  async get(cacheKey: string): Promise<PriceLookupResult | null> {
    const raw = await this.table.getRaw(keys.price(sha256Hex(cacheKey)), false);
    if (!raw || (typeof raw.expiresAt === 'number' && raw.expiresAt < epochSeconds(new Date()))) return null;
    return raw.value as PriceLookupResult;
  }
  async put(cacheKey: string, value: PriceLookupResult, ttlSeconds: number): Promise<void> {
    await this.table.put({
      ...keys.price(sha256Hex(cacheKey)),
      entity: ENTITY.price,
      cacheKey,
      value,
      expiresAt: epochSeconds(new Date()) + ttlSeconds,
    });
  }
}
