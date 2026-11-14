'use client';

import type { ApiErrorBody, LoginResponse, MeResponse, SessionTokens } from '@cloudsentry/shared-types';
import { useSession } from './auth-store';

export const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[];
export type QueryParams = Record<string, QueryValue>;

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Skip the automatic refresh-and-retry on 401 (used by auth endpoints). */
  noAuthRetry?: boolean;
  /** Do not send the bearer token (public endpoints). */
  anonymous?: boolean;
}

export function buildQuery(query: QueryParams | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'object'
  );
}

async function parseError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON error (e.g. gateway HTML); fall through to a generic message.
  }
  if (isErrorBody(body)) {
    return new ApiError(
      response.status,
      body.error.code,
      body.error.message,
      body.error.details,
      body.error.requestId,
    );
  }
  const fallback =
    response.status === 429
      ? 'Too many requests. Please slow down and try again.'
      : response.status >= 500
        ? 'The CloudSentry API is unavailable. Please try again.'
        : `Request failed with status ${response.status}`;
  return new ApiError(response.status, response.status === 429 ? 'THROTTLED' : 'HTTP_ERROR', fallback);
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Exchanges the httpOnly refresh cookie for a new access token. Concurrent callers share one request.
 * The custom header forces a CORS preflight for cross-origin callers (CSRF guard enforced by the API).
 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CloudSentry-Client': 'web', Accept: 'application/json' },
      });
      if (!response.ok) return false;
      const json = (await response.json()) as { data: SessionTokens & Partial<LoginResponse> };
      const store = useSession.getState();
      store.setSession({
        accessToken: json.data.accessToken,
        expiresIn: json.data.expiresIn,
        ...(json.data.user ? { user: json.data.user } : {}),
        ...(json.data.tenant ? { tenant: json.data.tenant } : {}),
      });
      if (!json.data.user || !json.data.tenant) {
        const me = await request<MeResponse>('GET', '/auth/me', { noAuthRetry: true });
        store.setIdentity(me.user, me.tenant);
      }
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function rawRequest(method: string, path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(options.headers ?? {}) };
  const token = useSession.getState().accessToken;
  if (token && !options.anonymous) headers.Authorization = `Bearer ${token}`;
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  return fetch(`${API_BASE}${path}${buildQuery(options.query)}`, {
    method,
    headers,
    body,
    credentials: 'include',
    signal: options.signal,
  });
}

async function send(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
  let response = await rawRequest(method, path, options);
  if (response.status === 401 && !options.noAuthRetry && !options.anonymous) {
    const refreshed = await refreshSession();
    if (refreshed) {
      response = await rawRequest(method, path, options);
    }
    if (response.status === 401) {
      useSession.getState().clearSession();
    }
  }
  if (!response.ok) throw await parseError(response);
  return response;
}

/** Calls an endpoint returning `{ data: T }` (or 204) and resolves to `data`. */
export async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(method, path, options);
  if (response.status === 204) return undefined as T;
  const json = (await response.json()) as { data: T };
  return json.data;
}

/** Calls a list endpoint returning `{ data: T[], nextCursor }`. */
export async function requestPage<T>(
  path: string,
  query?: QueryParams,
  signal?: AbortSignal,
): Promise<Page<T>> {
  const response = await send('GET', path, { query, signal });
  const json = (await response.json()) as { data: T[]; nextCursor?: string | null };
  return { data: json.data, nextCursor: json.nextCursor ?? null };
}

/** Follows cursors until exhausted (bounded) — for small collections such as accounts and schedules. */
export async function requestAll<T>(path: string, query: QueryParams = {}, maxPages = 20): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await requestPage<T>(path, { ...query, limit: 100, cursor });
    out.push(...page.data);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

export const api = {
  get: <T>(path: string, query?: QueryParams, signal?: AbortSignal) =>
    request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>('POST', path, { body, headers }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, { body }),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, { body }),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
  page: requestPage,
  all: requestAll,
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}
