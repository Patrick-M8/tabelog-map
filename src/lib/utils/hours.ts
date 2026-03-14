import { DateTime } from 'luxon';

import { CLOSING_SOON_MINUTES } from '$lib/config';
import type { DailyWindow, PlaceStatus, WeeklyTimeline } from '$lib/types';

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const MIDDLE_DOT = '\u00B7';

function minutesFromClock(clock: string) {
  const [hours, minutes] = clock.split(':').map(Number);
  return ((hours === 24 ? 0 : hours) * 60) + minutes;
}

function nowInTokyo(now = DateTime.now()) {
  return now.setZone('Asia/Tokyo');
}

function activeWindows(timeline: WeeklyTimeline, now = DateTime.now()) {
  const tokyoNow = nowInTokyo(now);
  const dayIndex = tokyoNow.weekday - 1;
  const dayKey = DAY_KEYS[dayIndex];
  const previousDayKey = DAY_KEYS[(dayIndex + 6) % 7];
  const currentMinute = (tokyoNow.hour * 60) + tokyoNow.minute;
  const today = timeline[dayKey] ?? [];
  const previous = timeline[previousDayKey] ?? [];
  const combined = [...today, ...previous.filter((window) => window.crossesMidnight)];

  return { combined, currentMinute, today };
}

function opensLaterLabel(windows: DailyWindow[], currentMinute: number) {
  const nextWindow = windows.find((window) => minutesFromClock(window.open) > currentMinute);
  return nextWindow?.open ?? null;
}

function formatStatusDetail({
  closesAt,
  opensAt,
  lastOrderAt,
  state
}: Pick<PlaceStatus, 'closesAt' | 'opensAt' | 'lastOrderAt' | 'state'>) {
  if (state === 'open' || state === 'closingSoon') {
    if (!closesAt) {
      return 'Hours unavailable';
    }

    return lastOrderAt ? `Closes ${closesAt} ${MIDDLE_DOT} L.O. ${lastOrderAt}` : `Closes ${closesAt}`;
  }

  if (opensAt) {
    return `Closed ${MIDDLE_DOT} Opens ${opensAt}`;
  }

  return 'No confirmed hours';
}

export function derivePlaceStatus(timeline: WeeklyTimeline, now = DateTime.now()): PlaceStatus {
  const { combined, currentMinute, today } = activeWindows(timeline, now);

  for (const window of combined) {
    const openMinute = minutesFromClock(window.open);
    const closeMinute = minutesFromClock(window.close);
    const inWindow = window.crossesMidnight
      ? currentMinute >= openMinute || currentMinute < closeMinute
      : currentMinute >= openMinute && currentMinute < closeMinute;

    if (!inWindow) {
      continue;
    }

    const minutesUntilClose = window.crossesMidnight
      ? currentMinute >= openMinute
        ? (24 * 60) - currentMinute + closeMinute
        : closeMinute - currentMinute
      : closeMinute - currentMinute;

    const closingSoon = minutesUntilClose <= CLOSING_SOON_MINUTES;
    const state = closingSoon ? 'closingSoon' : 'open';
    return {
      state,
      label: closingSoon ? 'Closing soon' : 'Open',
      detail: formatStatusDetail({
        state,
        closesAt: window.close,
        opensAt: null,
        lastOrderAt: window.lastOrder
      }),
      closesAt: window.close,
      opensAt: null,
      lastOrderAt: window.lastOrder,
    };
  }

  const nextOpen = opensLaterLabel(today, currentMinute);
  return {
    state: 'closed',
    label: 'Closed',
    detail: formatStatusDetail({
      state: 'closed',
      closesAt: null,
      opensAt: nextOpen,
      lastOrderAt: null
    }),
    closesAt: null,
    opensAt: nextOpen,
    lastOrderAt: null,
  };
}
