# ADR 0003: Static Next.js export behind CloudFront, API on the same origin

Status: accepted (2026-11-14)

## Decision

The dashboard is a static export (`output: 'export'`) served from a private S3 bucket through CloudFront (OAC).
CloudFront routes `/api/*` to the HTTP API. Detail pages use query parameters instead of dynamic segments.

## Why

No web servers to run or patch; the dashboard is fully client-rendered against the API anyway. Same origin
means no CORS configuration and allows an `HttpOnly; SameSite=Strict` refresh cookie (ADR 0004).

## Consequences

No server-side rendering or Next.js middleware. A CloudFront Function maps directory URIs to `index.html`.
