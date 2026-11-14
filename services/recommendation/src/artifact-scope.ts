import type { ArtifactEnvelope, ScanWorkflowState } from '@cloudsentry/shared-types';

export class MissingStepInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingStepInput';
  }
}

/** Throws when an artifact envelope does not belong to the scan being processed (tenant isolation guard). */
export function assertEnvelopeScope(
  envelope: ArtifactEnvelope<unknown>,
  state: ScanWorkflowState,
  key: string,
): void {
  if (
    envelope.schemaVersion !== 1 ||
    envelope.tenantId !== state.tenantId ||
    envelope.accountId !== state.accountId ||
    envelope.scanId !== state.scanId
  ) {
    throw new Error(`Artifact ${key} does not belong to scan ${state.scanId}`);
  }
}

export function envelopeFor<T>(state: ScanWorkflowState, createdAt: Date, data: T): ArtifactEnvelope<T> {
  return {
    schemaVersion: 1,
    tenantId: state.tenantId,
    accountId: state.accountId,
    scanId: state.scanId,
    createdAt: createdAt.toISOString(),
    data,
  };
}
