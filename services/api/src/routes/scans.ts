import { idempotencyKeySchema, listScansQuerySchema, startScanRequestSchema } from '@cloudsentry/validators';
import { ValidationError } from '@cloudsentry/utilities';
import type { ApiServices } from '../composition';
import { accepted, ok, page } from '../http/respond';
import type { Route } from '../http/types';
import { parseBody, parseQuery, pathParam } from '../http/validation';

export function scanRoutes(s: () => ApiServices): Route[] {
  return [
    {
      method: 'POST',
      path: '/api/v1/accounts/:accountId/scans',
      handler: async (req, ctx) => {
        const header = req.headers['idempotency-key'];
        let key: string | undefined;
        if (header !== undefined) {
          const parsed = idempotencyKeySchema.safeParse(header);
          if (!parsed.success)
            throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid Idempotency-Key');
          key = parsed.data;
        }
        const body = parseBody(startScanRequestSchema, req);
        const { scan, created } = await s().scans.startManualScan(
          ctx.auth,
          pathParam(req, 'accountId'),
          body,
          key,
        );
        return created ? accepted(scan) : ok(scan);
      },
    },
    {
      method: 'GET',
      path: '/api/v1/scans',
      handler: async (req, ctx) => {
        const result = await s().scans.list(ctx.auth, parseQuery(listScansQuerySchema, req));
        return page(result.items, result.nextCursor);
      },
    },
    {
      method: 'GET',
      path: '/api/v1/scans/:scanId',
      handler: async (req, ctx) => ok(await s().scans.get(ctx.auth, pathParam(req, 'scanId'))),
    },
    {
      method: 'GET',
      path: '/api/v1/scans/:scanId/results',
      handler: async (req, ctx) => ok(await s().scans.results(ctx.auth, pathParam(req, 'scanId'))),
    },
    {
      method: 'POST',
      path: '/api/v1/scans/:scanId/cancel',
      handler: async (req, ctx) => ok(await s().scans.cancel(ctx.auth, pathParam(req, 'scanId'))),
    },
  ];
}
