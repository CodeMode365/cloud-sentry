import { notEvaluated, type NotEvaluatedOutcome, type ResourceOf } from './types';

export type BackupVault = ResourceOf<'BACKUP_VAULT'>;

/**
 * When recovery point listing failed, discovery records the vault with state "unknown", zero totals and
 * truncated=true. Those zeros are not real, so vault rules are NOT_EVALUATED.
 */
export function vaultListingGate(resource: BackupVault): NotEvaluatedOutcome | null {
  if (resource.state === 'unknown') {
    return notEvaluated('RECOVERY_POINTS_UNAVAILABLE: recovery points could not be listed during discovery');
  }
  return null;
}

/** A truncated listing is a lower bound: it can prove presence, never absence. */
export function truncatedListingReason(resource: BackupVault): string {
  return `TRUNCATED_LISTING: only the first ${resource.attributes.recoveryPointCount} recovery points were listed; absence cannot be concluded`;
}
