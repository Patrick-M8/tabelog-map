import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';

import { derivePlaceStatus } from '../../src/lib/utils/hours';
import type { WeeklyTimeline } from '../../src/lib/types';

const MIDDLE_DOT = '\u00B7';

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
    expect(status.label).toBe('Open');
    expect(status.closesAt).toBe('18:00');
    expect(status.detail).toBe(`Closes 18:00 ${MIDDLE_DOT} L.O. 17:30`);
  });

  it('returns closingSoon when the window is near its end', () => {
    const status = derivePlaceStatus(timeline, DateTime.fromISO('2026-03-16T17:30:00', { zone: 'Asia/Tokyo' }));
    expect(status.state).toBe('closingSoon');
    expect(status.label).toBe('Closing soon');
    expect(status.detail).toBe(`Closes 18:00 ${MIDDLE_DOT} L.O. 17:30`);
  });

  it('uses the next day opening time when today has already ended', () => {
    const status = derivePlaceStatus(timeline, DateTime.fromISO('2026-03-16T20:00:00', { zone: 'Asia/Tokyo' }));
    expect(status.state).toBe('closed');
    expect(status.label).toBe('Closed');
    expect(status.detail).toBe('Opens 09:00');
  });

  it('surfaces the same-day opening time when the place has not opened yet', () => {
    const status = derivePlaceStatus(timeline, DateTime.fromISO('2026-03-16T08:15:00', { zone: 'Asia/Tokyo' }));
    expect(status.state).toBe('closed');
    expect(status.label).toBe('Closed');
    expect(status.opensAt).toBe('09:00');
    expect(status.detail).toBe('Opens 09:00');
  });

  it('includes the next open weekday when the next opening is not tomorrow', () => {
    const sparseTimeline: WeeklyTimeline = {
      mon: [{ open: '09:00', close: '18:00', crossesMidnight: false, lastOrder: null }],
      tue: [],
      wed: [{ open: '11:00', close: '18:00', crossesMidnight: false, lastOrder: null }],
      thu: [],
      fri: [],
      sat: [],
      sun: []
    };

    const status = derivePlaceStatus(sparseTimeline, DateTime.fromISO('2026-03-16T20:00:00', { zone: 'Asia/Tokyo' }));
    expect(status.state).toBe('closed');
    expect(status.detail).toBe('Wed 11:00');
  });
});
