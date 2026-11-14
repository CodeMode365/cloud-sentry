import type { HttpResponse } from './types';

export const ok = <T>(data: T, statusCode = 200): HttpResponse => ({ statusCode, body: { data } });
export const created = <T>(data: T): HttpResponse => ok(data, 201);
export const accepted = <T>(data: T): HttpResponse => ok(data, 202);
export const noContent = (): HttpResponse => ({ statusCode: 204 });
export const page = <T>(items: T[], nextCursor: string | null): HttpResponse => ({
  statusCode: 200,
  body: { data: items, nextCursor },
});
