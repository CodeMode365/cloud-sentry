import { analyticsQuerySchema, costAnalyticsQuerySchema } from '@cloudsentry/validators';
import type { ApiServices } from '../composition';
import { ok } from '../http/respond';
import type { Route } from '../http/types';
import { parseQuery } from '../http/validation';

export function analyticsRoutes(s: () => ApiServices): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/v1/analytics/overview',
      handler: async (req, ctx) =>
        ok(await s().analytics.overview(ctx.auth, parseQuery(analyticsQuerySchema, req).accountId)),
    },
    {
      method: 'GET',
      path: '/api/v1/analytics/costs',
      handler: async (req, ctx) =>
        ok(await s().analytics.costs(ctx.auth, parseQuery(costAnalyticsQuerySchema, req))),
    },
    {
      method: 'GET',
      path: '/api/v1/analytics/resources',
      handler: async (req, ctx) =>
        ok(await s().analytics.resources(ctx.auth, parseQuery(analyticsQuerySchema, req).accountId)),
    },
    {
      method: 'GET',
      path: '/api/v1/analytics/savings',
      handler: async (req, ctx) =>
        ok(await s().analytics.savings(ctx.auth, parseQuery(analyticsQuerySchema, req).accountId)),
    },
  ];
}
