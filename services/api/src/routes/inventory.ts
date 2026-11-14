import {
  listFindingsQuerySchema,
  listRecommendationsQuerySchema,
  listResourcesQuerySchema,
  updateFindingRequestSchema,
  updateRecommendationRequestSchema,
} from '@cloudsentry/validators';
import type { ApiServices } from '../composition';
import { ok, page } from '../http/respond';
import type { Route } from '../http/types';
import { parseBody, parseQuery, pathParam } from '../http/validation';

export function inventoryRoutes(s: () => ApiServices): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/v1/resources',
      handler: async (req, ctx) => {
        const r = await s().inventory.listResources(ctx.auth, parseQuery(listResourcesQuerySchema, req));
        return page(r.items, r.nextCursor);
      },
    },
    {
      method: 'GET',
      path: '/api/v1/resources/:resourceKey',
      handler: async (req, ctx) =>
        ok(await s().inventory.getResource(ctx.auth, pathParam(req, 'resourceKey'))),
    },
    {
      method: 'GET',
      path: '/api/v1/findings',
      handler: async (req, ctx) => {
        const r = await s().inventory.listFindings(ctx.auth, parseQuery(listFindingsQuerySchema, req));
        return page(r.items, r.nextCursor);
      },
    },
    {
      method: 'GET',
      path: '/api/v1/findings/:findingId',
      handler: async (req, ctx) => ok(await s().inventory.getFinding(ctx.auth, pathParam(req, 'findingId'))),
    },
    {
      method: 'PATCH',
      path: '/api/v1/findings/:findingId',
      handler: async (req, ctx) =>
        ok(
          await s().inventory.updateFinding(
            ctx.auth,
            pathParam(req, 'findingId'),
            parseBody(updateFindingRequestSchema, req),
          ),
        ),
    },
    {
      method: 'GET',
      path: '/api/v1/recommendations',
      handler: async (req, ctx) => {
        const r = await s().inventory.listRecommendations(
          ctx.auth,
          parseQuery(listRecommendationsQuerySchema, req),
        );
        return page(r.items, r.nextCursor);
      },
    },
    {
      method: 'GET',
      path: '/api/v1/recommendations/:recommendationId',
      handler: async (req, ctx) =>
        ok(await s().inventory.getRecommendation(ctx.auth, pathParam(req, 'recommendationId'))),
    },
    {
      method: 'PATCH',
      path: '/api/v1/recommendations/:recommendationId',
      handler: async (req, ctx) =>
        ok(
          await s().inventory.updateRecommendation(
            ctx.auth,
            pathParam(req, 'recommendationId'),
            parseBody(updateRecommendationRequestSchema, req),
          ),
        ),
    },
  ];
}
