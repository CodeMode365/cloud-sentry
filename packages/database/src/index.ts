import { Table, type TableOptions } from './table';
import { DynamoTenantRepository, type TenantRepository } from './repositories/tenants';
import { DynamoAccountRepository, type AccountRepository } from './repositories/accounts';
import { DynamoScanRepository, type ScanRepository } from './repositories/scans';
import { DynamoResourceRepository, type ResourceRepository } from './repositories/resources';
import {
  DynamoFindingRepository,
  DynamoRecommendationRepository,
  type FindingRepository,
  type RecommendationRepository,
} from './repositories/findings';
import {
  DynamoCostSnapshotRepository,
  DynamoNotificationRepository,
  DynamoPriceCache,
  DynamoReportRepository,
  DynamoScheduleRepository,
  DynamoSettingsRepository,
  type CostSnapshotRepository,
  type NotificationRepository,
  type ReportRepository,
  type ScheduleRepository,
  type SettingsRepository,
} from './repositories/misc';
import type { PriceCache } from '@cloudsentry/shared-types';

export * from './table';
export * from './keys';
export * from './filters';
export * from './local';
export * from './repositories/tenants';
export * from './repositories/accounts';
export * from './repositories/scans';
export * from './repositories/resources';
export * from './repositories/findings';
export * from './repositories/misc';

export interface Repositories {
  table: Table;
  tenants: TenantRepository;
  accounts: AccountRepository;
  scans: ScanRepository;
  resources: ResourceRepository;
  findings: FindingRepository;
  recommendations: RecommendationRepository;
  costs: CostSnapshotRepository;
  schedules: ScheduleRepository;
  reports: ReportRepository;
  notifications: NotificationRepository;
  settings: SettingsRepository;
  priceCache: PriceCache;
}

export function createRepositories(tableOrOptions: Table | TableOptions): Repositories {
  const table = tableOrOptions instanceof Table ? tableOrOptions : Table.create(tableOrOptions);
  return {
    table,
    tenants: new DynamoTenantRepository(table),
    accounts: new DynamoAccountRepository(table),
    scans: new DynamoScanRepository(table),
    resources: new DynamoResourceRepository(table),
    findings: new DynamoFindingRepository(table),
    recommendations: new DynamoRecommendationRepository(table),
    costs: new DynamoCostSnapshotRepository(table),
    schedules: new DynamoScheduleRepository(table),
    reports: new DynamoReportRepository(table),
    notifications: new DynamoNotificationRepository(table),
    settings: new DynamoSettingsRepository(table),
    priceCache: new DynamoPriceCache(table),
  };
}
