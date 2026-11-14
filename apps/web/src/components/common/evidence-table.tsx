import type { EvidenceItem } from '@cloudsentry/shared-types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatNumber } from '@/lib/format';

function renderValue(item: EvidenceItem): string {
  if (item.value === null) return 'No data';
  if (typeof item.value === 'boolean') return item.value ? 'Yes' : 'No';
  if (typeof item.value === 'number') return `${formatNumber(item.value)}${item.unit ? ` ${item.unit}` : ''}`;
  return `${item.value}${item.unit ? ` ${item.unit}` : ''}`;
}

export function EvidenceTable({ evidence }: { evidence: EvidenceItem[] }) {
  if (evidence.length === 0) return <p className="text-sm text-muted-foreground">No evidence recorded.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Evidence</TableHead>
          <TableHead>Observed</TableHead>
          <TableHead>Threshold</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {evidence.map((e) => (
          <TableRow key={e.key}>
            <TableCell>{e.label}</TableCell>
            <TableCell className={e.value === null ? 'text-muted-foreground' : 'font-medium tabular-nums'}>
              {renderValue(e)}
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">{e.threshold ?? '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ThresholdList({ thresholds }: { thresholds: Record<string, number> }) {
  const entries = Object.entries(thresholds);
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">No thresholds.</p>;
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
          <dt className="font-mono text-xs text-muted-foreground">{k}</dt>
          <dd className="tabular-nums">{formatNumber(v)}</dd>
        </div>
      ))}
    </dl>
  );
}
