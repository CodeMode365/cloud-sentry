import {
  detectionSettingsRequestSchema,
  notificationPreferencesRequestSchema,
} from '@cloudsentry/validators';
import type { ApiServices } from '../composition';
import { ok, page } from '../http/respond';
import type { Route } from '../http/types';
import { parseBody } from '../http/validation';

export function settingsRoutes(s: () => ApiServices): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/v1/settings/notifications',
      handler: async (_req, ctx) => ok(await s().settings.getNotifications(ctx.auth)),
    },
    {
      method: 'PUT',
      path: '/api/v1/settings/notifications',
      handler: async (req, ctx) =>
        ok(
          await s().settings.putNotifications(ctx.auth, parseBody(notificationPreferencesRequestSchema, req)),
        ),
    },
    {
      method: 'GET',
      path: '/api/v1/settings/detection',
      handler: async (_req, ctx) => ok(await s().settings.getDetection(ctx.auth)),
    },
    {
      method: 'PUT',
      path: '/api/v1/settings/detection',
      handler: async (req, ctx) =>
        ok(await s().settings.putDetection(ctx.auth, parseBody(detectionSettingsRequestSchema, req))),
    },
    {
      method: 'GET',
      path: '/api/v1/rules',
      handler: async () => page(s().settings.rules(), null),
    },
  ];
}
