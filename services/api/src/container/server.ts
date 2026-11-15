/**
 * CloudSentry container server: one Node process serving the static dashboard and the /api/v1 REST API.
 *
 * Configuration is entirely environment-driven (see docs/docker.md):
 * - Local demo (docker-compose.yml): STAGE=local, AUTH_MODE=local, DynamoDB Local, filesystem artifacts,
 *   scans executed in-process with the AWS credentials provided to the container.
 * - AWS-backed: AUTH_MODE=cognito with USER_POOL_* settings, real DynamoDB/S3, and STATE_MACHINE_ARN /
 *   REPORT_FUNCTION_NAME (or SCANS_IN_PROCESS=true to run scans inside the container).
 *
 * The serverless deployment (CDK) does not use this server; it uses the per-domain Lambda handlers.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FileSystemArtifactStore, type ArtifactStore } from '@cloudsentry/aws-clients';
import { LocalIdentityProvider, type ReportTrigger, type ScanWorkflowStarter } from '@cloudsentry/core';
import { ensureLocalTable } from '@cloudsentry/database';
import { generateReport } from '@cloudsentry/reporting';
import { createWorkerRuntime, type WorkerRuntime } from '@cloudsentry/scanner';
import { createLogger, newId, sleep } from '@cloudsentry/utilities';
import { buildApiServices, type ApiOverrides } from '../composition';
import { parseCookies } from '../http/cookies';
import { Router } from '../http/router';
import type { HttpRequest } from '../http/types';
import { InProcessScanStarter } from '../local/in-process-runner';
import { allRoutes } from '../routes';
import { SECURITY_HEADERS, serveStatic } from './static-files';

const env = process.env;
const PORT = Number(env.PORT ?? 8080);
const HOST = env.HOST ?? '0.0.0.0';
const PUBLIC_DIR = resolve(env.PUBLIC_DIR ?? join(process.cwd(), 'public'));
const DATA_DIR = resolve(env.DATA_DIR ?? join(process.cwd(), 'data'));
const MAX_BODY_BYTES = 1024 * 1024;

const logger = createLogger({ service: 'cloudsentry-container', context: { stage: env.STAGE ?? 'unset' } });
const isLocal = env.STAGE === 'local';

/** Local demo only: a JWT signing secret persisted in the data volume so sessions survive restarts. */
function localJwtSecret(): string {
  if (env.LOCAL_JWT_SECRET) return env.LOCAL_JWT_SECRET;
  mkdirSync(DATA_DIR, { recursive: true });
  const file = join(DATA_DIR, 'jwt-secret');
  if (!existsSync(file)) writeFileSync(file, randomBytes(48).toString('base64url'), { mode: 0o600 });
  return readFileSync(file, 'utf8').trim();
}

if (env.AUTH_MODE === 'local') {
  if (!isLocal) throw new Error('AUTH_MODE=local is only allowed with STAGE=local');
  env.LOCAL_JWT_SECRET = localJwtSecret();
}
if (isLocal && !env.ARTIFACTS_BUCKET) env.LOCAL_ARTIFACTS_DIR ??= join(DATA_DIR, 'artifacts');

