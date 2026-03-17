from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime

from .constants import DAY_ABBR, DAY_ALIASES, DAY_ORDER, GENERIC_HOURS_NOTICE, SPECIAL_DAY_ALIASES

DAY_RANGE_RE = re.compile(r"([A-Za-z]{3,9})\s*[-~]\s*([A-Za-z]{3,9})")
TIME_RANGE_RE = re.compile(r"(?P<start>\d{1,2}:\d{2})\s*[-~]\s*(?P<end>\d{1,2}:\d{2})")
LAST_ORDER_RE = re.compile(r"(?i)LO\s*(?:(?P<kind>Food|Foods?|Drink|Drinks?)\s*)?(?P<time>\d{1,2}:\d{2})")
ALL_DAY_RE = re.compile(r"(?i)(open\s*24\s*hours|24\s*hours|24h|24時間(?:営業)?|24時間オープン)")
WHITESPACE_RE = re.compile(r"\s+")


def normalize_text(text: str | None):
    value = text or ""
    return (
        value.replace("〜", "-")
        .replace("～", "-")
        .replace("—", "-")
        .replace("–", "-")
        .replace(" to ", "-")
        .replace("L.O.", "LO")
        .replace("L.O", "LO")
        .replace("L O", "LO")
        .strip()
    )


def normalize_clock(clock: str):
    hours, minutes = [int(part) for part in clock.split(":")]
    return f"{hours:02d}:{minutes:02d}"


def minutes_value(clock: str, *, end: bool = False):
    hours, minutes = [int(part) for part in clock.split(":")]
    if hours == 24:
        return (24 * 60) if end else 0
    return (hours * 60) + minutes


def last_order_summary(last_order_detail: dict[str, str] | None):
    if not last_order_detail:
        return None

    if last_order_detail.get("generic"):
        return last_order_detail["generic"]

    values = [value for value in last_order_detail.values() if value]
    if not values:
        return None

    return min(values, key=lambda value: minutes_value(value))


def all_day_window():
    return {
        "open": "00:00",
        "close": "24:00",
        "crossesMidnight": False,
        "allDay": True,
        "lastOrder": None,
        "lastOrderDetail": None,
    }


def parse_time_ranges(detail: str | None):
    text = normalize_text(detail)
    if not text:
        return []

    if ALL_DAY_RE.search(text):
        return [all_day_window()]

    ranges = list(TIME_RANGE_RE.finditer(text))
    if not ranges:
        return []

    last_orders = list(LAST_ORDER_RE.finditer(text))
    windows = []
    for index, match in enumerate(ranges):
        start = normalize_clock(match.group("start"))
        end = normalize_clock(match.group("end"))
        next_range_start = ranges[index + 1].start() if index + 1 < len(ranges) else float("inf")
        last_order_detail: dict[str, str] = {}

        for lo_match in last_orders:
            if not (match.start() <= lo_match.start() < next_range_start):
                continue
            kind = (lo_match.group("kind") or "generic").lower()
            value = normalize_clock(lo_match.group("time"))
            if "drink" in kind:
                last_order_detail["drinks"] = value
            elif "food" in kind:
                last_order_detail["food"] = value
            else:
                last_order_detail["generic"] = value

        all_day = start == "00:00" and end == "24:00"
        windows.append(
            {
                "open": start,
                "close": end,
                "crossesMidnight": False if all_day else minutes_value(end, end=True) <= minutes_value(start),
                "allDay": all_day,
                "lastOrder": last_order_summary(last_order_detail or None),
                "lastOrderDetail": last_order_detail or None,
            }
        )
    return windows


def parse_title_days(title: str | None):
    value = normalize_text(title)
    if not value:
        return [], set(), []

    weekday_days: list[str] = []
    special_days: set[str] = set()
    raw_policies: list[str] = []
    for chunk in [part.strip() for part in value.split(",") if part.strip()]:
        key = chunk.lower()
        if key in DAY_ALIASES:
            weekday_days.append(DAY_ALIASES[key])
            continue
        if key in SPECIAL_DAY_ALIASES:
            special_days.add(SPECIAL_DAY_ALIASES[key])
            continue

        match = DAY_RANGE_RE.search(key)
        if match:
            start = DAY_ALIASES.get(match.group(1).lower())
            end = DAY_ALIASES.get(match.group(2).lower())
            if start is not None and end is not None:
                start_index = DAY_ORDER.index(start)
                end_index = DAY_ORDER.index(end)
                if start_index <= end_index:
                    weekday_days.extend(DAY_ORDER[start_index : end_index + 1])
                else:
                    weekday_days.extend(DAY_ORDER[start_index:] + DAY_ORDER[: end_index + 1])
                continue
        raw_policies.append(chunk)

    return list(dict.fromkeys(weekday_days)), special_days, raw_policies


