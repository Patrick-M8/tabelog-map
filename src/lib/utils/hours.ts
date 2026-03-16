import { DateTime } from 'luxon';

import { CLOSING_SOON_MINUTES } from '$lib/config';
import type { ClosureInfo, DailyWindow, LastOrderDetail, PlaceStatus, WeeklyTimeline } from '$lib/types';

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_LABELS: Record<(typeof DAY_KEYS)[number], string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun'
};
const MIDDLE_DOT = '\u00B7';

function minutesFromClock(clock: string, end = false) {
  const [hours, minutes] = clock.split(':').map(Number);
  if (hours === 24) {
    return end ? (24 * 60) + minutes : minutes;
  }
  return (hours * 60) + minutes;
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

  return { combined, currentMinute, today, dayIndex };
}

function formatLastOrder(lastOrderDetail: LastOrderDetail | null, fallback: string | null) {
  if (lastOrderDetail?.food || lastOrderDetail?.drinks) {
    const parts: string[] = [];
    if (lastOrderDetail.food) {
      parts.push(`Food ${lastOrderDetail.food}`);
    }
    if (lastOrderDetail.drinks) {
      parts.push(`Drinks ${lastOrderDetail.drinks}`);
    }
    return parts.join(` ${MIDDLE_DOT} `);
  }

  if (lastOrderDetail?.generic) {
    return lastOrderDetail.generic;
  }

  return fallback;
}

function opensLaterLabel(windows: DailyWindow[], currentMinute: number) {
  const allDayWindow = windows.find((window) => window.allDay);
  if (allDayWindow) {
    return 'Open 24 hours';
  }

  const nextWindow = windows.find((window) => minutesFromClock(window.open) > currentMinute);
  return nextWindow?.open ?? null;
}

function nextOpeningLabel(timeline: WeeklyTimeline, dayIndex: number, currentMinute: number) {
  const todayKey = DAY_KEYS[dayIndex];
  const sameDayOpening = opensLaterLabel(timeline[todayKey] ?? [], currentMinute);
  if (sameDayOpening) {
    return sameDayOpening === 'Open 24 hours' ? sameDayOpening : `Opens ${sameDayOpening}`;
  }

  for (let offset = 1; offset < DAY_KEYS.length; offset += 1) {
    const nextDayKey = DAY_KEYS[(dayIndex + offset) % DAY_KEYS.length];
    const nextWindow = timeline[nextDayKey]?.[0];
    if (!nextWindow) {
      continue;
    }

    if (nextWindow.allDay) {
      return offset === 1 ? 'Open 24 hours' : `${DAY_LABELS[nextDayKey]} Open 24 hours`;
    }

    if (offset === 1) {
      return `Opens ${nextWindow.open}`;
    }

    return `${DAY_LABELS[nextDayKey]} ${nextWindow.open}`;
  }

  return null;
}

function formatStatusDetail({
  allDay,
  closesAt,
  lastOrderAt,
  lastOrderDetail,
  nextOpenLabel,
  state
}: Pick<PlaceStatus, 'closesAt' | 'lastOrderAt' | 'state'> & {
  allDay?: boolean;
  lastOrderDetail?: LastOrderDetail | null;
  nextOpenLabel: string | null;
}) {
  if (state === 'permanentlyClosed') {
    return 'No longer operating';
  }

  if (state === 'temporarilyClosed') {
    return 'Temporarily closed';
  }

  if (state === 'open' || state === 'closingSoon') {
    const lastOrderLabel = formatLastOrder(lastOrderDetail ?? null, lastOrderAt);
    if (allDay) {
      return lastOrderLabel ? `Open 24 hours ${MIDDLE_DOT} L.O. ${lastOrderLabel}` : 'Open 24 hours';
    }

    if (!closesAt) {
      return 'Hours unavailable';
    }

    return lastOrderLabel ? `Closes ${closesAt} ${MIDDLE_DOT} L.O. ${lastOrderLabel}` : `Closes ${closesAt}`;
  }

  return nextOpenLabel ?? 'No confirmed hours';
}

export function derivePlaceStatus(timeline: WeeklyTimeline, closure: ClosureInfo, now = DateTime.now()): PlaceStatus {
  if (closure.state === 'permanentlyClosed') {
    return {
      state: 'permanentlyClosed',
      label: 'Closed permanently',
      detail: closure.reason ? `No longer operating ${MIDDLE_DOT} ${closure.reason}` : 'No longer operating',
      closesAt: null,
      opensAt: null,
      lastOrderAt: null
    };
  }

  if (closure.state === 'temporarilyClosed') {
    return {
      state: 'temporarilyClosed',
      label: 'Temporarily closed',
      detail: closure.reason ? `Temporarily closed ${MIDDLE_DOT} ${closure.reason}` : 'Temporarily closed',
      closesAt: null,
      opensAt: null,
      lastOrderAt: null
    };
  }

  const { combined, currentMinute, today, dayIndex } = activeWindows(timeline, now);

  for (const window of combined) {
    if (window.allDay) {
      return {
        state: 'open',
        label: 'Open 24 hours',
        detail: formatStatusDetail({
          state: 'open',
          allDay: true,
          closesAt: null,
          lastOrderAt: window.lastOrder,
          lastOrderDetail: window.lastOrderDetail,
          nextOpenLabel: null
        }),
        closesAt: null,
        opensAt: null,
        lastOrderAt: window.lastOrder
      };
    }

    const openMinute = minutesFromClock(window.open);
    const closeMinute = minutesFromClock(window.close, true);
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
        allDay: false,
        closesAt: window.close,
        lastOrderAt: window.lastOrder,
        lastOrderDetail: window.lastOrderDetail,
        nextOpenLabel: null
      }),
      closesAt: window.close,
      opensAt: null,
      lastOrderAt: window.lastOrder
    };
  }

  const nextOpen = opensLaterLabel(today, currentMinute);
  return {
    state: 'closed',
    label: 'Closed',
    detail: formatStatusDetail({
      state: 'closed',
      allDay: false,
      closesAt: null,
      lastOrderAt: null,
      lastOrderDetail: null,
      nextOpenLabel: nextOpeningLabel(timeline, dayIndex, currentMinute)
    }),
    closesAt: null,
    opensAt: nextOpen === 'Open 24 hours' ? null : nextOpen,
    lastOrderAt: null
  };
}
