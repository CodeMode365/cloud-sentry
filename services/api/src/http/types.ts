import type { AuthContext } from '@cloudsentry/shared-types';
import type { Logger } from '@cloudsentry/utilities';

export interface HttpRequest {
  method: string;
  path: string;
  pathParams: Record<string, string>;
  query: Record<string, string | undefined>;
  /** Lower-cased header names. */
  headers: Record<string, string | undefined>;
  cookies: Record<string, string>;
  body: string | null;
  requestId: string;
  sourceIp: string | null;
}

export interface HttpResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body?: unknown;
  /** Set-Cookie values. */
  cookies?: string[];
}

export interface RequestContext {
  logger: Logger;
  requestId: string;
  /** Present on authenticated routes. */
  auth: AuthContext;
}

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** e.g. /api/v1/accounts/:accountId */
  path: string;
  /** Public routes skip bearer-token verification. Default false. */
  public?: boolean;
  handler: (req: HttpRequest, ctx: RequestContext) => Promise<HttpResponse>;
}
