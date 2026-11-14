# ADR 0004: Backend-mediated Cognito sign-in with httpOnly refresh cookie

Status: accepted (2026-11-14)

## Decision

`POST /auth/login` calls Cognito `InitiateAuth` (USER_PASSWORD_AUTH) with a confidential app client whose
secret is stored in Secrets Manager. The access token is returned in the body and kept in browser memory; the
refresh token is set only as an `HttpOnly; Secure; SameSite=Strict` cookie scoped to `/api/v1/auth`.
Tenants are provisioned on first login from the pending registration and resolved per request from the
server-side `USER#<sub>` profile (never from token claims or client input).

## Why

The spec requires `/auth/login`, `/auth/logout`, `/auth/me`. Keeping the refresh token out of JavaScript limits
the impact of XSS. Server-side tenant resolution prevents tenant spoofing through writable custom attributes.

## Consequences

Passwords transit the Lambda (TLS end to end; never logged — the logger redacts `password`). MFA and other
challenges are not yet supported (`409 AUTH_CHALLENGE_UNSUPPORTED`). Local development uses a guarded
`LocalIdentityProvider` that cannot run outside `STAGE=local`.