def is_explicit_closed(detail: str | None):
    text = normalize_text(detail).lower()
    if not text:
        return False
    if ALL_DAY_RE.search(text):
        return False
    return text == "closed" or ("closed" in text and not TIME_RANGE_RE.search(text))


def _group_days(days: list[str]):
    if not days:
        return ""
    ordered = sorted(set(days), key=lambda day: DAY_ORDER.index(day))
    groups: list[list[str]] = []
    current = [ordered[0]]
    for day in ordered[1:]:
        expected = DAY_ORDER.index(current[-1]) + 1
        if DAY_ORDER.index(day) == expected:
            current.append(day)
        else:
            groups.append(current)
            current = [day]
    groups.append(current)
    parts = []
    for group in groups:
        if len(group) == 1:
            parts.append(DAY_ABBR[group[0]])
        else:
            parts.append(f"{DAY_ABBR[group[0]]}-{DAY_ABBR[group[-1]]}")
    return ", ".join(parts)


def window_label(window: dict):
    if window.get("allDay"):
        return "Open 24 hours"

    base = f"{window['open']}-{window['close']}"
    last_order_detail = window.get("lastOrderDetail") or {}
    lo_parts = []
    if last_order_detail.get("food"):
        lo_parts.append(f"Food {last_order_detail['food']}")
    if last_order_detail.get("drinks"):
        lo_parts.append(f"Drinks {last_order_detail['drinks']}")
    if last_order_detail.get("generic") and not lo_parts:
        lo_parts.append(last_order_detail["generic"])
    if lo_parts:
        return f"{base} (L.O. {' / '.join(lo_parts)})"
    return base


def compact_today(blocks_for_day: list[dict]):
    if not blocks_for_day:
        return "Closed"
    if any(block.get("allDay") for block in blocks_for_day):
        return "Open 24 hours"

    labels = []
    for block in blocks_for_day:
        labels.append(window_label(block))
    if len(blocks_for_day) >= 2:
        first = blocks_for_day[0]
        second = blocks_for_day[1]
        if not first.get("allDay") and not second.get("allDay"):
            labels.insert(1, f"Break {first['close']}-{second['open']}")
    return " · ".join(labels)


def week_compact_pretty(weekly: dict[str, list[dict]]):
    by_signature: dict[str, list[str]] = defaultdict(list)
    signatures: dict[str, list[dict]] = {}
    for day in DAY_ORDER:
        blocks = weekly.get(day) or []
        if not blocks:
            signature = "closed"
        else:
            signature = "||".join(
                [
                    "|".join(
                        [
                            block["open"],
                            block["close"],
                            "all-day" if block.get("allDay") else "",
                            "crosses" if block.get("crossesMidnight") else "",
                            ",".join(
                                f"{key}:{value}"
                                for key, value in sorted((block.get("lastOrderDetail") or {}).items())
                            ),
                        ]
                    )
                    for block in blocks
                ]
            )
        by_signature[signature].append(day)
        signatures[signature] = blocks

    parts = []
    for signature, days in by_signature.items():
        if signature == "closed":
            parts.append(f"{_group_days(days)} closed")
            continue
        parts.append(f"{_group_days(days)} " + " · ".join(window_label(block) for block in signatures[signature]))
    return "; ".join(parts)


def _open_window_status(window: dict, current_minute: int):
    if window.get("allDay"):
        return {"isOpen": True, "minutesUntilClose": None}

    start = minutes_value(window["open"])
    end = minutes_value(window["close"], end=True)
    crosses = window.get("crossesMidnight", False)
    if not crosses:
        if start <= current_minute < end:
            return {"isOpen": True, "minutesUntilClose": end - current_minute}
        return {"isOpen": False, "minutesUntilClose": None}

    if current_minute >= start:
        return {"isOpen": True, "minutesUntilClose": (24 * 60) - current_minute + end}
    if current_minute < end:
        return {"isOpen": True, "minutesUntilClose": end - current_minute}
    return {"isOpen": False, "minutesUntilClose": None}


