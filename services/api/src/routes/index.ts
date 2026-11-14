import type { ApiServices } from '../composition';
import type { Route } from '../http/types';
import { accountRoutes } from './accounts';
import { analyticsRoutes } from './analytics';
import { authRoutes } from './auth';
import { inventoryRoutes } from './inventory';
import { reportRoutes } from './reports';
import { scanRoutes } from './scans';
import { scheduleRoutes } from './schedules';
import { settingsRoutes } from './settings';

export const ROUTE_GROUPS = {
  auth: authRoutes,
  accounts: accountRoutes,
  scans: scanRoutes,
  inventory: inventoryRoutes,
  analytics: analyticsRoutes,
  schedules: scheduleRoutes,
  reports: reportRoutes,
  settings: settingsRoutes,
} as const;

export type RouteGroup = keyof typeof ROUTE_GROUPS;

export function allRoutes(s: () => ApiServices): Route[] {
  return Object.values(ROUTE_GROUPS).flatMap((group) => group(s));
}
