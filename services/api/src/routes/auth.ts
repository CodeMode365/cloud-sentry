import { decodeRefreshCookie } from '@cloudsentry/core';
import {
  confirmRegistrationRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resendCodeRequestSchema,
} from '@cloudsentry/validators';
import { ForbiddenError, UnauthorizedError } from '@cloudsentry/utilities';
import type { ApiServices } from '../composition';
import { REFRESH_COOKIE, clearRefreshCookie, refreshCookie } from '../http/cookies';
import { accepted, created, noContent, ok } from '../http/respond';
import type { HttpRequest, Route } from '../http/types';
import { parseBody } from '../http/validation';

/** Cookie-authenticated endpoints require a custom header, which cross-site forms cannot send (CSRF guard). */
function requireClientHeader(req: HttpRequest): void {
  if (req.headers['x-cloudsentry-client'] !== 'web')
    throw new ForbiddenError('Missing X-CloudSentry-Client header');
}

export function authRoutes(s: () => ApiServices): Route[] {
  const secure = () => s().config.COOKIE_SECURE === 'true';
  return [
    {
      method: 'POST',
      path: '/api/v1/auth/register',
      public: true,
      handler: async (req) => created(await s().auth.register(parseBody(registerRequestSchema, req))),
    },
    {
      method: 'POST',
      path: '/api/v1/auth/confirm',
      public: true,
      handler: async (req) => {
        await s().auth.confirm(parseBody(confirmRegistrationRequestSchema, req));
        return ok({ confirmed: true });
      },
    },
    {
      method: 'POST',
      path: '/api/v1/auth/resend-code',
      public: true,
      handler: async (req) => {
        await s().auth.resendCode(parseBody(resendCodeRequestSchema, req).email);
        return accepted({ sent: true });
      },
    },
    {
      method: 'POST',
      path: '/api/v1/auth/login',
      public: true,
      handler: async (req) => {
        const { refreshCookieValue, ...body } = await s().auth.login(parseBody(loginRequestSchema, req));
        return { ...ok(body), cookies: [refreshCookie(refreshCookieValue, secure())] };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/auth/refresh',
      public: true,
      handler: async (req) => {
        requireClientHeader(req);
        const cookie = decodeRefreshCookie(req.cookies[REFRESH_COOKIE]);
        if (!cookie) throw new UnauthorizedError('No active session');
        try {
          return ok(await s().auth.refresh(cookie));
        } catch (error) {
          if (error instanceof UnauthorizedError) {
            return {
              statusCode: 401,
              body: { error: { code: 'UNAUTHORIZED', message: 'Session expired', requestId: req.requestId } },
              cookies: [clearRefreshCookie(secure())],
            };
          }
          throw error;
        }
      },
    },
    {
      method: 'POST',
      path: '/api/v1/auth/logout',
      public: true,
      handler: async (req) => {
        requireClientHeader(req);
        await s().auth.logout(decodeRefreshCookie(req.cookies[REFRESH_COOKIE]));
        return { ...noContent(), cookies: [clearRefreshCookie(secure())] };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/auth/me',
      handler: async (_req, ctx) => ok(await s().auth.me(ctx.auth)),
    },
  ];
}
