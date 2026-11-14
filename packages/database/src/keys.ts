/**
 * DynamoDB key construction. This module is the ONLY place keys are built; see
 * docs/architecture/overview.md section 3 for the access patterns each key serves.
 */
export const ENTITY = {
  tenant: 'Tenant',
  user: 'UserProfile',
  registration: 'PendingRegistration',
  account: 'CloudAccount',
  scanLock: 'ScanLock',
  idempotency: 'IdempotencyKey',
  scan: 'ScanExecution',
  resource: 'CloudResource',
  finding: 'Finding',
  recommendation: 'Recommendation',
  cost: 'CostSnapshot',
  schedule: 'ScanSchedule',
  report: 'Report',
  notification: 'Notification',
  notifyKey: 'NotificationDedupeKey',
  notificationPrefs: 'NotificationPreferences',
  detectionSettings: 'DetectionSettings',
  price: 'PriceCacheEntry',
} as const;

export const tenantPk = (tenantId: string) => `TENANT#${tenantId}`;
export const tenantPrefix = (tenantId: string) => `TENANT#${tenantId}`;

export const keys = {
  tenant: (tenantId: string) => ({ PK: tenantPk(tenantId), SK: 'META' }),
  user: (userId: string) => ({ PK: `USER#${userId}`, SK: 'PROFILE' }),
  userGsi: (tenantId: string, userId: string) => ({
    GSI1PK: `${tenantPk(tenantId)}#USERS`,
    GSI1SK: `USER#${userId}`,
  }),
  registration: (email: string) => ({ PK: `REGISTRATION#${email.toLowerCase()}`, SK: 'PENDING' }),
  account: (tenantId: string, accountId: string) => ({ PK: tenantPk(tenantId), SK: `ACCOUNT#${accountId}` }),
  accountPrefix: 'ACCOUNT#',
  scanLock: (tenantId: string, accountId: string) => ({
    PK: tenantPk(tenantId),
    SK: `LOCK#SCAN#${accountId}`,
  }),
  idempotency: (tenantId: string, key: string) => ({ PK: tenantPk(tenantId), SK: `IDEMPOTENCY#${key}` }),
  scan: (tenantId: string, scanId: string) => ({ PK: tenantPk(tenantId), SK: `SCAN#${scanId}` }),
  scanGsi: (tenantId: string, accountId: string, scanId: string) => ({
    GSI1PK: `${tenantPk(tenantId)}#ACCOUNT#${accountId}#SCANS`,
    GSI1SK: `SCAN#${scanId}`,
  }),
  scanByAccountPk: (tenantId: string, accountId: string) =>
    `${tenantPk(tenantId)}#ACCOUNT#${accountId}#SCANS`,
  scanPrefix: 'SCAN#',
  resourcesPk: (tenantId: string) => `${tenantPk(tenantId)}#RESOURCES`,
  resourceSk: (accountId: string, region: string, resourceType: string, resourceId: string) =>
    `RES#${accountId}#${region}#${resourceType}#${resourceId}`,
  resourceGsi: (
    tenantId: string,
    accountId: string,
    region: string,
    resourceType: string,
    resourceId: string,
  ) => ({
    GSI1PK: `${tenantPk(tenantId)}#RTYPE#${resourceType}`,
    GSI1SK: `RES#${accountId}#${region}#${resourceId}`,
  }),
  resourceTypePk: (tenantId: string, resourceType: string) => `${tenantPk(tenantId)}#RTYPE#${resourceType}`,
  findingsPk: (tenantId: string) => `${tenantPk(tenantId)}#FINDINGS`,
  findingSk: (findingId: string) => `FINDING#${findingId}`,
  byResourcePk: (tenantId: string, resourceKey: string) => `${tenantPk(tenantId)}#RESOURCE#${resourceKey}`,
  recommendationsPk: (tenantId: string) => `${tenantPk(tenantId)}#RECOMMENDATIONS`,
  recommendationSk: (recommendationId: string) => `REC#${recommendationId}`,
  cost: (tenantId: string, accountId: string) => ({ PK: tenantPk(tenantId), SK: `COST#${accountId}` }),
  costPrefix: 'COST#',
  schedule: (tenantId: string, scheduleId: string) => ({
    PK: tenantPk(tenantId),
    SK: `SCHEDULE#${scheduleId}`,
  }),
  schedulePrefix: 'SCHEDULE#',
  report: (tenantId: string, reportId: string) => ({ PK: tenantPk(tenantId), SK: `REPORT#${reportId}` }),
  reportPrefix: 'REPORT#',
  notification: (tenantId: string, notificationId: string) => ({
    PK: `${tenantPk(tenantId)}#NOTIFICATIONS`,
    SK: `NTF#${notificationId}`,
  }),
  notificationsPk: (tenantId: string) => `${tenantPk(tenantId)}#NOTIFICATIONS`,
  notifyKey: (tenantId: string, dedupeKey: string) => ({
    PK: tenantPk(tenantId),
    SK: `NOTIFYKEY#${dedupeKey}`,
  }),
  notificationPrefs: (tenantId: string) => ({ PK: tenantPk(tenantId), SK: 'SETTINGS#NOTIFICATIONS' }),
  detectionSettings: (tenantId: string) => ({ PK: tenantPk(tenantId), SK: 'SETTINGS#DETECTION' }),
  price: (hash: string) => ({ PK: `PRICE#${hash}`, SK: 'PRICE' }),
};

export const KEY_ATTRIBUTES = ['PK', 'SK', 'GSI1PK', 'GSI1SK', 'entity', 'expiresAt', 'searchText'] as const;
