import type { ScanExecution } from '@cloudsentry/shared-types';
import { describe, expect, it } from 'vitest';
import { shouldPollScan } from './queries';

const NOW = Date.parse('2026-11-15T10:44:20.000Z');

function scan(overrides: Partial<ScanExecution>): ScanExecution {
  return { status: 'RUNNING', steps: {}, completedAt: null, ...overrides } as ScanExecution;
}

describe('shouldPollScan', () => {
  it('polls while the scan is still running', () => {
    expect(shouldPollScan(scan({ status: 'RUNNING' }), NOW)).toBe(true);
  });

  it('keeps polling a just-completed scan until SendNotifications settles', () => {
    const completedAt = '2026-11-15T10:44:14.436Z';
    const running = { status: 'RUNNING', startedAt: completedAt, completedAt: null, message: null } as const;
    expect(shouldPollScan(scan({ status: 'PARTIALLY_COMPLETED', completedAt }), NOW)).toBe(true);
    expect(
      shouldPollScan(scan({ status: 'COMPLETED', completedAt, steps: { SendNotifications: running } }), NOW),
    ).toBe(true);
    expect(
      shouldPollScan(
        scan({
          status: 'COMPLETED',
          completedAt,
          steps: { SendNotifications: { ...running, status: 'SUCCEEDED', completedAt: completedAt } },
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it('stops polling once the settle window has passed', () => {
    const completedAt = '2026-11-15T10:40:00.000Z';
    expect(shouldPollScan(scan({ status: 'COMPLETED', completedAt }), NOW)).toBe(false);
  });

  it('does not wait for notifications on failed or cancelled scans', () => {
    const completedAt = '2026-11-15T10:44:14.436Z';
    expect(shouldPollScan(scan({ status: 'FAILED', completedAt }), NOW)).toBe(false);
    expect(shouldPollScan(scan({ status: 'CANCELLED', completedAt }), NOW)).toBe(false);
  });
});
