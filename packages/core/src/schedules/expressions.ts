import cronParser from 'cron-parser';
import type { ScheduleFrequency } from '@cloudsentry/shared-types';
import { ValidationError } from '@cloudsentry/utilities';
import { validateEventBridgeCron } from '@cloudsentry/validators';

export interface ScheduleSpec {
  frequency: ScheduleFrequency;
  cronExpression?: string | undefined;
  hour: number;
  minute: number;
  /** 1 = Sunday ... 7 = Saturday (EventBridge convention). */
  dayOfWeek: number;
}

/**
 * Builds an EventBridge Scheduler expression. cron() is used for every preset (rather than rate()) so
 * schedules honour the configured timezone and run at predictable wall-clock times.
 */
export function buildScheduleExpression(spec: ScheduleSpec): string {
  switch (spec.frequency) {
    case 'DAILY':
      return `cron(${spec.minute} ${spec.hour} * * ? *)`;
    case 'EVERY_6_HOURS':
      return `cron(${spec.minute} 0/6 * * ? *)`;
    case 'WEEKLY':
      return `cron(${spec.minute} ${spec.hour} ? * ${spec.dayOfWeek} *)`;
    case 'CUSTOM': {
      if (!spec.cronExpression) throw new ValidationError('cronExpression is required for CUSTOM schedules');
      const problem = validateEventBridgeCron(spec.cronExpression);
      if (problem) throw new ValidationError(problem);
      return spec.cronExpression.trim();
    }
  }
}

/** Converts an EventBridge day-of-week field (1-7, SUN=1) to standard cron (0-6, SUN=0). */
function convertDayOfWeek(field: string): string {
  if (field === '?' || field === '*') return '*';
  return field.replace(/(^|[^#\d])(\d+)/g, (_m, pre: string, num: string) => `${pre}${Number(num) - 1}`);
}

/** Converts an EventBridge cron() expression into a 5-field expression understood by cron-parser. */
export function toStandardCron(expression: string): { cron: string; year: string } | null {
  const match = /^cron\((.+)\)$/.exec(expression.trim());
  if (!match) return null;
  const fields = (match[1] as string).trim().split(/\s+/);
  if (fields.length !== 6) return null;
  const [minute, hour, dom, month, dow, year] = fields as [string, string, string, string, string, string];
  return { cron: `${minute} ${hour} ${dom === '?' ? '*' : dom} ${month} ${convertDayOfWeek(dow)}`, year };
}

/** Next fire time for an EventBridge cron() expression in `timezone`, or null if it cannot be computed. */
export function nextExecution(expression: string, timezone: string, from: Date): Date | null {
  const converted = toStandardCron(expression);
  if (!converted) return null;
  try {
    const iterator = cronParser.parseExpression(converted.cron, { currentDate: from, tz: timezone });
    for (let i = 0; i < 500; i++) {
      const next = iterator.next().toDate();
      if (converted.year === '*' || yearMatches(converted.year, next.getUTCFullYear())) return next;
    }
    return null;
  } catch {
    return null;
  }
}

function yearMatches(field: string, year: number): boolean {
  return field.split(',').some((part) => {
    const range = /^(\d{4})-(\d{4})$/.exec(part);
    if (range) return year >= Number(range[1]) && year <= Number(range[2]);
    return Number(part) === year;
  });
}
