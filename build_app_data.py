#!/usr/bin/env python3
import argparse
import json
import math
import re
from collections import OrderedDict
from datetime import datetime
from pathlib import Path
from statistics import mean, pstdev
from zoneinfo import ZoneInfo

DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DAY_ALIASES = {
    "mon": "mon",
    "monday": "mon",
    "tue": "tue",
    "tuesday": "tue",
    "wed": "wed",
    "wednesday": "wed",
    "thu": "thu",
    "thursday": "thu",
    "fri": "fri",
    "friday": "fri",
    "sat": "sat",
    "saturday": "sat",
    "sun": "sun",
    "sunday": "sun",
}
DAY_RANGE_RE = re.compile(r"([A-Za-z]{3,9})\s*[-~]\s*([A-Za-z]{3,9})")
TIME_RANGE_RE = re.compile(r"(?P<start>\d{1,2}:\d{2})\s*[-~]\s*(?P<end>\d{1,2}:\d{2})")
LAST_ORDER_RE = re.compile(r"(?i)L\.?\s*O\.?\s*(?P<time>\d{1,2}:\d{2})")
PRICE_NUM_RE = re.compile(r"\d+")

JP_TO_EN = {
    "そば": "Soba",
    "カフェ": "Cafe",
    "洋食": "Western Food",
    "フレンチ": "French",
    "創作料理・イノベーティブ": "Creative Cuisine/Innovative",
    "イタリアン": "Italian",
    "ピザ": "Pizza",
    "日本料理": "Japanese",
    "天ぷら": "Tempura",
    "寿司": "Sushi",
    "ラーメン": "Ramen",
    "焼き鳥": "Yakitori",
    "焼肉": "Yakiniku",
    "居酒屋": "Izakaya",
    "食堂": "Shokudo (Japanese Diner)",
    "すき焼き・しゃぶしゃぶ": "Sukiyaki, Shabushabu",
    "スペイン料理": "Spanish",
    "カレー": "Curry",
    "アジア・エスニック": "Asian Ethnic",
    "うなぎ": "Unagi",
    "餃子": "Gyoza",
    "中華料理": "Chinese",
    "お好み焼き": "Okonomiyaki",
    "ステーキ・鉄板焼き": "Steak, Teppanyaki",
    "とんかつ": "Tonkatsu",
    "ハンバーガー": "Hamburger",
    "うどん": "Udon",
    "和菓子・甘味処": "Wagashi",
    "スイーツ": "Sweets",
    "アイス・ジェラート": "Ice Cream & Gelato",
    "バー": "Bar",
    "パン": "Bakery",
    "立ち飲み": "Standing Bar",
    "鳥料理": "Chicken",
    "喫茶店": "Coffee Shop",
}

POPULAR_HUBS = [
    {"id": "shinjuku", "label": "Shinjuku", "nameJp": "新宿", "lat": 35.6900, "lng": 139.7000},
    {"id": "shibuya", "label": "Shibuya", "nameJp": "渋谷", "lat": 35.6595, "lng": 139.7005},
    {"id": "ginza", "label": "Ginza", "nameJp": "銀座", "lat": 35.6717, "lng": 139.7650},
    {"id": "hibiya", "label": "Hibiya", "nameJp": "日比谷", "lat": 35.6749, "lng": 139.7605},
    {"id": "asakusa", "label": "Asakusa", "nameJp": "浅草", "lat": 35.7110, "lng": 139.7985},
]


def parse_args():
    parser = argparse.ArgumentParser(description="Build summary/detail data artifacts for the TabeMap app.")
    parser.add_argument("--in-root", required=True, help="Input folder with raw restaurant JSON files.")
    parser.add_argument("--out-dir", required=True, help="Output folder for static JSON data.")
    parser.add_argument("--timezone", default="Asia/Tokyo", help="Timezone used for freshness metadata.")
    return parser.parse_args()


