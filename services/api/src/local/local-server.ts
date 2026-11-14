/**
 * LOCAL DEVELOPMENT SERVER. Serves every API route on http://127.0.0.1:4000 using DynamoDB Local,
 * filesystem artifacts and locally issued JWTs. Scans run in-process against REAL AWS using the
 * developer's credentials; nothing here is deployed.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileSystemArtifactStore } from '@cloudsentry/aws-clients';
import { LocalIdentityProvider, type ReportTrigger } from '@cloudsentry/core';
import { ensureLocalTable } from '@cloudsentry/database';
import { generateReport } from '@cloudsentry/reporting';
import { createWorkerRuntime, type WorkerRuntime } from '@cloudsentry/scanner';
import { createLogger, newId } from '@cloudsentry/utilities';
import { buildApiServices, type ApiServices } from '../composition';
import { parseCookies } from '../http/cookies';
import { Router } from '../http/router';
import type { HttpRequest } from '../http/types';
import { allRoutes } from '../routes';
import { InProcessScanStarter } from './in-process-runner';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const localDir = join(repoRoot, '.local');
mkdirSync(localDir, { recursive: true });

function persistentSecret(): string {
  const file = join(localDir, 'jwt-secret');
  if (!existsSync(file)) writeFileSync(file, randomBytes(48).toString('base64url'), { mode: 0o600 });
  return readFileSync(file, 'utf8').trim();
}

const PORT = Number(process.env.PORT ?? 4000);
const env: NodeJS.ProcessEnv = {
  ...process.env,
  STAGE: 'local',
  AUTH_MODE: 'local',
  TABLE_NAME: process.env.TABLE_NAME ?? 'cloudsentry-local',
  DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
  LOCAL_ARTIFACTS_DIR: join(localDir, 'artifacts'),
  LOCAL_JWT_SECRET: persistentSecret(),
  COOKIE_SECURE: 'false',
  AWS_REGION: process.env.AWS_REGION ?? 'us-east-1',
};
// Make the guard in LocalIdentityProvider see the local stage.
process.env.STAGE = 'local';

const logger = createLogger({ service: 'cloudsentry-local', context: { stage: 'local' } });
const artifacts = new FileSystemArtifactStore(
  env.LOCAL_ARTIFACTS_DIR as string,
  env.LOCAL_JWT_SECRET as string,
  `http://localhost:${PORT}`,
);

let worker: WorkerRuntime | undefined;
const workerRuntime = () => (worker ??= createWorkerRuntime(env, { artifacts, logger }));
const reportTrigger: ReportTrigger = {
  trigger: (request) => {
    setImmediate(() => {
      const rt = workerRuntime();
      void generateReport({ repos: rt.repos, artifacts, logger, now: () => new Date() }, request);
    });
    return Promise.resolve();
  },
};

const services: ApiServices = buildApiServices(env, {
  artifacts,
  logger,
  starter: new InProcessScanStarter(workerRuntime),
  reportTrigger,
  identityProvider: new LocalIdentityProvider(
    join(localDir, 'auth-users.json'),
    env.LOCAL_JWT_SECRET as string,
    logger,
  ),
});
const router = new Router(allRoutes(() => services));

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1024 * 1024) throw new Error('Body too large');
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? Buffer.concat(chunks).toString('utf8') : null;
}

async function serveArtifact(url: URL, res: ServerResponse): Promise<void> {
  const key = url.searchParams.get('key') ?? '';
  const expires = Number(url.searchParams.get('expires'));
  const sig = url.searchParams.get('sig') ?? '';
  if (!artifacts.verifySignature(key, expires, sig)) {
    res.writeHead(403).end('Invalid or expired link');
    return;
  }
  const body = await artifacts.readObject(key);
  const filename = (url.searchParams.get('filename') ?? 'download').replace(/[^\w.-]/g, '_');
  res.writeHead(200, {
    'content-type': url.searchParams.get('contentType') ?? 'application/octet-stream',
    'content-disposition': `attachment; filename="${filename}"`,
  });
  res.end(body);
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    try {
      if (url.pathname === '/api/v1/_local/artifacts') return await serveArtifact(url, res);
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers))
        headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v;
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
      const response = await router.handle(request, {
        logger,
        authenticate: (h) => services.auth.authenticate(h),
      });
      const outHeaders: Record<string, string | string[]> = { ...(response.headers ?? {}) };
      if (response.cookies?.length) outHeaders['set-cookie'] = response.cookies;
      res.writeHead(response.statusCode, outHeaders);
      res.end(response.body === undefined ? undefined : JSON.stringify(response.body));
    } catch (error) {
      logger.error('Local server error', { error });
      res
        .writeHead(500, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Local server error' } }));
    }
  })();
});

await ensureLocalTable(env.DYNAMODB_ENDPOINT as string, env.TABLE_NAME as string);
server.listen(PORT, '127.0.0.1', () => {
  logger.info(`CloudSentry local API listening on http://127.0.0.1:${PORT} (LOCAL DEVELOPMENT ONLY)`, {
    table: env.TABLE_NAME,
    dynamodb: env.DYNAMODB_ENDPOINT,
  });
});
