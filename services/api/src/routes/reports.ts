import { createReportRequestSchema, listReportsQuerySchema } from '@cloudsentry/validators';
import type { ApiServices } from '../composition';
import { accepted, ok, page } from '../http/respond';
import type { Route } from '../http/types';
import { parseBody, parseQuery, pathParam } from '../http/validation';

export function reportRoutes(s: () => ApiServices): Route[] {
  return [
    {
      method: 'POST',
      path: '/api/v1/reports',
      handler: async (req, ctx) =>
        accepted(await s().reports.create(ctx.auth, parseBody(createReportRequestSchema, req))),
    },
    {
      method: 'GET',
      path: '/api/v1/reports',
      handler: async (req, ctx) => {
        const r = await s().reports.list(ctx.auth, parseQuery(listReportsQuerySchema, req));
        return page(r.items, r.nextCursor);
      },
    },
    {
      method: 'GET',
      path: '/api/v1/reports/:reportId',
      handler: async (req, ctx) => ok(await s().reports.get(ctx.auth, pathParam(req, 'reportId'))),
    },
    {
      method: 'GET',
      path: '/api/v1/reports/:reportId/download',
      handler: async (req, ctx) => ok(await s().reports.downloadUrl(ctx.auth, pathParam(req, 'reportId'))),
    },
  ];
}
