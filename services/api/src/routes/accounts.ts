import {
  createAccountRequestSchema,
  updateAccountRequestSchema,
  verifyAccountRequestSchema,
} from '@cloudsentry/validators';
import type { ApiServices } from '../composition';
import { created, noContent, ok, page } from '../http/respond';
import type { Route } from '../http/types';
import { parseBody, pathParam } from '../http/validation';

export function accountRoutes(s: () => ApiServices): Route[] {
  return [
    {
      method: 'POST',
      path: '/api/v1/accounts',
      handler: async (req, ctx) =>
        created(await s().accounts.create(ctx.auth, parseBody(createAccountRequestSchema, req))),
    },
    {
      method: 'GET',
      path: '/api/v1/accounts',
      handler: async (_req, ctx) => page(await s().accounts.list(ctx.auth), null),
    },
    {
      method: 'GET',
      path: '/api/v1/accounts/:accountId',
      handler: async (req, ctx) => ok(await s().accounts.get(ctx.auth, pathParam(req, 'accountId'))),
    },
    {
      method: 'PATCH',
      path: '/api/v1/accounts/:accountId',
      handler: async (req, ctx) =>
        ok(
          await s().accounts.update(
            ctx.auth,
            pathParam(req, 'accountId'),
            parseBody(updateAccountRequestSchema, req),
          ),
        ),
    },
    {
      method: 'DELETE',
      path: '/api/v1/accounts/:accountId',
      handler: async (req, ctx) => {
        await s().accounts.delete(ctx.auth, pathParam(req, 'accountId'));
        return noContent();
      },
    },
    {
      method: 'GET',
      path: '/api/v1/accounts/:accountId/onboarding',
      handler: async (req, ctx) => ok(await s().accounts.onboarding(ctx.auth, pathParam(req, 'accountId'))),
    },
    {
      method: 'POST',
      path: '/api/v1/accounts/:accountId/verify',
      handler: async (req, ctx) => {
        const body = parseBody(verifyAccountRequestSchema, req);
        return ok(await s().accounts.verify(ctx.auth, pathParam(req, 'accountId'), body.roleArn));
      },
    },
  ];
}
