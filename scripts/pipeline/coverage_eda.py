from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import pandas as pd

from .google import missing_google_fields
from .hours import build_hours_payload
from .records import iter_record_files, read_json_records

YEAR_SUFFIX_RE = re.compile(r"_20\d{2}$")
REGION_SUFFIXES = {"EAST", "WEST", "TOKYO", "ALL"}
CATEGORY_LABEL_OVERRIDES = {
    "中国料理": "Chinese",
    "喫茶店": "Coffee Shop",
    "鳥料理": "Chicken",
}


def infer_source_category(path: Path):
    stem = YEAR_SUFFIX_RE.sub("", path.stem)
    parts = stem.split("_")
    if parts and parts[0].lower() == "tabelog":
        parts = parts[1:]
    if parts and parts[-1].upper() in REGION_SUFFIXES:
        parts = parts[:-1]

    english_parts = []
    for part in parts:
        if part.isascii() and re.fullmatch(r"[A-Za-z0-9]+", part):
            english_parts.append(part)
            continue
        break

    if english_parts:
        return " ".join(english_parts).replace("Cuisine Innovative", "Cuisine/Innovative")
    return path.stem


def normalize_category_label(value: str | None, fallback: str):
    label = (value or "").strip()
    if not label:
        label = fallback
    return CATEGORY_LABEL_OVERRIDES.get(label, label)


def raw_records_frame(input_root: Path):
    rows = []
    source_files = list(iter_record_files(input_root))
    for path in source_files:
        inferred_category = infer_source_category(path)
        for record in read_json_records(path):
            hours_payload = build_hours_payload(record.get("hours_raw"), record.get("hours_notes_structured"))
            weekly = hours_payload["weeklyTimeline"]
            special = hours_payload["hoursSpecialDays"]
            google_missing = missing_google_fields(record)
            covered_days = sum(1 for windows in weekly.values() if windows)
            all_windows = [window for windows in weekly.values() for window in windows]
            rows.append(
                {
                    "source_file": path.name,
                    "category": normalize_category_label(
                        record.get("category_en") or record.get("category_jp"),
                        inferred_category or "Unknown",
                    ),
                    "region": record.get("region") or "",
                    "url": record.get("url") or "",
                    "name_jp": record.get("name") or "",
                    "name_en": record.get("name_en") or "",
                    "place_id": record.get("place_id") or "",
                    "lat": record.get("lat"),
                    "lng": record.get("lng"),
                    "google_maps_url": record.get("google_maps_url") or "",
                    "google_rating": record.get("google_rating") if record.get("google_rating") not in ("", None) else record.get("g_rating"),
                    "google_reviews": record.get("google_reviews") if record.get("google_reviews") not in ("", None) else record.get("g_reviews"),
                    "business_status": record.get("business_status") or "",
                    "hours_raw_count": len(record.get("hours_raw") or []),
                    "has_hours_raw": bool(record.get("hours_raw")),
                    "parsed_weekday_days": covered_days,
                    "hours_confidence": hours_payload["hoursConfidence"],
                    "hours_today": hours_payload["hoursDisplay"]["today"],
                    "hours_week": hours_payload["hoursDisplay"]["week"],
                    "hours_policy_count": len(hours_payload["hoursPolicies"]),
                    "advisory_count": len(hours_payload["advisories"]),
                    "special_day_window_count": sum(len(windows) for windows in special.values()),
                    "has_all_day_hours": any(window.get("allDay") for window in all_windows),
                    "has_overnight_hours": any(window.get("crossesMidnight") for window in all_windows),
                    "has_split_service": any(len(windows) >= 2 for windows in weekly.values()),
                    "missing_place_id": google_missing["place_id"],
                    "missing_coordinates": google_missing["coordinates"],
                    "missing_google_maps_url": google_missing["google_maps_url"],
                    "missing_google_rating": google_missing["google_rating"],
                    "missing_google_reviews": google_missing["google_reviews"],
                    "missing_business_status": google_missing["business_status"],
                }
            )

    frame = pd.DataFrame(rows)
    frame["missing_google_core"] = frame[
        [
            "missing_place_id",
            "missing_coordinates",
            "missing_google_maps_url",
            "missing_google_rating",
            "missing_google_reviews",
        ]
    ].any(axis=1)
    frame["missing_hours_structural"] = (~frame["has_hours_raw"]) | (frame["parsed_weekday_days"] == 0)
    frame["hours_need_review"] = frame["missing_hours_structural"] | (frame["hours_confidence"] == "low")
    return frame, len(source_files)


def summary_frame(summary_json_path: Path):
    items = json.loads(summary_json_path.read_text(encoding="utf-8"))
    frame = pd.json_normalize(items, sep=".")
    frame = frame.rename(
        columns={
            "sourceLinks.tabelog": "url",
            "category.label": "webapp_category",
            "closure.state": "closure_state",
            "hoursConfidence": "webapp_hours_confidence",
            "google.score": "webapp_google_score",
            "google.reviews": "webapp_google_reviews",
        }
    )
    keep = [
        "id",
        "url",
        "placeId",
        "webapp_category",
        "closure_state",
        "webapp_hours_confidence",
        "webapp_google_score",
        "webapp_google_reviews",
    ]
    return frame[keep].copy()


