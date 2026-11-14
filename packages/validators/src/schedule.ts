import { z } from 'zod';

/**
 * EventBridge Scheduler cron expressions have six fields: minutes hours day-of-month month day-of-week year.
 * Exactly one of day-of-month / day-of-week must be "?".
 */
const CRON_FIELD = /^[0-9A-Za-z*?,\-/#L]+$/;

export function validateEventBridgeCron(expression: string): string | null {
  const match = /^cron\((.+)\)$/.exec(expression.trim());
  if (!match) return 'Expression must be in the form cron(minutes hours day-of-month month day-of-week year)';
  const fields = (match[1] as string).trim().split(/\s+/);
  if (fields.length !== 6) return 'cron() requires exactly 6 fields';
  if (!fields.every((f) => CRON_FIELD.test(f))) return 'cron() contains unsupported characters';
  const [minutes, hours, dom, , dow] = fields as [string, string, string, string, string, string];
  if ((dom === '?') === (dow === '?')) return 'Exactly one of day-of-month or day-of-week must be "?"';
  if (minutes.includes('*') && !minutes.includes('/')) {
    return 'Running every minute is not allowed; specify a minute value';
  }
  if (hours.includes('*') && !hours.includes('/') && !/^\d+$/.test(minutes)) {
    return 'Hourly-or-faster schedules must use a fixed minute value';
  }
  return null;
}

export const cronExpressionSchema = z
  .string()
  .trim()
  .max(256)
  .superRefine((v, ctx) => {
    const problem = validateEventBridgeCron(v);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z.string().trim().max(64).refine(isValidTimezone, 'Unknown IANA timezone');
