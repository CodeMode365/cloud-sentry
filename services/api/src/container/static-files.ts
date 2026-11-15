import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/** Same policy as the CloudFront response headers policy (infrastructure/stacks/web-stack.ts). */
export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; '),
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Serves the Next.js static export (trailingSlash: true): `/accounts/` -> `accounts/index.html`,
 * `/accounts` -> 308 to `/accounts/`, unknown paths -> `404.html`. Paths are confined to `root`.
 */
export async function serveStatic(root: string, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD', ...SECURITY_HEADERS }).end();
    return;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, SECURITY_HEADERS).end('Bad request');
    return;
  }
  const base = normalize(root);
  const target = normalize(join(base, pathname));
  if (target !== base && !target.startsWith(base + sep)) {
    res.writeHead(400, SECURITY_HEADERS).end('Bad request');
    return;
  }

  let file: string | null = null;
  if (pathname.endsWith('/')) {
    if (await isFile(join(target, 'index.html'))) file = join(target, 'index.html');
  } else if (await isFile(target)) {
    file = target;
  } else if (!extname(pathname) && (await isDir(target)) && (await isFile(join(target, 'index.html')))) {
    res.writeHead(308, { location: `${url.pathname}/${url.search}`, ...SECURITY_HEADERS }).end();
    return;
  }

  let status = 200;
  if (!file) {
    status = 404;
    file = join(base, '404.html');
    if (!(await isFile(file))) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS }).end('Not found');
      return;
    }
  }
  const info = await stat(file);
  const immutable = url.pathname.startsWith('/_next/static/');
  res.writeHead(status, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': String(info.size),
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...SECURITY_HEADERS,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}
