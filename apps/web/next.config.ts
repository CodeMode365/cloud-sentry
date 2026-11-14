import path from 'node:path';
import type { NextConfig } from 'next';

const isProductionBuild = process.env.NODE_ENV === 'production';
const apiProxyTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

/**
 * Production builds are a static export (served from S3 + CloudFront, with /api/* routed to API Gateway
 * on the same origin). In development, /api/* is proxied to the local API server so the httpOnly
 * refresh cookie stays same-origin.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ['@cloudsentry/shared-types', '@cloudsentry/validators'],
  poweredByHeader: false,
  // Lets a production build run alongside a running `next dev` without sharing (and corrupting) `.next`.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Monorepo root (scripts run from apps/web); prevents Next from picking up unrelated parent lockfiles.
  outputFileTracingRoot: path.join(process.cwd(), '..', '..'),
  // Linting runs through the monorepo ESLint flat config (`pnpm lint`), not during `next build`.
  eslint: { ignoreDuringBuilds: true },
  ...(isProductionBuild
    ? { output: 'export' as const }
    : {
        // Without this, trailingSlash would 308-redirect /api/v1/... to /api/v1/.../ before the proxy rewrite.
        skipTrailingSlashRedirect: true,
        async rewrites() {
          return [{ source: '/api/:path*', destination: `${apiProxyTarget}/api/:path*` }];
        },
      }),
};

export default nextConfig;
