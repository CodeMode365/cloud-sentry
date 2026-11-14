/** Test-only helpers shared by discovery tests. */
import { createLogger, type Logger } from '@cloudsentry/utilities';

export const awsError = (name: string, message = `${name} message`) =>
  Object.assign(new Error(message), { name });

/** Logger that records parsed log lines so tests can assert on warnings. */
export function captureLogger(): { logger: Logger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    service: 'test',
    level: 'debug',
    sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  return { logger, lines };
}

export const warnings = (lines: Record<string, unknown>[]) => lines.filter((l) => l.level === 'warn');
