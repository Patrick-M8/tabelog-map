from __future__ import annotations

import csv
import json
import math
import re
import unicodedata
from collections import Counter, OrderedDict
from datetime import datetime
from pathlib import Path
from statistics import mean, pstdev
from zoneinfo import ZoneInfo

from .constants import CLOSURE_KEYWORDS, POPULAR_HUBS, normalize_category_label
from .google import missing_google_fields
from .hours import ALL_DAY_RE, build_hours_payload
from .records import iter_record_files, read_json_records

PRICE_NUM_RE = re.compile(r"\d+")


def safe_float(value):
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def safe_int(value):
    try:
        return int(value) if value is not None else 0
    except (TypeError, ValueError):
        return 0


def slugify(text: str):
    if not text:
        return "unknown"
    normalized = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    collapsed = re.sub(r"[^A-Za-z0-9]+", "-", normalized).strip("-").lower()
    return collapsed or "unknown"


def price_range(raw_value: str | None):
    if not raw_value or raw_value.strip() == "-":
        return (None, None)
    numbers = [int(part) for part in PRICE_NUM_RE.findall(raw_value.replace(",", ""))]
    if not numbers:
        return (None, None)
    if raw_value.startswith("～") or raw_value.startswith("~"):
        return (0, numbers[-1])
    if "～" in raw_value or "~" in raw_value or "-" in raw_value:
        return (numbers[0], numbers[-1])
    return (numbers[0], numbers[0])


def price_bucket(raw_value: str | None):
    low, high = price_range(raw_value)
    if low is None and high is None:
        return 0
    value = low if low is not None else high or 0
    if high is not None and low is not None:
        value = (low + high) // 2
    if value <= 999:
        return 1
    if value <= 1999:
        return 2
    if value <= 3999:
        return 3
    if value <= 7999:
        return 4
    return 5


def price_band(record):
    bucket = price_bucket(record.get("price_dinner")) or price_bucket(record.get("price_lunch"))
    return "¥" * bucket if bucket else None


def category_info(record):
    name_jp = record.get("category_jp")
    name_en = normalize_category_label(record.get("category_en"), name_jp)
    return {
        "label": name_en,
        "labelJp": name_jp,
        "key": slugify(name_en),
    }


def station_from_area(area: str | None):
    if not area:
        return None
    bits = [part for part in re.split(r"\s+", area.strip()) if part]
    return bits[-1] if bits else None


def review_weight(count: int, max_reviews: int):
    if count <= 0 or max_reviews <= 0:
        return 0.0
    return math.log1p(count) / math.log1p(max_reviews)


def percentile(sorted_values, value):
    if not sorted_values:
        return 0.0
    index = 0
    left = 0
    right = len(sorted_values)
    while left < right:
        middle = (left + right) // 2
        if sorted_values[middle] <= value:
            left = middle + 1
            index = left
        else:
            right = middle
    return index / len(sorted_values)


def grade_from_percentile(percentile_value: float):
    if percentile_value >= 0.95:
        return "A"
    if percentile_value >= 0.80:
        return "B"
    if percentile_value >= 0.60:
        return "C"
    if percentile_value >= 0.30:
        return "D"
    return "E"


def google_core_missing(record):
    missing = missing_google_fields(record)
    return any(
        [
            missing["place_id"],
            missing["coordinates"],
            missing["google_maps_url"],
            missing["google_rating"],
            missing["google_reviews"],
        ]
    )


def _status_reason(status: str | None):
    if not status:
        return None
    return status.lower().replace("_", " ")


def derive_closure(record, hours_payload):
    business_status = (record.get("business_status") or "").strip().upper() or None
    detected_at = record.get("google_last_updated_at") or None
    if business_status == "CLOSED_PERMANENTLY":
        return {
            "state": "permanentlyClosed",
            "source": "google",
            "reason": _status_reason(business_status),
            "detectedAt": detected_at,
        }
    if business_status == "CLOSED_TEMPORARILY":
        return {
            "state": "temporarilyClosed",
            "source": "google",
            "reason": _status_reason(business_status),
            "detectedAt": detected_at,
        }

    closure_text = " ".join(
        [
            *(hours_payload.get("hoursPolicies") or []),
            *(hours_payload.get("advisories") or []),
            str(record.get("business_status") or ""),
        ]
    ).lower()
    for state, keywords in CLOSURE_KEYWORDS.items():
        for keyword in keywords:
            if keyword.lower() in closure_text:
                return {
                    "state": state,
                    "source": "tabelog",
                    "reason": keyword,
                    "detectedAt": detected_at,
                }

    if business_status == "OPERATIONAL":
        reason = _status_reason(business_status)
    else:
        reason = None
    return {
        "state": "active",
        "source": "google" if business_status else "derived",
        "reason": reason,
        "detectedAt": detected_at,
    }


