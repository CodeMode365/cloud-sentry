import { NodeHttpHandler } from '@smithy/node-http-handler';

/**
 * Default configuration for every AWS SDK v3 client CloudSentry creates.
 * Adaptive retry mode applies exponential backoff with jitter and client-side rate limiting on throttling.
 */
export interface ClientDefaults {
  maxAttempts: number;
  retryMode: 'standard' | 'adaptive';
  requestHandler: NodeHttpHandler;
}

let sharedHandler: NodeHttpHandler | undefined;

export function clientDefaults(
  overrides: Partial<Pick<ClientDefaults, 'maxAttempts' | 'retryMode'>> = {},
): ClientDefaults {
  sharedHandler ??= new NodeHttpHandler({ connectionTimeout: 5_000, requestTimeout: 30_000 });
  return {
    maxAttempts: overrides.maxAttempts ?? 8,
    retryMode: overrides.retryMode ?? 'adaptive',
    requestHandler: sharedHandler,
  };
}

/** AWS Cost Explorer and the Price List API are global services served from us-east-1. */
export const COST_EXPLORER_REGION = 'us-east-1';
export const PRICING_API_REGION = 'us-east-1';