const publicBaseUrl = env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`;
const fsArtifacts =
  !env.ARTIFACTS_BUCKET && isLocal && env.LOCAL_ARTIFACTS_DIR
    ? new FileSystemArtifactStore(env.LOCAL_ARTIFACTS_DIR, env.LOCAL_JWT_SECRET ?? randomBytes(32).toString('hex'), publicBaseUrl)
    : null;

let worker: WorkerRuntime | undefined;
const workerRuntime = (): WorkerRuntime =>
  (worker ??= createWorkerRuntime(env, { logger, ...(fsArtifacts ? { artifacts: fsArtifacts } : {}) }));

const overrides: ApiOverrides = { logger };
if (fsArtifacts) overrides.artifacts = fsArtifacts;
if (env.AUTH_MODE === 'local') {
  overrides.identityProvider = new LocalIdentityProvider(join(DATA_DIR, 'auth-users.json'), env.LOCAL_JWT_SECRET as string, logger);
}
if (!env.STATE_MACHINE_ARN && env.SCANS_IN_PROCESS === 'true') {
  overrides.starter = new InProcessScanStarter(workerRuntime) satisfies ScanWorkflowStarter;
}
if (!env.REPORT_FUNCTION_NAME) {
  const trigger: ReportTrigger = {
    trigger: (request) => {
      setImmediate(() => {
        const rt = workerRuntime();
        void generateReport({ repos: rt.repos, artifacts: rt.artifacts, logger, now: () => new Date() }, request);
      });
      return Promise.resolve();
    },
  };
  overrides.reportTrigger = trigger;
}

const services = buildApiServices(env, overrides);
const router = new Router(allRoutes(() => services));
let ready = false;
let shuttingDown = false;

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Body too large'), { statusCode: 413 });
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? Buffer.concat(chunks).toString('utf8') : null;
}

async function serveLocalArtifact(store: FileSystemArtifactStore, url: URL, res: ServerResponse): Promise<void> {
  const key = url.searchParams.get('key') ?? '';
  const expires = Number(url.searchParams.get('expires'));
  if (!store.verifySignature(key, expires, url.searchParams.get('sig') ?? '')) {
    res.writeHead(403, SECURITY_HEADERS).end('Invalid or expired link');
    return;
  }
  const body = await store.readObject(key);
  const filename = (url.searchParams.get('filename') ?? 'download').replace(/[^\w.-]/g, '_');
  res.writeHead(200, {
    'content-type': url.searchParams.get('contentType') ?? 'application/octet-stream',
    'content-disposition': `attachment; filename="${filename}"`,
    ...SECURITY_HEADERS,
  });
  res.end(body);
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v;
  const request: HttpRequest = {
    method: (req.method ?? 'GET').toUpperCase(),
    path: url.pathname,
    pathParams: {},
    query: Object.fromEntries(url.searchParams.entries()),
    headers,
    cookies: parseCookies(headers.cookie),
    body: await readBody(req),
    requestId: newId.request(),
    sourceIp: req.socket.remoteAddress ?? null,
  };
  const response = await router.handle(request, { logger, authenticate: (h) => services.auth.authenticate(h) });
  const out: Record<string, string | string[]> = { ...(response.headers ?? {}) };
  if (response.cookies?.length) out['set-cookie'] = response.cookies;
  res.writeHead(response.statusCode, out);
  res.end(response.body === undefined ? undefined : JSON.stringify(response.body));
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://container.local');
    try {
      if (url.pathname === '/healthz') {
        res.writeHead(shuttingDown ? 503 : 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: shuttingDown ? 'stopping' : 'ok' }));
        return;
      }
      if (url.pathname === '/readyz') {
        res.writeHead(ready && !shuttingDown ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ready: ready && !shuttingDown }));
        return;
      }
      if (url.pathname === '/api/v1/_local/artifacts' && fsArtifacts) return await serveLocalArtifact(fsArtifacts, url, res);
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      return await serveStatic(PUBLIC_DIR, req, res, url);
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
      if (statusCode >= 500) logger.error('Unhandled request error', { error, path: url.pathname });
      if (!res.headersSent) {
        res.writeHead(statusCode, { 'content-type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: { code: statusCode === 413 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR', message: statusCode === 413 ? 'Request body is too large' : 'An unexpected error occurred' } }));
      } else res.destroy();
    }
  })();
});
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

/** DynamoDB Local only: create the table on startup, retrying while the database container starts. */
async function prepareDatabase(): Promise<void> {
  if (!env.DYNAMODB_ENDPOINT || env.AUTO_CREATE_TABLE !== 'true') return;
  for (let attempt = 1; ; attempt++) {
    try {
      await ensureLocalTable(env.DYNAMODB_ENDPOINT, env.TABLE_NAME as string);
      return;
    } catch (error) {
      if (attempt >= 30) throw error;
      logger.warn('DynamoDB not reachable yet; retrying', { attempt, endpoint: env.DYNAMODB_ENDPOINT });
      await sleep(2000);
    }
  }
}

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

await prepareDatabase();
server.listen(PORT, HOST, () => {
  ready = true;
  logger.info(`CloudSentry listening on http://${HOST}:${PORT}`, {
    authMode: env.AUTH_MODE ?? 'cognito',
    scans: env.STATE_MACHINE_ARN ? 'step-functions' : env.SCANS_IN_PROCESS === 'true' ? 'in-process' : 'disabled',
    artifacts: env.ARTIFACTS_BUCKET ? 's3' : fsArtifacts ? 'filesystem' : 'none',
    publicDir: PUBLIC_DIR,
  });
});
