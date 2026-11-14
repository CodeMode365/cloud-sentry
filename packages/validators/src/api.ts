import { z } from 'zod';
import {
  FINDING_CATEGORIES,
  FINDING_STATUSES,
  RECOMMENDATION_STATUSES,
  REPORT_FORMATS,
  REPORT_TYPES,
  RESOURCE_TYPES,
  SCAN_STATUSES,
  SCHEDULE_FREQUENCIES,
  SEVERITIES,
  USER_SETTABLE_FINDING_STATUSES,
  USER_SETTABLE_RECOMMENDATION_STATUSES,
  NOTIFICATION_EVENT_TYPES,
} from '@cloudsentry/shared-types';
import { awsAccountIdSchema, awsRegionSchema, roleArnSchema, roleNameSchema } from './aws';
import { csvArray, noteSchema, paginationSchema, sortOrderSchema } from './common';
import { cronExpressionSchema, timezoneSchema } from './schedule';

// ---------- Auth ----------
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(256)
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a digit')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a symbol');

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(100),
  organizationName: z.string().trim().min(2).max(100),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const confirmRegistrationRequestSchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{4,10}$/, 'Confirmation code must be numeric'),
});
export type ConfirmRegistrationRequest = z.infer<typeof confirmRegistrationRequestSchema>;

export const resendCodeRequestSchema = z.object({ email: emailSchema });

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

// ---------- Accounts ----------
export const createAccountRequestSchema = z.object({
  accountId: awsAccountIdSchema,
  alias: z.string().trim().min(1).max(64),
  roleName: roleNameSchema.default('CloudSentryReadOnlyRole'),
  regions: z.array(awsRegionSchema).min(1).max(30).default(['us-east-1']),
});
export type CreateAccountRequest = z.infer<typeof createAccountRequestSchema>;

export const updateAccountRequestSchema = z
  .object({
    alias: z.string().trim().min(1).max(64).optional(),
    regions: z.array(awsRegionSchema).min(1).max(30).optional(),
  })
  .refine((v) => v.alias !== undefined || v.regions !== undefined, 'Provide at least one field to update');
export type UpdateAccountRequest = z.infer<typeof updateAccountRequestSchema>;

export const verifyAccountRequestSchema = z.object({
  roleArn: roleArnSchema.optional(),
});
export type VerifyAccountRequest = z.infer<typeof verifyAccountRequestSchema>;

// ---------- Scans ----------
export const startScanRequestSchema = z
  .object({
    regions: z.array(awsRegionSchema).min(1).max(30).optional(),
  })
  .default({});
export type StartScanRequest = z.infer<typeof startScanRequestSchema>;

export const listScansQuerySchema = paginationSchema.extend({
  accountId: awsAccountIdSchema.optional(),
  status: z.enum(SCAN_STATUSES).optional(),
});
export type ListScansQuery = z.infer<typeof listScansQuerySchema>;

// ---------- Resources ----------
export const RESOURCE_SORT_FIELDS = [
  'lastSeenAt',
  'name',
  'resourceType',
  'region',
  'activeFindingCount',
] as const;
export const listResourcesQuerySchema = paginationSchema.extend({
  accountId: awsAccountIdSchema.optional(),
  resourceType: csvArray(z.enum(RESOURCE_TYPES)),
  region: csvArray(awsRegionSchema),
  state: z.string().trim().max(64).optional(),
  search: z.string().trim().max(128).optional(),
  hasFindings: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  includeNotFound: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sort: z.enum(RESOURCE_SORT_FIELDS).optional(),
  order: sortOrderSchema,
});
export type ListResourcesQuery = z.infer<typeof listResourcesQuerySchema>;

// ---------- Findings ----------
export const listFindingsQuerySchema = paginationSchema.extend({
  accountId: awsAccountIdSchema.optional(),
  resourceType: csvArray(z.enum(RESOURCE_TYPES)),
  severity: csvArray(z.enum(SEVERITIES)),
  category: csvArray(z.enum(FINDING_CATEGORIES)),
  status: csvArray(z.enum(FINDING_STATUSES)),
  resourceKey: z.string().max(1024).optional(),
});
export type ListFindingsQuery = z.infer<typeof listFindingsQuerySchema>;

export const updateFindingRequestSchema = z.object({
  status: z.enum(USER_SETTABLE_FINDING_STATUSES),
  note: noteSchema,
  /** Optimistic concurrency: the version the client last saw. */
  expectedVersion: z.number().int().positive().optional(),
});
export type UpdateFindingRequest = z.infer<typeof updateFindingRequestSchema>;

