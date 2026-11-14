import type { ApiErrorCode } from '@cloudsentry/shared-types';

/** Base class for expected, classified application errors. Unclassified errors map to INTERNAL_ERROR. */
export class AppError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly httpStatus: number,
    public readonly details?: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code: ApiErrorCode = 'UNAUTHORIZED') {
    super(code, message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super('FORBIDDEN', message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id?: string) {
    super('NOT_FOUND', id ? `${entity} '${id}' was not found` : `${entity} was not found`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super('CONFLICT', message, 409, details);
  }
}

export class PreconditionFailedError extends AppError {
  constructor(message: string, details?: unknown) {
    super('PRECONDITION_FAILED', message, 412, details);
  }
}

export class ThrottledError extends AppError {
  constructor(message = 'Too many requests') {
    super('THROTTLED', message, 429);
  }
}

/** A dependency (AWS API, identity provider) failed in a way the caller cannot fix by changing input. */
export class UpstreamError extends AppError {
  constructor(message: string, details?: unknown, options?: { cause?: unknown }) {
    super('UPSTREAM_ERROR', message, 502, details, options);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Name of an AWS SDK v3 service exception (e.g. "AccessDenied", "ThrottlingException"). */
export function awsErrorName(error: unknown): string | null {
  if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
    return error.name;
  }
  return null;
}

export function isAwsErrorNamed(error: unknown, ...names: string[]): boolean {
  const name = awsErrorName(error);
  return name !== null && names.includes(name);
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

const THROTTLING_ERROR_NAMES = new Set([
  'Throttling',
  'ThrottlingException',
  'ThrottledException',
  'RequestThrottledException',
  'RequestLimitExceeded',
  'TooManyRequestsException',
  'ProvisionedThroughputExceededException',
  'RequestThrottled',
  'SlowDown',
  'LimitExceededException',
  'BandwidthLimitExceeded',
]);

export function isThrottlingError(error: unknown): boolean {
  const name = awsErrorName(error);
  if (name && THROTTLING_ERROR_NAMES.has(name)) return true;
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
  return status === 429;
}

export function isTransientError(error: unknown): boolean {
  if (isThrottlingError(error)) return true;
  const name = awsErrorName(error);
  if (
    name &&
    [
      'InternalError',
      'InternalFailure',
      'ServiceUnavailable',
      'TimeoutError',
      'RequestTimeout',
      'ECONNRESET',
    ].includes(name)
  ) {
    return true;
  }
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
  return status !== undefined && status >= 500;
}
