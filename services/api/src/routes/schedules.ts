import {
  createScheduleRequestSchema,
  listSchedulesQuerySchema,
  updateScheduleRequestSchema,
} from '@cloudsentry/validators';
import type { ApiServices } from '../composition';
import { created, noContent, ok, page } from '../http/respond';
import type { Route } from '../http/types';
import { parseBody, parseQuery, pathParam } from '../http/validation';

export function scheduleRoutes(s: () => ApiServices): Route[] {
  return [
    {
      method: 'POST',
      path: '/api/v1/schedules',
      handler: async (req, ctx) =>
        created(await s().schedules.create(ctx.auth, parseBody(createScheduleRequestSchema, req))),
    },
    {
      method: 'GET',
      path: '/api/v1/schedules',
      handler: async (req, ctx) =>
        page(await s().schedules.list(ctx.auth, parseQuery(listSchedulesQuerySchema, req).accountId), null),
    },
    {
      method: 'GET',
      path: '/api/v1/schedules/:scheduleId',
      handler: async (req, ctx) => ok(await s().schedules.get(ctx.auth, pathParam(req, 'scheduleId'))),
    },
    {
      method: 'PATCH',
      path: '/api/v1/schedules/:scheduleId',
      handler: async (req, ctx) =>
        ok(
          await s().schedules.update(
            ctx.auth,
            pathParam(req, 'scheduleId'),
            parseBody(updateScheduleRequestSchema, req),
          ),
        ),
    },
    {
      method: 'DELETE',
      path: '/api/v1/schedules/:scheduleId',
      handler: async (req, ctx) => {
        await s().schedules.delete(ctx.auth, pathParam(req, 'scheduleId'));
        return noContent();
      },
    },
  ];
}