def read_json_records(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("restaurants", "items", "results", "data"):
            if isinstance(payload.get(key), list):
                return payload[key]
    return []


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
    text = re.sub(r"[^A-Za-z0-9]+", "-", text or "").strip("-").lower()
    return text or "unknown"


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


def minutes_value(clock: str):
    hours, minutes = [int(part) for part in clock.split(":")]
    hours = 0 if hours == 24 else hours
    return (hours * 60) + minutes


def normalize_text(text: str):
    text = text or ""
    return (
        text.replace("〜", "-")
        .replace("～", "-")
        .replace("—", "-")
        .replace("–", "-")
        .replace(" to ", "-")
    )


def parse_days(title: str):
    title = normalize_text(title)
    chunks = [part.strip() for part in title.split(",") if part.strip()]
    days: list[str] = []
    for chunk in chunks:
        key = chunk.lower()
        if key in DAY_ALIASES:
            days.append(DAY_ALIASES[key])
            continue
        match = DAY_RANGE_RE.search(key)
        if not match:
            continue
        start = DAY_ALIASES.get(match.group(1).lower())
        end = DAY_ALIASES.get(match.group(2).lower())
        if start is None or end is None:
            continue
        start_index = DAY_ORDER.index(start)
        end_index = DAY_ORDER.index(end)
        if start_index <= end_index:
            days.extend(DAY_ORDER[start_index : end_index + 1])
        else:
            days.extend(DAY_ORDER[start_index:] + DAY_ORDER[: end_index + 1])
    return list(dict.fromkeys(days))


def parse_hours(hours_raw):
    weekly = {day: [] for day in DAY_ORDER}
    advisories: list[str] = []

    if not hours_raw:
        return weekly, advisories

    for entry in hours_raw:
        title = entry.get("title") or entry.get("list_title") or ""
        detail = normalize_text(entry.get("dtl_text") or entry.get("dtl") or "")
        days = parse_days(title)
        if not days:
            continue

        lower_detail = detail.lower().strip()
        if lower_detail == "closed":
            continue

        ranges = list(TIME_RANGE_RE.finditer(detail))
        last_order = LAST_ORDER_RE.search(detail)
        if not ranges:
            if detail:
                advisories.append(detail)
            continue

        for day in days:
            for match in ranges:
                start = match.group("start")
                end = match.group("end")
                weekly[day].append(
                    {
                        "open": start,
                        "close": end,
                        "crossesMidnight": minutes_value(end) <= minutes_value(start),
                        "lastOrder": last_order.group("time") if last_order else None,
                    }
                )

    return weekly, list(dict.fromkeys(advisories))


def category_info(record):
    name_jp = record.get("category_jp")
    name_en = record.get("category_en") or JP_TO_EN.get(name_jp) or "Unknown"
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


def hours_confidence(weekly, advisories, has_google):
    covered_days = sum(1 for windows in weekly.values() if windows)
    if covered_days == 0:
        return "low"
    advisory_text = " ".join(advisories).lower()
    if "irregular" in advisory_text or "not fixed" in advisory_text or "hours vary" in advisory_text:
        return "low"
    if covered_days >= 5 and has_google:
        return "high"
    return "medium"


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


def base_entry(record, freshness_updated_at: str, seen_ids: dict[str, int]):
    lat = safe_float(record.get("lat"))
    lng = safe_float(record.get("lng"))
    if lat is None or lng is None:
        return None

    category = category_info(record)
    weekly, advisories = parse_hours(record.get("hours_raw"))
    source_links = {
        "tabelog": record.get("url"),
        "google": record.get("google_maps_url"),
    }
    tabelog_reviews = safe_int(record.get("review_count_tabelog"))
    google_reviews = safe_int(record.get("google_reviews") or record.get("g_reviews"))
    has_google = safe_float(record.get("google_rating") or record.get("g_rating")) is not None
    base_identifier = str(record.get("place_id") or record.get("url") or f"{lat:.5f}-{lng:.5f}")
    seen_ids[base_identifier] = seen_ids.get(base_identifier, 0) + 1
    identifier = (
        base_identifier
        if seen_ids[base_identifier] == 1
        else f"{base_identifier}::{seen_ids[base_identifier]}"
    )
    price = price_band(record)
    station = station_from_area(record.get("area"))

    return {
        "id": identifier,
        "placeId": record.get("place_id"),
        "nameEn": record.get("name_en") or record.get("g_name") or record.get("name"),
        "nameJp": record.get("name"),
        "lat": round(lat, 6),
        "lng": round(lng, 6),
        "region": record.get("region"),
        "station": station,
        "area": record.get("area"),
        "address": record.get("g_address") or record.get("area"),
        "category": category,
        "subCategories": [part.strip() for part in (record.get("sub_categories") or "").split(",") if part.strip()],
        "priceBand": price,
        "priceBucket": len(price or ""),
        "priceLunch": record.get("price_lunch"),
        "priceDinner": record.get("price_dinner"),
        "weeklyTimeline": weekly,
        "hoursConfidence": hours_confidence(weekly, advisories, has_google),
        "freshnessUpdatedAt": freshness_updated_at,
        "tabelog": {
            "score": safe_float(record.get("rating")),
            "reviews": tabelog_reviews,
        },
        "google": {
            "score": safe_float(record.get("google_rating") or record.get("g_rating")),
            "reviews": google_reviews,
        },
        "sourceLinks": source_links,
        "reserveUrl": source_links["tabelog"],
        "callPhone": None,
        "advisories": advisories,
        "badges": [],
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
            "google": safe_float(record.get("google_rating") or record.get("g_rating")),
            "googleReviews": google_reviews,
        },
    }


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
        entry["badges"] = list(
            dict.fromkeys(
                [
                    badge
                    for badge in [
                        "Reservation info" if entry["reserveUrl"] else None,
                        "Hours vary" if entry["hoursConfidence"] == "low" else None,
                        "Strong consensus" if entry["consensusGrade"] in {"A", "B"} else None,
                    ]
                    if badge
                ]
            )
        )


def build_outputs(entries):
    summary = []
    detail = OrderedDict()

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
                    "freshnessUpdatedAt",
                    "consensusScore",
                    "consensusGrade",
                    "tabelog",
                    "google",
                    "sourceLinks",
                    "reserveUrl",
                    "callPhone",
                    "advisories",
                    "badges",
                }
            }
        )
        detail[entry["id"]] = {
            key: value
            for key, value in entry.items()
            if not key.startswith("_")
        }

    return summary, detail


def main():
    args = parse_args()
    tz = ZoneInfo(args.timezone)
    freshness = datetime.now(tz).replace(microsecond=0).isoformat()
    input_root = Path(args.in_root)
    output_root = Path(args.out_dir)
    output_root.mkdir(parents=True, exist_ok=True)

    entries = []
    seen_ids: dict[str, int] = {}
    for path in sorted(input_root.rglob("*.json")):
        for record in read_json_records(path):
            entry = base_entry(record, freshness, seen_ids)
            if entry is not None:
                entries.append(entry)

    compute_consensus(entries)
    summary, detail = build_outputs(entries)

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
    print(f"[OK] Wrote {len(summary)} summaries and {len(detail)} details to {output_root}")


if __name__ == "__main__":
    main()
