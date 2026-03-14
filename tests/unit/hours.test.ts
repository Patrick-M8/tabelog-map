import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';

import { derivePlaceStatus } from '../../src/lib/utils/hours';
import type { WeeklyTimeline } from '../../src/lib/types';

const timeline: WeeklyTimeline = {
  mon: [{ open: '09:00', close: '18:00', crossesMidnight: false, lastOrder: '17:30' }],
  tue: [{ open: '09:00', close: '18:00', crossesMidnight: false, lastOrder: '17:30' }],
  wed: [{ open: '09:00', close: '18:00', crossesMidnight: false, lastOrder: '17:30' }],
  thu: [{ open: '09:00', close: '18:00', crossesMidnight: false, lastOrder: '17:30' }],
  fri: [{ open: '09:00', close: '18:00', crossesMidnight: false, lastOrder: '17:30' }],
  sat: [],
  sun: []
};

describe('derivePlaceStatus', () => {
  it('returns open while within the current window', () => {
    const status = derivePlaceStatus(timeline, DateTime.fromISO('2026-03-16T12:00:00', { zone: 'Asia/Tokyo' }));
    expect(status.state).toBe('open');
    expect(status.closesAt).toBe('18:00');
  });

  it('returns closingSoon when the window is near its end', () => {
    const status = derivePlaceStatus(timeline, DateTime.fromISO('2026-03-16T17:30:00', { zone: 'Asia/Tokyo' }));
    expect(status.state).toBe('closingSoon');
    expect(status.label).toContain('Closing');
  });

  it('returns closed when there is no window later in the day', () => {
    const status = derivePlaceStatus(timeline, DateTime.fromISO('2026-03-16T20:00:00', { zone: 'Asia/Tokyo' }));
    expect(status.state).toBe('closed');
  });
});
