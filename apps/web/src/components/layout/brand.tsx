import { CloudCheck } from 'lucide-react';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <CloudCheck className="size-4.5" aria-hidden />
      </span>
      {!compact && <span className="text-base font-semibold tracking-tight">CloudSentry</span>}
    </span>
  );
}
