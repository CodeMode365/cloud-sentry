'use client';

import Link from 'next/link';
import type { RecommendationRecord } from '@cloudsentry/shared-types';
import { LevelBadge, RecommendationStatusBadge, ResourceTypeBadge } from '@/components/common/badges';
import { SavingsAmount } from '@/components/common/savings';
import { ACTION_LABELS } from '@/lib/labels';

/** Compact list used on detail pages. */
export function RecommendationMiniList({ recommendations }: { recommendations: RecommendationRecord[] }) {
  return (
    <ul className="divide-y">
      {recommendations.map((r) => (
        <li
          key={r.recommendationId}
          className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
        >
          <div className="min-w-0 space-y-1">
            <Link
              href={`/recommendations/detail/?id=${encodeURIComponent(r.recommendationId)}`}
              className="line-clamp-1 text-sm font-medium hover:underline"
            >
              {r.title}
            </Link>
            <div className="flex flex-wrap items-center gap-1.5">
              <ResourceTypeBadge type={r.resourceType} />
              <RecommendationStatusBadge status={r.status} />
              <LevelBadge kind="confidence" level={r.confidence} />
              <span className="text-xs text-muted-foreground">{ACTION_LABELS[r.suggestedAction.type]}</span>
            </div>
          </div>
          <SavingsAmount savings={r.savings} className="shrink-0 text-right" />
        </li>
      ))}
    </ul>
  );
}
