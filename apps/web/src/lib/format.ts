const currencyFormatters = new Map<string, Intl.NumberFormat>();

export function formatCurrency(
  value: number | null | undefined,
  options: { currency?: string; compact?: boolean; fallback?: string } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return options.fallback ?? '—';
  const currency = options.currency ?? 'USD';
  const key = `${currency}:${options.compact ? 'c' : 'f'}`;
  let fmt = currencyFormatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      notation: options.compact ? 'compact' : 'standard',
      maximumFractionDigits: options.compact ? 1 : 2,
      minimumFractionDigits: options.compact ? 0 : 2,
    });
    currencyFormatters.set(key, fmt);
  }
  return fmt.format(value);
}

export function formatNumber(value: number | null | undefined, maximumFractionDigits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = value;
  let i = 0;
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatMonth(month: string): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return month;
  return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diffMs = d.getTime() - Date.now();
  if (Number.isNaN(diffMs)) return '—';
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const minutes = Math.round(diffMs / 60_000);
  if (abs < 3_600_000) return rtf.format(minutes, 'minute');
  const hours = Math.round(diffMs / 3_600_000);
  if (abs < 86_400_000) return rtf.format(hours, 'hour');
  const days = Math.round(diffMs / 86_400_000);
  if (abs < 30 * 86_400_000) return rtf.format(days, 'day');
  return formatDate(iso);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function truncateMiddle(value: string, max = 28): string {
  if (value.length <= max) return value;
  const keep = Math.floor((max - 1) / 2);
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => (w ? (w[0] ?? '').toUpperCase() + w.slice(1) : w))
    .join(' ');
}