// ---------- Recommendations ----------
export const listRecommendationsQuerySchema = paginationSchema.extend({
  accountId: awsAccountIdSchema.optional(),
  resourceType: csvArray(z.enum(RESOURCE_TYPES)),
  status: csvArray(z.enum(RECOMMENDATION_STATUSES)),
  minMonthlySavings: z.coerce.number().min(0).optional(),
  sort: z.enum(['savings', 'updatedAt']).optional(),
});
export type ListRecommendationsQuery = z.infer<typeof listRecommendationsQuerySchema>;

export const updateRecommendationRequestSchema = z.object({
  status: z.enum(USER_SETTABLE_RECOMMENDATION_STATUSES),
  note: noteSchema,
  expectedVersion: z.number().int().positive().optional(),
});
export type UpdateRecommendationRequest = z.infer<typeof updateRecommendationRequestSchema>;

// ---------- Analytics ----------
export const analyticsQuerySchema = z.object({
  accountId: awsAccountIdSchema.optional(),
});
export const costAnalyticsQuerySchema = analyticsQuerySchema.extend({
  months: z.coerce.number().int().min(1).max(12).default(6),
});
export type CostAnalyticsQuery = z.infer<typeof costAnalyticsQuerySchema>;

// ---------- Schedules ----------
const scheduleBase = z.object({
  frequency: z.enum(SCHEDULE_FREQUENCIES),
  /** Required when frequency is CUSTOM; EventBridge Scheduler cron() expression. */
  cronExpression: cronExpressionSchema.optional(),
  /** Hour (0-23) for DAILY and WEEKLY frequencies, in `timezone`. */
  hour: z.number().int().min(0).max(23).default(2),
  minute: z.number().int().min(0).max(59).default(0),
  /** Day of week for WEEKLY: 1=Sunday ... 7=Saturday (EventBridge convention). */
  dayOfWeek: z.number().int().min(1).max(7).default(2),
  timezone: timezoneSchema.default('UTC'),
  enabled: z.boolean().default(true),
});

export const createScheduleRequestSchema = scheduleBase
  .extend({ accountId: awsAccountIdSchema })
  .refine((v) => v.frequency !== 'CUSTOM' || v.cronExpression !== undefined, {
    message: 'cronExpression is required when frequency is CUSTOM',
    path: ['cronExpression'],
  });
export type CreateScheduleRequest = z.infer<typeof createScheduleRequestSchema>;

export const updateScheduleRequestSchema = z
  .object({
    frequency: z.enum(SCHEDULE_FREQUENCIES).optional(),
    cronExpression: cronExpressionSchema.optional(),
    hour: z.number().int().min(0).max(23).optional(),
    minute: z.number().int().min(0).max(59).optional(),
    dayOfWeek: z.number().int().min(1).max(7).optional(),
    timezone: timezoneSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export type UpdateScheduleRequest = z.infer<typeof updateScheduleRequestSchema>;

export const listSchedulesQuerySchema = paginationSchema.extend({
  accountId: awsAccountIdSchema.optional(),
});

// ---------- Reports ----------
export const createReportRequestSchema = z.object({
  accountId: awsAccountIdSchema.nullable().default(null),
  type: z.enum(REPORT_TYPES).default('ON_DEMAND'),
  format: z.enum(REPORT_FORMATS).default('PDF'),
});
export type CreateReportRequest = z.infer<typeof createReportRequestSchema>;

export const listReportsQuerySchema = paginationSchema;

// ---------- Settings ----------
export const notificationPreferencesRequestSchema = z.object({
  enabled: z.boolean(),
  emails: z.array(emailSchema).max(10),
  events: z.object(
    Object.fromEntries(NOTIFICATION_EVENT_TYPES.map((t) => [t, z.boolean()])) as Record<
      (typeof NOTIFICATION_EVENT_TYPES)[number],
      z.ZodBoolean
    >,
  ),
  highValueSavingsThreshold: z.number().min(0).max(1_000_000),
  minimumFindingSeverity: z.enum(SEVERITIES),
});
export type NotificationPreferencesRequest = z.infer<typeof notificationPreferencesRequestSchema>;

export const detectionSettingsRequestSchema = z.object({
  lookbackDays: z.number().int().min(14).max(90),
  ignoreTagKey: z.string().trim().min(1).max(128),
  rules: z.record(
    z.string().regex(/^[a-z0-9-]{3,64}$/),
    z.object({
      enabled: z.boolean(),
      thresholds: z.record(z.string().max(64), z.number().finite()),
    }),
  ),
});
export type DetectionSettingsRequest = z.infer<typeof detectionSettingsRequestSchema>;
