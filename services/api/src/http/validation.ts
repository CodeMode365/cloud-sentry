import { z } from '@cloudsentry/validators';
import { ValidationError } from '@cloudsentry/utilities';
import type { HttpRequest } from './types';

const MAX_BODY_BYTES = 64 * 1024;

function zodDetails(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

export function parseBody<T extends z.ZodTypeAny>(schema: T, req: HttpRequest): z.infer<T> {
  if (req.body && Buffer.byteLength(req.body) > MAX_BODY_BYTES)
    throw new ValidationError('Request body is too large');
  const contentType = req.headers['content-type'] ?? '';
  if (req.body && !contentType.toLowerCase().startsWith('application/json')) {
    throw new ValidationError('Content-Type must be application/json');
  }
  let raw: unknown = {};
  if (req.body) {
    try {
      raw = JSON.parse(req.body);
    } catch {
      throw new ValidationError('Request body is not valid JSON');
    }
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new ValidationError('Request validation failed', zodDetails(result.error));
  return result.data as z.infer<T>;
}

export function parseQuery<T extends z.ZodTypeAny>(schema: T, req: HttpRequest): z.infer<T> {
  const result = schema.safeParse(req.query);
  if (!result.success) throw new ValidationError('Invalid query parameters', zodDetails(result.error));
  return result.data as z.infer<T>;
}

export const pathSchemas = {
  accountId: z.string().regex(/^\d{12}$/, 'accountId must be a 12-digit AWS account ID'),
  scanId: z.string().regex(/^scan_[0-9A-HJKMNP-TV-Z]{26}$/, 'Invalid scan ID'),
  findingId: z.string().regex(/^fnd_[0-9a-f]{32}$/, 'Invalid finding ID'),
  recommendationId: z.string().regex(/^rec_[0-9a-f]{32}$/, 'Invalid recommendation ID'),
  scheduleId: z.string().regex(/^sch_\d{12}$/, 'Invalid schedule ID'),
  reportId: z.string().regex(/^rpt_[0-9A-HJKMNP-TV-Z]{26}$/, 'Invalid report ID'),
  resourceKey: z.string().regex(/^[A-Za-z0-9_-]{8,1400}$/, 'Invalid resource key'),
};

export function pathParam(req: HttpRequest, name: keyof typeof pathSchemas): string {
  const result = pathSchemas[name].safeParse(req.pathParams[name]);
  if (!result.success) throw new ValidationError(result.error.issues[0]?.message ?? `Invalid ${name}`);
  return result.data;
}