def summarize_for_today(weekly: dict[str, list[dict]], local_now: datetime):
    day_key = DAY_ORDER[local_now.weekday()]
    current_minute = (local_now.hour * 60) + local_now.minute
    todays_windows = list(weekly.get(day_key) or [])

    previous_day_key = DAY_ORDER[(local_now.weekday() - 1) % len(DAY_ORDER)]
    for previous in weekly.get(previous_day_key) or []:
        if previous.get("crossesMidnight") and not previous.get("allDay"):
            carried = dict(previous)
            carried["carriedFromPrevious"] = True
            todays_windows.append(carried)

    for window in todays_windows:
        state = _open_window_status(window, current_minute)
        if not state["isOpen"]:
            continue
        last_order = window.get("lastOrder")
        return compact_today(weekly.get(day_key) or []), {
            "status": "open",
            "segment": {
                "start": window["open"],
                "end": window["close"],
                "allDay": bool(window.get("allDay")),
                "last_order": last_order,
                "last_order_detail": window.get("lastOrderDetail"),
            },
            "closes_in_min": state["minutesUntilClose"],
            "lo_in_min": None if not last_order else max(minutes_value(last_order, end=True) - current_minute, 0),
            "crosses_midnight": bool(window.get("crossesMidnight")),
        }

    future_windows = sorted(
        [window for window in weekly.get(day_key) or [] if minutes_value(window["open"]) > current_minute],
        key=lambda window: minutes_value(window["open"]),
    )
    opens_in = None
    if future_windows:
        opens_in = minutes_value(future_windows[0]["open"]) - current_minute
    return compact_today(weekly.get(day_key) or []), {"status": "closed", "opens_in_min": opens_in}


def hours_confidence(weekly: dict[str, list[dict]], advisories: list[str], policies: list[str]):
    covered_days = sum(1 for windows in weekly.values() if windows)
    if covered_days == 0:
        return "low"

    advisory_blob = " ".join([*advisories, *policies]).lower()
    if "not fixed" in advisory_blob or "irregular" in advisory_blob or "hours vary" in advisory_blob:
        return "low"
    if covered_days >= 5 and not advisories:
        return "high"
    return "medium"


def _structured_business_hours(notes_structured: dict | None):
    if not isinstance(notes_structured, dict):
        return []
    business_hours = notes_structured.get("business_hours")
    if not isinstance(business_hours, dict):
        return []

    policies = []
    for label, mapping in business_hours.items():
        if not isinstance(mapping, dict) or not mapping:
            continue
        summary = ", ".join(f"{key} {value}" for key, value in mapping.items())
        policies.append(f"{label}: {summary}")
    return policies


def build_hours_payload(hours_raw: list[dict] | None, notes_structured: dict | None = None, *, now: datetime | None = None):
    weekly = {day: [] for day in DAY_ORDER}
    special_days = {key: [] for key in SPECIAL_DAY_ALIASES.values()}
    weekly_closed: set[str] = set()
    special_closed: set[str] = set()
    advisories: list[str] = []
    notices: list[str] = []
    raw_policies: list[str] = []

    for entry in hours_raw or []:
        title = entry.get("title") or entry.get("list_title") or ""
        detail = normalize_text(entry.get("dtl") or entry.get("dtl_text") or entry.get("dtlText") or "")
        notice = entry.get("open_closed_notice")
        if notice and notice != GENERIC_HOURS_NOTICE:
            notices.append(notice)

        weekdays, special_keys, title_policies = parse_title_days(title)
        raw_policies.extend(title_policies)
        if not title:
            continue

        if is_explicit_closed(detail):
            weekly_closed.update(weekdays)
            special_closed.update(special_keys)
            continue

        blocks = parse_time_ranges(detail)
        if not blocks:
            if detail and detail != GENERIC_HOURS_NOTICE:
                advisories.append(detail)
            continue

        for day in weekdays:
            if day not in weekly_closed:
                weekly[day].extend([dict(block) for block in blocks])
        for special_key in special_keys:
            if special_key not in special_closed:
                special_days[special_key].extend([dict(block) for block in blocks])

    for closed_day in weekly_closed:
        weekly[closed_day] = []
    for closed_special in special_closed:
        special_days[closed_special] = []

    policies = list(dict.fromkeys([*raw_policies, *_structured_business_hours(notes_structured)]))
    closed_on = None
    if isinstance(notes_structured, dict):
        closed_on = notes_structured.get("closed_on")
        if closed_on:
            policies.append(str(closed_on))
    policies = list(dict.fromkeys([policy for policy in policies if policy and policy != GENERIC_HOURS_NOTICE]))
    advisories = list(dict.fromkeys([advisory for advisory in advisories if advisory != GENERIC_HOURS_NOTICE]))

    current_time = now or datetime.now()
    today_display, open_now = summarize_for_today(weekly, current_time)
    return {
        "weeklyTimeline": weekly,
        "hoursSpecialDays": special_days,
        "hoursPolicies": policies,
        "hoursDisplay": {
            "today": today_display,
            "week": week_compact_pretty(weekly),
        },
        "hoursConfidence": hours_confidence(weekly, advisories, policies),
        "advisories": list(dict.fromkeys([*advisories, *notices])),
        "openNowMeta": open_now,
        "closedOn": closed_on,
    }
