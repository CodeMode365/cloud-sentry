import type { AuthContext } from '@cloudsentry/shared-types';
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  serializeError,
  type Logger,
} from '@cloudsentry/utilities';
import type { HttpRequest, HttpResponse, Route } from './types';

interface CompiledRoute extends Route {
  regex: RegExp;
  keys: string[];
}

export type Authenticator = (authorizationHeader: string | undefined) => Promise<AuthContext>;

const BASE_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export class Router {
  private readonly routes: CompiledRoute[];

  constructor(routes: Route[]) {
    this.routes = routes.map((r) => {
      const keys: string[] = [];
      const pattern = r.path.replace(/:([A-Za-z]+)/g, (_m, key: string) => {
        keys.push(key);
        return '([^/]+)';
      });
      return { ...r, regex: new RegExp(`^${pattern}/?$`), keys };
    });
  }

  match(
    method: string,
    path: string,
  ): { route: CompiledRoute; params: Record<string, string> } | { methodNotAllowed: true } | null {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.regex.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1] ?? '');
      });
      return { route, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }

  async handle(
    req: HttpRequest,
    deps: { logger: Logger; authenticate: Authenticator },
  ): Promise<HttpResponse> {
    const started = Date.now();
    const correlationId = req.headers['x-correlation-id']?.slice(0, 128) ?? req.requestId;
    const logger = deps.logger.child({
      requestId: req.requestId,
      correlationId,
      method: req.method,
      path: req.path,
    });
    let response: HttpResponse;
    let tenantId: string | undefined;
    try {
      const matched = this.match(req.method, req.path);
      if (!matched) throw new NotFoundError('Route');
      if ('methodNotAllowed' in matched) {
        response = {
          statusCode: 405,
          body: { error: { code: 'NOT_FOUND', message: 'Method not allowed', requestId: req.requestId } },
        };
      } else {
        req.pathParams = matched.params;
        let auth: AuthContext | undefined;
        if (!matched.route.public) {
          auth = await deps.authenticate(req.headers.authorization);
          tenantId = auth.tenantId;
        }
        const reqLogger = auth ? logger.child({ tenantId: auth.tenantId, userId: auth.userId }) : logger;
        response = await matched.route.handler(req, {
          logger: reqLogger,
          requestId: req.requestId,
          auth: auth ?? (undefined as unknown as AuthContext),
        });
      }
    } catch (error) {
      response = toErrorResponse(error, req.requestId, logger);
    }
    response.headers = { ...BASE_HEADERS, 'x-request-id': req.requestId, ...(response.headers ?? {}) };
    logger.info('request', {
      statusCode: response.statusCode,
      latencyMs: Date.now() - started,
      ...(tenantId ? { tenantId } : {}),
    });
    return response;
  }
}

export function toErrorResponse(error: unknown, requestId: string, logger: Logger): HttpResponse {
  if (error instanceof AppError) {
    if (error.httpStatus >= 500)
      logger.error('Request failed', { error: serializeError(error), cause: serializeError(error.cause) });
    else logger.warn('Request rejected', { code: error.code, message: error.message });
    return {
      statusCode: error.httpStatus,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
          requestId,
        },
      },
      ...(error instanceof UnauthorizedError ? { headers: { 'www-authenticate': 'Bearer' } } : {}),
    };
  }
  logger.error('Unhandled error', { error: serializeError(error) });
  return {
    statusCode: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId } },
  };
}
