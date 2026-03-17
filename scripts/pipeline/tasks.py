from __future__ import annotations

from pathlib import Path

from .google import GooglePlacesClient, merge_google_fields, missing_google_fields, resolve_google_place, should_backfill_google
from .hours import build_hours_payload
from .records import iter_record_files, load_record_container, write_record_container
from .tabelog import ensure_tabelog_address, make_session as make_tabelog_session
from .tabelog import refresh_restaurant_record, should_refresh_hours


def _core_gap_missing(record: dict):
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


def _hours_structural_gap(record: dict):
    if not record.get("hours_raw"):
        return True
    hours_payload = build_hours_payload(record.get("hours_raw"), record.get("hours_notes_structured"))
    covered_days = sum(1 for windows in hours_payload["weeklyTimeline"].values() if windows)
    return covered_days == 0


def _hours_quality_gap(record: dict):
    hours_payload = build_hours_payload(record.get("hours_raw"), record.get("hours_notes_structured"))
    return hours_payload["hoursConfidence"] == "low"


def backfill_google_records(
    *,
    root: Path,
    queue_urls: list[str] | None = None,
    include_business_status: bool = True,
    core_only: bool = False,
    status_only: bool = False,
    repair_existing_place_ids: bool = False,
    fetch_missing_tabelog_address: bool = False,
    tabelog_sleep_seconds: float = 0.0,
    limit: int | None = None,
    dry_run: bool = False,
):
    if core_only and status_only:
        raise ValueError("core_only and status_only cannot both be enabled")

    allowed_urls = set(queue_urls) if queue_urls else None
    client = None if dry_run else GooglePlacesClient(cwd=root)
    tabelog_session = None

    summary = {
        "dryRun": dry_run,
        "selectedUrlCount": len(allowed_urls or []),
        "attemptedCount": 0,
        "updatedCount": 0,
        "resolvedCoreCount": 0,
        "resolvedBusinessStatusCount": 0,
        "unresolvedCount": 0,
        "unresolvedUrls": [],
    }

    for path in iter_record_files(root):
        original_payload, records = load_record_container(path)
        next_records = []
        changed = False

        for index, record in enumerate(records):
            url = record.get("url") or ""
            if allowed_urls is not None and url not in allowed_urls:
                next_records.append(record)
                continue

            if core_only:
                should_attempt = _core_gap_missing(record)
            elif status_only:
                should_attempt = missing_google_fields(record)["business_status"]
            elif repair_existing_place_ids:
                should_attempt = True
            else:
                should_attempt = should_backfill_google(record, include_business_status=include_business_status)

            if not should_attempt:
                next_records.append(record)
                continue

            if limit is not None and summary["attemptedCount"] >= limit:
                next_records.extend(records[index:])
                break

            summary["attemptedCount"] += 1
            if dry_run:
                next_records.append(record)
                continue

            pre_missing = missing_google_fields(record)
            working_record = record
            if fetch_missing_tabelog_address and not (working_record.get("tabelog_address") or "").strip() and working_record.get("url"):
                if tabelog_session is None:
                    tabelog_session = make_tabelog_session()
                working_record = ensure_tabelog_address(
                    working_record,
                    session=tabelog_session,
                    sleep_seconds=tabelog_sleep_seconds,
                )

            enrichment = resolve_google_place(
                working_record,
                client,
                clear_invalid_existing_place_id=repair_existing_place_ids,
            )
            if enrichment is None:
                next_records.append(working_record)
                summary["unresolvedCount"] += 1
                summary["unresolvedUrls"].append(url or working_record.get("name") or "")
                continue

            merged = merge_google_fields(working_record, enrichment)
            next_records.append(merged)
            changed = changed or merged != record
            summary["updatedCount"] += 1
            post_missing = missing_google_fields(merged)
            if (
                any(
                    [
                        pre_missing["place_id"],
                        pre_missing["coordinates"],
                        pre_missing["google_maps_url"],
                        pre_missing["google_rating"],
                        pre_missing["google_reviews"],
                    ]
                )
                and not _core_gap_missing(merged)
            ):
                summary["resolvedCoreCount"] += 1
            if pre_missing["business_status"] and not post_missing["business_status"]:
                summary["resolvedBusinessStatusCount"] += 1

        if changed and not dry_run:
            write_record_container(path, original_payload, next_records)

        if limit is not None and summary["attemptedCount"] >= limit:
            break

    if allowed_urls is None:
        summary["selectedUrlCount"] = summary["attemptedCount"]

    return summary


def refresh_tabelog_hours_records(
    *,
    root: Path,
    queue_urls: list[str] | None = None,
    structural_only: bool = False,
    quality_only: bool = False,
    limit: int | None = None,
    dry_run: bool = False,
    sleep_seconds: float = 1.0,
):
    if structural_only and quality_only:
        raise ValueError("structural_only and quality_only cannot both be enabled")

    allowed_urls = set(queue_urls) if queue_urls else None
    session = None if dry_run else make_tabelog_session()
    summary = {
        "dryRun": dry_run,
        "selectedUrlCount": len(allowed_urls or []),
        "attemptedCount": 0,
        "refreshedCount": 0,
    }

    for path in iter_record_files(root):
        original_payload, records = load_record_container(path)
        next_records = []
        changed = False

        for index, record in enumerate(records):
            url = record.get("url") or ""
            if allowed_urls is not None and url not in allowed_urls:
                next_records.append(record)
                continue

            if structural_only:
                should_attempt = _hours_structural_gap(record)
            elif quality_only:
                should_attempt = _hours_quality_gap(record)
            else:
                should_attempt = should_refresh_hours(record)

            if not should_attempt:
                next_records.append(record)
                continue

            if limit is not None and summary["attemptedCount"] >= limit:
                next_records.extend(records[index:])
                break

            summary["attemptedCount"] += 1
            if dry_run:
                next_records.append(record)
                continue

            next_records.append(refresh_restaurant_record(record, session=session, sleep_seconds=sleep_seconds))
            summary["refreshedCount"] += 1
            changed = True

        if changed and not dry_run:
            write_record_container(path, original_payload, next_records)

        if limit is not None and summary["attemptedCount"] >= limit:
            break

    if allowed_urls is None:
        summary["selectedUrlCount"] = summary["attemptedCount"]

    return summary