def build_report(raw_df: pd.DataFrame, summary_df: pd.DataFrame, source_file_count: int):
    merged = raw_df.merge(summary_df, on="url", how="left", indicator=True)
    merged["in_webapp"] = merged["_merge"].eq("both")

    raw_total = int(len(merged))
    raw_unique_urls = int(merged["url"].nunique())
    webapp_total = int(len(summary_df))
    webapp_unique_urls = int(summary_df["url"].nunique())
    raw_only = merged.loc[~merged["in_webapp"]].copy()
    webapp_only = summary_df.loc[~summary_df["url"].isin(merged["url"])].copy()
    visible = merged.loc[merged["in_webapp"]].copy()

    category_coverage = (
        merged.groupby("category", dropna=False)
        .agg(
            raw_restaurants=("url", "count"),
            webapp_restaurants=("in_webapp", "sum"),
            raw_only_restaurants=("in_webapp", lambda values: int((~values).sum())),
            missing_hours_structural=("missing_hours_structural", "sum"),
            hours_need_review=("hours_need_review", "sum"),
            missing_google_core=("missing_google_core", "sum"),
            missing_coordinates=("missing_coordinates", "sum"),
            missing_google_rating=("missing_google_rating", "sum"),
        )
        .reset_index()
        .sort_values(["raw_only_restaurants", "missing_google_core", "category"], ascending=[False, False, True])
    )

    report = {
        "overview": {
            "sourceFileCount": source_file_count,
            "rawRestaurantCount": raw_total,
            "rawUniqueUrlCount": raw_unique_urls,
            "webappRestaurantCount": webapp_total,
            "webappUniqueUrlCount": webapp_unique_urls,
            "webappCoveragePct": round((webapp_total / raw_total) * 100, 2) if raw_total else 0.0,
            "rawOnlyCount": int(len(raw_only)),
            "webappOnlyCount": int(len(webapp_only)),
        },
        "hours": {
            "missingHoursRawCount": int((~merged["has_hours_raw"]).sum()),
            "missingHoursStructuralCount": int(merged["missing_hours_structural"].sum()),
            "hoursNeedReviewCount": int(merged["hours_need_review"].sum()),
            "hoursConfidenceCounts": {
                key: int(value) for key, value in merged["hours_confidence"].value_counts(dropna=False).to_dict().items()
            },
            "specialDayHoursCount": int((merged["special_day_window_count"] > 0).sum()),
            "hoursPolicyCount": int((merged["hours_policy_count"] > 0).sum()),
            "allDayRestaurantCount": int(merged["has_all_day_hours"].sum()),
            "overnightRestaurantCount": int(merged["has_overnight_hours"].sum()),
            "splitServiceRestaurantCount": int(merged["has_split_service"].sum()),
            "visibleHoursNeedReviewCount": int((visible["hours_need_review"]).sum()),
        },
        "google": {
            "missingGoogleCoreCount": int(merged["missing_google_core"].sum()),
            "missingPlaceIdCount": int(merged["missing_place_id"].sum()),
            "missingCoordinatesCount": int(merged["missing_coordinates"].sum()),
            "missingGoogleMapsUrlCount": int(merged["missing_google_maps_url"].sum()),
            "missingGoogleRatingCount": int(merged["missing_google_rating"].sum()),
            "missingGoogleReviewsCount": int(merged["missing_google_reviews"].sum()),
            "missingBusinessStatusCount": int(merged["missing_business_status"].sum()),
            "visibleMissingGoogleCoreCount": int((visible["missing_google_core"]).sum()),
            "visibleMissingGoogleRatingCount": int((visible["missing_google_rating"]).sum()),
            "visibleMissingBusinessStatusCount": int((visible["missing_business_status"]).sum()),
            "rawOnlyMissingCoordinatesCount": int((raw_only["missing_coordinates"]).sum()),
        },
        "crossReference": {
            "temporarilyClosedVisibleCount": int((summary_df["closure_state"] == "temporarilyClosed").sum()),
            "permanentlyClosedVisibleCount": int((summary_df["closure_state"] == "permanentlyClosed").sum()),
            "rawOnlyTopCategories": raw_only["category"].value_counts().head(10).to_dict(),
            "visibleGapTopCategories": visible.loc[visible["missing_google_core"] | visible["hours_need_review"], "category"]
            .value_counts()
            .head(10)
            .to_dict(),
        },
    }
    return report, merged, category_coverage, raw_only, visible, webapp_only


