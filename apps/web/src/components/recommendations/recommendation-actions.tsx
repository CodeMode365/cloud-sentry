'use client';

import { Check, Eye, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import type { RecommendationRecord } from '@cloudsentry/shared-types';
import { StatusChangeButton } from '@/components/common/status-dialog';
import { usePermissions } from '@/lib/permissions';
import { useUpdateRecommendation } from '@/lib/queries';

type Settable = 'OPEN' | 'UNDER_REVIEW' | 'ACCEPTED' | 'DISMISSED';

export function RecommendationActions({
  recommendation: r,
  size = 'sm',
}: {
  recommendation: RecommendationRecord;
  size?: 'sm' | 'default';
}) {
  const { canOperate } = usePermissions();
  const update = useUpdateRecommendation();
  if (!canOperate || r.status === 'RESOLVED') return null;
  const change = (status: Settable, message: string) => async (note: string | undefined) => {
    await update.mutateAsync({
      recommendationId: r.recommendationId,
      status,
      ...(note ? { note } : {}),
      expectedVersion: r.version,
    });
    toast.success(message);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {r.status !== 'ACCEPTED' && (
        <StatusChangeButton
          size={size}
          variant="default"
          label="Accept"
          icon={<Check />}
          title="Accept recommendation"
          description="Records that your team plans to act on this recommendation. CloudSentry is read-only and will not change any resources; when a later scan no longer detects the issue, the recommendation is resolved and counted as estimated realized savings."
          onConfirm={change('ACCEPTED', 'Recommendation accepted')}
          pending={update.isPending}
        />
      )}
      {r.status !== 'UNDER_REVIEW' && (
        <StatusChangeButton
          size={size}
          label="Under review"
          icon={<Eye />}
          title="Mark as under review"
          description="Signals that the owner is evaluating this recommendation."
          onConfirm={change('UNDER_REVIEW', 'Marked under review')}
          pending={update.isPending}
        />
      )}
      {r.status !== 'DISMISSED' && (
        <StatusChangeButton
          size={size}
          label="Dismiss"
          icon={<X />}
          title="Dismiss recommendation"
          description="Dismissed recommendations are excluded from potential savings and are not re-opened by later scans."
          onConfirm={change('DISMISSED', 'Recommendation dismissed')}
          pending={update.isPending}
        />
      )}
      {r.status !== 'OPEN' && (
        <StatusChangeButton
          size={size}
          variant="ghost"
          label="Reopen"
          icon={<RotateCcw />}
          title="Reopen recommendation"
          description="Returns the recommendation to open."
          onConfirm={change('OPEN', 'Recommendation reopened')}
          pending={update.isPending}
        />
      )}
    </div>
  );
}
