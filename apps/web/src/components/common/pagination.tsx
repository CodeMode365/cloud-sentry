'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Cursor pagination state. The API returns opaque `nextCursor` values; a stack of previously used
 * cursors supports moving back.
 */
export function useCursorPagination(resetKey: string) {
  const [stack, setStack] = React.useState<(string | undefined)[]>([undefined]);
  const [lastKey, setLastKey] = React.useState(resetKey);
  if (lastKey !== resetKey) {
    setLastKey(resetKey);
    setStack([undefined]);
  }
  const cursor = stack[stack.length - 1];
  return {
    cursor,
    page: stack.length,
    canPrev: stack.length > 1,
    next: (nextCursor: string) => setStack((s) => [...s, nextCursor]),
    prev: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
  };
}

export function PaginationBar({
  page,
  canPrev,
  nextCursor,
  onPrev,
  onNext,
  count,
  loading,
}: {
  page: number;
  canPrev: boolean;
  nextCursor: string | null | undefined;
  onPrev: () => void;
  onNext: (cursor: string) => void;
  count: number;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
      <span>
        Page {page} · {count} item{count === 1 ? '' : 's'}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onPrev}
          disabled={!canPrev || loading}
          aria-label="Previous page"
        >
          <ChevronLeft /> Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => nextCursor && onNext(nextCursor)}
          disabled={!nextCursor || loading}
          aria-label="Next page"
        >
          Next <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
