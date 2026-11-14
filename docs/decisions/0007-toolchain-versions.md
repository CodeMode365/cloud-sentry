# ADR 0007: Toolchain version pins

Status: accepted (2026-11-14)

TypeScript 5.9, Next.js 15.5, React 19.2, ESLint 9, Vitest 3, Zod 3.25 and cron-parser 4.9 are pinned even though
newer majors exist (TypeScript 7 native compiler, Next 16, ESLint 10, Vitest 5, Zod 4 classic API changes).
The pinned lines are mature and fully supported by typescript-eslint, Next, and the AWS CDK toolchain.
Upgrading is a separate, tested change. pnpm 9 workspaces + Turborepo 2 manage the monorepo; internal packages
export TypeScript sources directly (no build step) and are bundled by esbuild (Lambdas) and Next (web).
