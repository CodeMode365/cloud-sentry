# CloudSentry Web

Next.js (App Router) dashboard for CloudSentry. Production builds are a **static export** (`out/`) served from
S3 + CloudFront, with `/api/*` routed to API Gateway on the same origin. There is no Next.js server in production.

## Local development

```bash
# from the repository root
pnpm dev:db        # DynamoDB Local (docker)
pnpm dev:api       # local API server on http://localhost:4000
pnpm dev:web       # dashboard on http://localhost:3000
```

In development, `next dev` proxies `/api/*` to the local API so the httpOnly refresh cookie stays same-origin.
Point the proxy elsewhere with `API_PROXY_TARGET`:

```bash
API_PROXY_TARGET=https://dev.example.com pnpm dev:web
```

## Build

```bash
pnpm --filter @cloudsentry/web build   # writes apps/web/out/
```

Do not run `build` while `pnpm dev:web` is running: both use `.next/`, and the dev server breaks until restarted.
To check a production build next to a running dev server, use a separate directory (output is written there, not
to `out/`):

```bash
NEXT_DIST_DIR=.next-verify pnpm --filter @cloudsentry/web build && rm -rf apps/web/.next-verify
```

`trailingSlash` is enabled, so routes export as `<route>/index.html`. Detail pages use query parameters
(`/resources/detail/?key=…`, `/findings/detail/?id=…`, `/recommendations/detail/?id=…`, `/scans/detail/?id=…`,
`/accounts/detail/?id=…`) because a static export cannot serve dynamic segments.

## Authentication model

- `POST /api/v1/auth/login` returns a short-lived access token (kept **in memory only**) and sets an httpOnly refresh
  cookie.
- On page load the app calls `POST /api/v1/auth/refresh` (with `X-CloudSentry-Client: web`) to restore the session.
- On a 401 the client refreshes once and retries; if that fails the session is cleared and the user is sent to `/login/`.

## Data honesty

- No mock data is rendered. Empty states explain how to get data (connect an account, run a scan).
- Spend comes from AWS Cost Explorer and is labelled "Billed"; open-period values are labelled "unfinalized".
- Savings are always labelled as estimates; upper-bound estimates render as "up to"; unavailable estimates show the reason.
- Missing CloudWatch data renders as "No data", never as zero.
- Accounts with `dataSource: SYNTHETIC` (local seed only) carry a "Synthetic data" badge and trigger a global banner.

## Lint / typecheck

```bash
pnpm --filter @cloudsentry/web typecheck
cd apps/web && npx eslint .
```
