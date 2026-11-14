import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { newId } from '@cloudsentry/utilities';
import { parseCookies } from './cookies';
import type { HttpRequest, HttpResponse } from './types';

export function fromApiGateway(event: APIGatewayProxyEventV2): HttpRequest {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(event.headers ?? {})) headers[k.toLowerCase()] = v;
  const body = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body
    : null;
  return {
    method: event.requestContext.http.method.toUpperCase(),
    path: event.rawPath,
    pathParams: {},
    query: { ...(event.queryStringParameters ?? {}) },
    headers,
    cookies: parseCookies(headers.cookie, event.cookies),
    body,
    requestId: event.requestContext.requestId ?? newId.request(),
    sourceIp: event.requestContext.http.sourceIp ?? null,
  };
}

export function toApiGateway(res: HttpResponse): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: res.statusCode,
    headers: res.headers ?? {},
    ...(res.cookies?.length ? { cookies: res.cookies } : {}),
    ...(res.body !== undefined ? { body: JSON.stringify(res.body) } : {}),
  };
}