def _badges_for_entry(entry):
    closure_state = entry["closure"]["state"]
    hours_confidence = entry["hoursConfidence"]
    badges = [
        "Reservation info" if entry["reserveUrl"] else None,
        "Hours vary" if hours_confidence == "low" else None,
        "Permanent closure" if closure_state == "permanentlyClosed" else None,
        "Temporary closure" if closure_state == "temporarilyClosed" else None,
        "Strong consensus" if entry.get("consensusGrade") in {"A", "B"} else None,
    ]
    return list(dict.fromkeys([badge for badge in badges if badge]))


def base_entry(record, freshness_updated_at: str, seen_ids: dict[str, int], *, now: datetime):
    lat = safe_float(record.get("lat"))
    lng = safe_float(record.get("lng"))
    if lat is None or lng is None:
        return None

    category = category_info(record)
    hours_payload = build_hours_payload(record.get("hours_raw"), record.get("hours_notes_structured"), now=now)
    source_links = {
        "tabelog": record.get("url"),
        "google": record.get("google_maps_url"),
    }
    tabelog_reviews = safe_int(record.get("review_count_tabelog"))
    google_reviews = safe_int(record.get("google_reviews") or record.get("g_reviews"))
    base_identifier = str(record.get("place_id") or record.get("url") or f"{lat:.5f}-{lng:.5f}")
    seen_ids[base_identifier] = seen_ids.get(base_identifier, 0) + 1
    identifier = base_identifier if seen_ids[base_identifier] == 1 else f"{base_identifier}::{seen_ids[base_identifier]}"
    price = price_band(record)
    station = station_from_area(record.get("area"))
    google_score = safe_float(record.get("google_rating") or record.get("g_rating"))
    closure = derive_closure(record, hours_payload)

    entry = {
        "id": identifier,
        "placeId": record.get("place_id"),
        "nameEn": record.get("name_en") or record.get("g_name") or record.get("name"),
        "nameJp": record.get("name"),
        "lat": round(lat, 6),
        "lng": round(lng, 6),
        "region": record.get("region"),
        "station": station,
        "area": record.get("area"),
        "address": record.get("g_address") or record.get("tabelog_address") or record.get("area"),
        "category": category,
        "subCategories": [part.strip() for part in (record.get("sub_categories") or "").split(",") if part.strip()],
        "priceBand": price,
        "priceBucket": len(price or ""),
        "priceLunch": record.get("price_lunch"),
        "priceDinner": record.get("price_dinner"),
        "weeklyTimeline": hours_payload["weeklyTimeline"],
        "hoursConfidence": hours_payload["hoursConfidence"],
        "hoursDisplay": hours_payload["hoursDisplay"],
        "hoursSpecialDays": hours_payload["hoursSpecialDays"],
        "hoursPolicies": hours_payload["hoursPolicies"],
        "freshnessUpdatedAt": freshness_updated_at,
        "consensusScore": 0.0,
        "consensusGrade": "E",
        "tabelog": {
            "score": safe_float(record.get("rating")),
            "reviews": tabelog_reviews,
        },
        "google": {
            "score": google_score,
            "reviews": google_reviews,
        },
        "sourceLinks": source_links,
        "reserveUrl": source_links["tabelog"],
        "callPhone": record.get("google_phone") or None,
        "advisories": hours_payload["advisories"],
        "badges": [],
        "closure": closure,
        "imageUrl": record.get("image_url"),
        "mustOrder": None,
        "reservationLinks": [{"label": "Tabelog", "url": source_links["tabelog"]}] if source_links["tabelog"] else [],
        "issuePayload": {
            "placeId": record.get("place_id"),
            "nameEn": record.get("name_en") or record.get("name"),
            "nameJp": record.get("name"),
            "sources": source_links,
        },
        "_rawScores": {
            "tabelog": safe_float(record.get("rating")),
            "tabelogReviews": tabelog_reviews,
            "google": google_score,
            "googleReviews": google_reviews,
        },
        "_openNowMeta": hours_payload["openNowMeta"],
    }
    return entry


