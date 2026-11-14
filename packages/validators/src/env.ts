import { z } from 'zod';

/** Runtime configuration shared by all Lambda functions and the local API server. */
export const baseEnvSchema = z.object({
  STAGE: z.string().min(1).default('local'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TABLE_NAME: z.string().min(1),
  ARTIFACTS_BUCKET: z.string().min(1).optional(),
  /** Local development only: write artifacts to this directory instead of S3. */
  LOCAL_ARTIFACTS_DIR: z.string().min(1).optional(),
  /** Local development only: DynamoDB Local endpoint. */
  DYNAMODB_ENDPOINT: z.string().url().optional(),
  AWS_REGION: z.string().min(1).default('us-east-1'),
  /** CloudSentry's own AWS account ID; customers' role trust policies trust this account. */
  PLATFORM_ACCOUNT_ID: z
    .string()
    .regex(/^\d{12}$/)
    .optional(),
  PRICING_REGION: z.string().default('us-east-1'),
});
export type BaseEnv = z.infer<typeof baseEnvSchema>;

export const apiEnvSchema = baseEnvSchema.extend({
  AUTH_MODE: z.enum(['cognito', 'local']).default('cognito'),
  USER_POOL_ID: z.string().optional(),
  USER_POOL_CLIENT_ID: z.string().optional(),
  USER_POOL_CLIENT_SECRET_ARN: z.string().optional(),
  STATE_MACHINE_ARN: z.string().optional(),
  SCHEDULER_GROUP_NAME: z.string().optional(),
  SCHEDULER_ROLE_ARN: z.string().optional(),
  SCHEDULED_SCAN_FUNCTION_ARN: z.string().optional(),
  NOTIFICATIONS_TOPIC_ARN: z.string().optional(),
  REPORT_FUNCTION_NAME: z.string().optional(),
  COOKIE_SECURE: z.enum(['true', 'false']).default('true'),
  /** local development only: signing key for locally issued JWTs. */
  LOCAL_JWT_SECRET: z.string().min(32).optional(),
});
export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const workerEnvSchema = baseEnvSchema.extend({
  NOTIFICATIONS_TOPIC_ARN: z.string().optional(),
  STATE_MACHINE_ARN: z.string().optional(),
  /** Minimum age (hours) before metrics for a resource are re-collected. */
  METRICS_REUSE_HOURS: z.coerce.number().min(0).max(168).default(6),
  /** Minimum age (hours) before Cost Explorer is queried again for an account (each call costs USD 0.01). */
  COST_REFRESH_HOURS: z.coerce.number().min(0).max(168).default(12),
  DASHBOARD_URL: z.string().url().optional(),
});
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseEnv<T extends z.ZodTypeAny>(
  schema: T,
  env: NodeJS.ProcessEnv = process.env,
): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return result.data as z.infer<T>;
}
