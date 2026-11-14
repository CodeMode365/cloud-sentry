'use client';

import { BellOff, Check, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { FindingRecord } from '@cloudsentry/shared-types';
import { StatusChangeButton } from '@/components/common/status-dialog';
import { usePermissions } from '@/lib/permissions';
import { useUpdateFinding } from '@/lib/queries';

export function FindingActions({ finding }: { finding: FindingRecord }) {
  const { canOperate } = usePermissions();
  const update = useUpdateFinding();
  if (!canOperate || finding.status === 'RESOLVED') return null;
  const change = (status: 'OPEN' | 'ACKNOWLEDGED' | 'SUPPRESSED') => async (note: string | undefined) => {
    await update.mutateAsync({
      findingId: finding.findingId,
      status,
      ...(note ? { note } : {}),
      expectedVersion: finding.version,
    });
    toast.success('Finding updated');
  };
  return (
    <div className="flex flex-wrap gap-2">
      {finding.status !== 'ACKNOWLEDGED' && (
        <StatusChangeButton
          label="Acknowledge"
          icon={<Check />}
          title="Acknowledge finding"
          description="Marks the finding as seen. It stays active and continues to be re-evaluated on every scan."
          onConfirm={change('ACKNOWLEDGED')}
          pending={update.isPending}
        />
      )}
      {finding.status !== 'SUPPRESSED' && (
        <StatusChangeButton
          label="Suppress"
          icon={<BellOff />}
          title="Suppress finding"
          description="Suppressed findings are excluded from active counts and alerts. Detection continues in the background."
          onConfirm={change('SUPPRESSED')}
          pending={update.isPending}
        />
      )}
      {finding.status !== 'OPEN' && (
        <StatusChangeButton
          label="Reopen"
          icon={<RotateCcw />}
          title="Reopen finding"
          description="Returns the finding to the open state."
          onConfirm={change('OPEN')}
          pending={update.isPending}
        />
      )}
    </div>
  );
}
