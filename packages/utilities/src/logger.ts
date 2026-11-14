/**
 * Minimal structured JSON logger. Every line is a single JSON object so CloudWatch Logs Insights
 * can query fields directly. Sensitive keys are redacted recursively before serialization.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY_PATTERN =
  /(password|secret|token|credential|accesskey|secretaccesskey|sessiontoken|authorization|cookie|externalid|apikey|privatekey)/i;

export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(context: LogContext): Logger;
  /** Emits an audit event (always logged regardless of level). */
  audit(action: string, context: LogContext): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  service: string;
  context?: LogContext;
  /** Override for tests. */
  sink?: (line: string) => void;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[MaxDepth]';
  if (value === null || value === undefined) return value;
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_PATTERN.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const e = error as Error & {
      code?: unknown;
      $metadata?: { httpStatusCode?: number; requestId?: string };
    };
    return {
      name: e.name,
      message: e.message,
      ...(e.code !== undefined ? { code: e.code } : {}),
      ...(e.$metadata?.httpStatusCode ? { httpStatusCode: e.$metadata.httpStatusCode } : {}),
      ...(e.$metadata?.requestId ? { awsRequestId: e.$metadata.requestId } : {}),
      stack: e.stack?.split('\n').slice(0, 6).join('\n'),
    };
  }
  return { message: String(error) };
}

class JsonLogger implements Logger {
  constructor(
    private readonly minLevel: LogLevel,
    private readonly service: string,
    private readonly context: LogContext,
    private readonly sink: (line: string) => void,
  ) {}

  private write(level: LogLevel | 'audit', message: string, context?: LogContext): void {
    if (level !== 'audit' && LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level: level === 'audit' ? 'info' : level,
      service: this.service,
      message,
      ...(redact({ ...this.context, ...(context ?? {}) }) as Record<string, unknown>),
      ...(level === 'audit' ? { audit: true } : {}),
    };
    try {
      this.sink(JSON.stringify(entry));
    } catch {
      this.sink(JSON.stringify({ timestamp: entry.timestamp, level, service: this.service, message }));
    }
  }

  debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }
  info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }
  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }
  error(message: string, context?: LogContext): void {
    this.write('error', message, context);
  }
  audit(action: string, context: LogContext): void {
    this.write('audit', `audit:${action}`, { action, ...context });
  }
  child(context: LogContext): Logger {
    return new JsonLogger(this.minLevel, this.service, { ...this.context, ...context }, this.sink);
  }
}

function defaultSink(line: string): void {
  process.stdout.write(`${line}\n`);
}

export function createLogger(options: LoggerOptions): Logger {
  const envLevel = (process.env.LOG_LEVEL ?? '').toLowerCase();
  const level: LogLevel = options.level ?? (envLevel in LEVEL_ORDER ? (envLevel as LogLevel) : 'info');
  return new JsonLogger(level, options.service, options.context ?? {}, options.sink ?? defaultSink);
}

/** Logger that discards output; useful in tests. */
export const silentLogger: Logger = createLogger({
  service: 'silent',
  level: 'error',
  sink: () => undefined,
});
