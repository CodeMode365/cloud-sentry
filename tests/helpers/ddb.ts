import { createRepositories, ensureLocalTable, type Repositories } from '@cloudsentry/database';
import { randomBytes } from 'node:crypto';

export const DDB_ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';

export async function dynamoAvailable(): Promise<boolean> {
  try {
    const res = await fetch(DDB_ENDPOINT, { method: 'POST', signal: AbortSignal.timeout(1500) });
    return res.status > 0;
  } catch {
    return false;
  }
}

/** Fresh, uniquely named table per test file so suites never share state. */
export async function freshRepositories(label: string): Promise<Repositories> {
  const tableName = `cs-test-${label}-${randomBytes(4).toString('hex')}`;
  await ensureLocalTable(DDB_ENDPOINT, tableName);
  return createRepositories({ tableName, endpoint: DDB_ENDPOINT });
}

export const available = await dynamoAvailable();
if (!available)
  console.warn(
    `DynamoDB Local not reachable at ${DDB_ENDPOINT}; integration suites skipped (run pnpm dev:db).`,
  );