def compute_consensus(entries):
    tabelog_scores = [entry["_rawScores"]["tabelog"] for entry in entries if entry["_rawScores"]["tabelog"] is not None]
    google_scores = [entry["_rawScores"]["google"] for entry in entries if entry["_rawScores"]["google"] is not None]
    tabelog_mean = mean(tabelog_scores) if tabelog_scores else 0.0
    google_mean = mean(google_scores) if google_scores else 0.0
    tabelog_std = pstdev(tabelog_scores) if len(tabelog_scores) > 1 else 1.0
    google_std = pstdev(google_scores) if len(google_scores) > 1 else 1.0
    max_tabelog_reviews = max((entry["_rawScores"]["tabelogReviews"] for entry in entries), default=1)
    max_google_reviews = max((entry["_rawScores"]["googleReviews"] for entry in entries), default=1)

    scores = []
    for entry in entries:
        raw = entry["_rawScores"]
        combined = 0.0
        weight = 0.0

        if raw["tabelog"] is not None:
            z_score = (raw["tabelog"] - tabelog_mean) / (tabelog_std or 1.0)
            source_weight = 0.6 * (0.5 + (0.5 * review_weight(raw["tabelogReviews"], max_tabelog_reviews)))
            combined += z_score * source_weight
            weight += source_weight

        if raw["google"] is not None:
            z_score = (raw["google"] - google_mean) / (google_std or 1.0)
            source_weight = 0.4 * (0.5 + (0.5 * review_weight(raw["googleReviews"], max_google_reviews)))
            combined += z_score * source_weight
            weight += source_weight

        final_score = combined / weight if weight else -2.0
        entry["consensusScore"] = round(final_score, 4)
        scores.append(final_score)

    sorted_scores = sorted(scores)
    for entry in entries:
        percentile_value = percentile(sorted_scores, entry["consensusScore"])
        entry["consensusGrade"] = grade_from_percentile(percentile_value)
        entry["badges"] = _badges_for_entry(entry)


def build_outputs(entries):
    summary = []
    detail = OrderedDict()
    detail_keys = {
        "address",
        "priceLunch",
        "priceDinner",
        "imageUrl",
        "mustOrder",
        "reservationLinks",
        "issuePayload",
    }

    for entry in sorted(entries, key=lambda item: (-item["consensusScore"], item["nameEn"] or item["nameJp"] or "")):
        summary.append(
            {
                key: value
                for key, value in entry.items()
                if key
                in {
                    "id",
                    "placeId",
                    "nameEn",
                    "nameJp",
                    "lat",
                    "lng",
                    "region",
                    "station",
                    "area",
                    "category",
                    "subCategories",
                    "priceBand",
                    "priceBucket",
                    "weeklyTimeline",
                    "hoursConfidence",
                    "hoursDisplay",
                    "hoursSpecialDays",
                    "hoursPolicies",
                    "freshnessUpdatedAt",
                    "consensusScore",
                    "consensusGrade",
                    "tabelog",
                    "google",
                    "sourceLinks",
                    "reserveUrl",
                    "callPhone",
                    "imageUrl",
                    "advisories",
                    "badges",
                    "closure",
                }
            }
        )
        detail[entry["id"]] = {key: value for key, value in entry.items() if key in detail_keys}

    return summary, detail


def flatten_eda_row(entry):
    return {
        "id": entry["id"],
        "name_en": entry["nameEn"] or "",
        "name_jp": entry["nameJp"] or "",
        "category": entry["category"]["label"],
        "region": entry["region"] or "",
        "station": entry["station"] or "",
        "area": entry["area"] or "",
        "lat": entry["lat"],
        "lng": entry["lng"],
        "closure_state": entry["closure"]["state"],
        "hours_confidence": entry["hoursConfidence"],
        "hours_today": entry["hoursDisplay"]["today"],
        "hours_week": entry["hoursDisplay"]["week"],
        "policy_count": len(entry["hoursPolicies"]),
        "price_band": entry["priceBand"] or "",
        "consensus_grade": entry["consensusGrade"],
        "consensus_score": entry["consensusScore"],
        "tabelog_score": entry["tabelog"]["score"] or "",
        "tabelog_reviews": entry["tabelog"]["reviews"],
        "google_score": entry["google"]["score"] or "",
        "google_reviews": entry["google"]["reviews"],
        "place_id": entry["placeId"] or "",
        "google_url": entry["sourceLinks"]["google"] or "",
        "tabelog_url": entry["sourceLinks"]["tabelog"] or "",
    }


def export_eda_csv(entries, output_path: Path):
    rows = [flatten_eda_row(entry) for entry in entries]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()) if rows else [])
        if rows:
            writer.writeheader()
            writer.writerows(rows)