def write_outputs(
    output_dir: Path,
    report: dict,
    merged: pd.DataFrame,
    category_coverage: pd.DataFrame,
    raw_only: pd.DataFrame,
    visible: pd.DataFrame,
    webapp_only: pd.DataFrame,
):
    output_dir.mkdir(parents=True, exist_ok=True)

    (output_dir / "coverage_summary.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    summary_lines = [
        "# Source Coverage Report",
        "",
        "## Overview",
        f"- Source JSON files: {report['overview']['sourceFileCount']}",
        f"- Raw restaurants: {report['overview']['rawRestaurantCount']}",
        f"- Webapp restaurants: {report['overview']['webappRestaurantCount']}",
        f"- Webapp coverage: {report['overview']['webappCoveragePct']}%",
        f"- Raw-only restaurants not on the webapp: {report['overview']['rawOnlyCount']}",
        f"- Webapp-only restaurants not matched back to raw JSON: {report['overview']['webappOnlyCount']}",
        "",
        "## Hours",
        f"- Missing `hours_raw`: {report['hours']['missingHoursRawCount']}",
        f"- Structural hours gaps (`hours_raw` missing or zero parsed weekdays): {report['hours']['missingHoursStructuralCount']}",
        f"- Hours needing review (structural gap or low confidence): {report['hours']['hoursNeedReviewCount']}",
        f"- Restaurants with holiday/special-day hours: {report['hours']['specialDayHoursCount']}",
        f"- Restaurants with hours policies/closure notes: {report['hours']['hoursPolicyCount']}",
        f"- 24-hour restaurants: {report['hours']['allDayRestaurantCount']}",
        f"- Overnight restaurants: {report['hours']['overnightRestaurantCount']}",
        f"- Split-service restaurants: {report['hours']['splitServiceRestaurantCount']}",
        "",
        "## Google",
        f"- Missing any core Google field: {report['google']['missingGoogleCoreCount']}",
        f"- Missing coordinates: {report['google']['missingCoordinatesCount']}",
        f"- Missing place IDs: {report['google']['missingPlaceIdCount']}",
        f"- Missing Google Maps URLs: {report['google']['missingGoogleMapsUrlCount']}",
        f"- Missing Google ratings: {report['google']['missingGoogleRatingCount']}",
        f"- Missing Google review counts: {report['google']['missingGoogleReviewsCount']}",
        f"- Missing business status: {report['google']['missingBusinessStatusCount']}",
        "",
        "## Cross-reference",
        f"- Visible on webapp but still missing core Google data: {report['google']['visibleMissingGoogleCoreCount']}",
        f"- Visible on webapp but hours still need review: {report['hours']['visibleHoursNeedReviewCount']}",
        f"- Temporarily closed and visible: {report['crossReference']['temporarilyClosedVisibleCount']}",
        f"- Permanently closed and visible: {report['crossReference']['permanentlyClosedVisibleCount']}",
        "",
        "## Top raw-only categories",
    ]
    for category, count in report["crossReference"]["rawOnlyTopCategories"].items():
        summary_lines.append(f"- {category}: {count}")

    summary_lines.extend(["", "## Top visible categories with gaps"])
    for category, count in report["crossReference"]["visibleGapTopCategories"].items():
        summary_lines.append(f"- {category}: {count}")

    (output_dir / "coverage_summary.md").write_text("\n".join(summary_lines) + "\n", encoding="utf-8")

    category_coverage.to_csv(output_dir / "category_coverage.csv", index=False)
    merged.sort_values(["in_webapp", "category", "name_en", "name_jp"], ascending=[False, True, True, True]).to_csv(
        output_dir / "restaurant_inventory.csv",
        index=False,
    )
    raw_only.sort_values(["category", "name_en", "name_jp"]).to_csv(output_dir / "raw_only_missing_from_webapp.csv", index=False)
    visible.loc[visible["missing_google_core"] | visible["hours_need_review"]].sort_values(
        ["category", "name_en", "name_jp"]
    ).to_csv(output_dir / "visible_gap_inventory.csv", index=False)
    webapp_only.sort_values(["webapp_category", "url"]).to_csv(output_dir / "webapp_only_inventory.csv", index=False)


def generate_coverage_report(*, input_root: Path, summary_json_path: Path, output_dir: Path):
    raw_df, source_file_count = raw_records_frame(input_root)
    summary_df = summary_frame(summary_json_path)
    report, merged, category_coverage, raw_only, visible, webapp_only = build_report(raw_df, summary_df, source_file_count)
    write_outputs(output_dir, report, merged, category_coverage, raw_only, visible, webapp_only)
    return report


def main():
    parser = argparse.ArgumentParser(description="Run pandas coverage EDA against raw restaurant JSON and built app data.")
    parser.add_argument("--in-root", default="restaurant_data")
    parser.add_argument("--summary-json", default="static/data/places-summary.min.json")
    parser.add_argument("--out-dir", default="reports/eda")
    args = parser.parse_args()

    report = generate_coverage_report(
        input_root=Path(args.in_root),
        summary_json_path=Path(args.summary_json),
        output_dir=Path(args.out_dir),
    )
    print(json.dumps(report, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