def build_audit_report(records: list[dict], entries: list[dict]):
    category_missing_coords = Counter()
    zero_weekday_coverage = []
    unresolved_google_core = []
    missing_business_status = []
    all_day_failures = []
    closure_counts = Counter()
    missing_google_field_counts = Counter()

    for record in records:
        hours_payload = build_hours_payload(record.get("hours_raw"), record.get("hours_notes_structured"))
        covered_days = sum(1 for windows in hours_payload["weeklyTimeline"].values() if windows)
        if covered_days == 0 and hours_payload["advisories"]:
            zero_weekday_coverage.append(record.get("url") or record.get("name"))

        raw_hours_blob = json.dumps(record.get("hours_raw") or [], ensure_ascii=False)
        if ALL_DAY_RE.search(raw_hours_blob) and not any(
            window.get("allDay")
            for windows in hours_payload["weeklyTimeline"].values()
            for window in windows
        ):
            all_day_failures.append(record.get("url") or record.get("name"))

        google_missing = missing_google_fields(record)
        for key, is_missing in google_missing.items():
            if is_missing:
                missing_google_field_counts[key] += 1

        if google_core_missing(record):
            unresolved_google_core.append(record.get("url") or record.get("name"))
        if google_missing["business_status"]:
            missing_business_status.append(record.get("url") or record.get("name"))

        closure = derive_closure(record, hours_payload)
        closure_counts[closure["state"]] += 1

        if safe_float(record.get("lat")) is None or safe_float(record.get("lng")) is None:
            category = normalize_category_label(record.get("category_en"), record.get("category_jp"))
            category_missing_coords[category] += 1

    return {
        "rawRecordCount": len(records),
        "appReadyRecordCount": len(entries),
        "missingHoursRawCount": sum(1 for record in records if not record.get("hours_raw")),
        "zeroWeekdayCoverageCount": len(zero_weekday_coverage),
        "zeroWeekdayCoverageExamples": zero_weekday_coverage[:20],
        "allDayParseFailureCount": len(all_day_failures),
        "allDayParseFailureExamples": all_day_failures[:20],
        "unresolvedGoogleCoreCount": len(unresolved_google_core),
        "unresolvedGoogleCoreExamples": unresolved_google_core[:20],
        "missingBusinessStatusCount": len(missing_business_status),
        "missingBusinessStatusExamples": missing_business_status[:20],
        "missingGoogleFieldCounts": dict(missing_google_field_counts),
        "missingCoordinatesByCategory": dict(category_missing_coords),
        "closureCounts": dict(closure_counts),
    }


def collect_entries(*, input_root: Path, timezone: str = "Asia/Tokyo"):
    tz = ZoneInfo(timezone)
    freshness = datetime.now(tz).replace(microsecond=0).isoformat()
    now = datetime.now(tz)
    entries = []
    raw_records = []
    seen_ids: dict[str, int] = {}

    for path in iter_record_files(input_root):
        for record in read_json_records(path):
            raw_records.append(record)
            entry = base_entry(record, freshness, seen_ids, now=now)
            if entry is not None:
                entries.append(entry)

    compute_consensus(entries)
    return freshness, raw_records, entries


def build_app_data(
    *,
    input_root: Path,
    output_root: Path,
    timezone: str = "Asia/Tokyo",
    audit_json_path: Path | None = None,
    eda_csv_path: Path | None = None,
    fail_on_audit: bool = False,
):
    output_root.mkdir(parents=True, exist_ok=True)
    freshness, raw_records, entries = collect_entries(input_root=input_root, timezone=timezone)
    summary, detail = build_outputs(entries)
    audit = build_audit_report(raw_records, entries)

    (output_root / "places-summary.min.json").write_text(
        json.dumps(summary, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (output_root / "places-detail.min.json").write_text(
        json.dumps(detail, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (output_root / "popular-hubs.min.json").write_text(
        json.dumps(POPULAR_HUBS, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (output_root / "build-meta.json").write_text(
        json.dumps(
            {
                "generatedAt": freshness,
                "placeCount": len(summary),
                "hubCount": len(POPULAR_HUBS),
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )

    audit_target = audit_json_path or (output_root / "build-audit.json")
    audit_target.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if eda_csv_path is not None:
        export_eda_csv(entries, eda_csv_path)

    if fail_on_audit and (
        audit["unresolvedGoogleCoreCount"] > 0
        or audit["missingBusinessStatusCount"] > 0
        or audit["allDayParseFailureCount"] > 0
    ):
        raise RuntimeError(
            "Audit failed with "
            f"{audit['unresolvedGoogleCoreCount']} unresolved Google core records, "
            f"{audit['missingBusinessStatusCount']} missing Google business status records, and "
            f"{audit['allDayParseFailureCount']} all-day parsing failures."
        )

    return summary, detail, audit
