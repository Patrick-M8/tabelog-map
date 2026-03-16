from __future__ import annotations

import argparse
import json
from pathlib import Path

from .builders import build_app_data, export_eda_csv
from .coverage_eda import generate_coverage_report
from .selection import ordered_queue_urls, select_queue_rows
from .tasks import backfill_google_records, refresh_tabelog_hours_records

PHASE_ORDER = [
    "google-hard-gaps",
    "google-visible-gaps",
    "google-status",
    "hours-structural",
    "hours-quality",
]
GOOGLE_PRIORITY_CATEGORIES = [
    "Standing Bar",
    "Chicken",
    "Yakiniku",
    "Izakaya",
    "Steak, Teppanyaki",
    "Okonomiyaki",
]
HOURS_PRIORITY_CATEGORIES = [
    "Japanese",
    "Sushi",
    "Italian",
    "French",
    "Chinese",
    "Yakitori",
    "Ramen",
    "Sweets",
]


def _print_json(payload):
    print(json.dumps(payload, ensure_ascii=True, indent=2))


def _queue_selection_from_args(args):
    queue_csv = getattr(args, "queue_csv", None)
    if not queue_csv:
        return None
    return select_queue_rows(
        queue_csv=Path(queue_csv),
        url_column=getattr(args, "queue_url_column", "url"),
        category_column=getattr(args, "queue_category_column", "category"),
        categories=getattr(args, "categories", None),
        where=getattr(args, "where", None),
    )


def _queue_summary(selection: dict | None):
    if selection is None:
        return None
    return {
        key: value
        for key, value in selection.items()
        if key in {"queueRowCount", "selectedRowCount", "selectedUrlCount", "selectedCategoryCounts"}
    }


def _run_build_and_coverage(*, input_root: Path, output_root: Path, timezone: str, eda_dir: Path):
    _, _, audit = build_app_data(
        input_root=input_root,
        output_root=output_root,
        timezone=timezone,
        fail_on_audit=False,
    )
    coverage = generate_coverage_report(
        input_root=input_root,
        summary_json_path=output_root / "places-summary.min.json",
        output_dir=eda_dir,
    )
    return {"buildAudit": audit, "coverage": coverage}


def _phase_stop_condition_failures(phase: str, coverage: dict):
    overview = coverage["overview"]
    google = coverage["google"]
    hours = coverage["hours"]
    failures = []

    if phase == "google-hard-gaps":
        if overview["rawOnlyCount"] != 0:
            failures.append(f"rawOnlyCount={overview['rawOnlyCount']}")
        if overview["webappRestaurantCount"] != overview["rawRestaurantCount"]:
            failures.append(
                f"webappRestaurantCount={overview['webappRestaurantCount']} rawRestaurantCount={overview['rawRestaurantCount']}"
            )
    elif phase == "google-visible-gaps":
        if google["missingPlaceIdCount"] != 0:
            failures.append(f"missingPlaceIdCount={google['missingPlaceIdCount']}")
        if google["missingCoordinatesCount"] != 0:
            failures.append(f"missingCoordinatesCount={google['missingCoordinatesCount']}")
        if google["missingGoogleMapsUrlCount"] != 0:
            failures.append(f"missingGoogleMapsUrlCount={google['missingGoogleMapsUrlCount']}")
    elif phase == "google-status":
        if google["missingBusinessStatusCount"] != 0:
            failures.append(f"missingBusinessStatusCount={google['missingBusinessStatusCount']}")
    elif phase == "hours-structural":
        if hours["missingHoursRawCount"] != 0:
            failures.append(f"missingHoursRawCount={hours['missingHoursRawCount']}")
        if hours["missingHoursStructuralCount"] != 0:
            failures.append(f"missingHoursStructuralCount={hours['missingHoursStructuralCount']}")
    return failures


def command_build_app_data(args):
    _, _, audit = build_app_data(
        input_root=Path(args.in_root),
        output_root=Path(args.out_dir),
        timezone=args.timezone,
        audit_json_path=Path(args.audit_json) if args.audit_json else None,
        eda_csv_path=Path(args.eda_csv) if args.eda_csv else None,
        fail_on_audit=args.fail_on_audit,
    )
    _print_json(audit)


def command_export_eda(args):
    input_root = Path(args.in_root)
    output_path = Path(args.out_csv)
    summary, _, _ = build_app_data(
        input_root=input_root,
        output_root=Path(args.temp_out_dir),
        timezone=args.timezone,
        fail_on_audit=False,
    )
    export_eda_csv(summary, output_path)
    print(f"[OK] Wrote EDA CSV to {output_path}")


def command_coverage_eda(args):
    report = generate_coverage_report(
        input_root=Path(args.in_root),
        summary_json_path=Path(args.summary_json),
        output_dir=Path(args.out_dir),
    )
    _print_json(report)


def command_audit_data(args):
    _, _, audit = build_app_data(
        input_root=Path(args.in_root),
        output_root=Path(args.temp_out_dir),
        timezone=args.timezone,
        fail_on_audit=False,
    )
    if args.out_json:
        Path(args.out_json).write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    _print_json(audit)
    if (
        audit["unresolvedGoogleCoreCount"] > 0
        or audit["missingBusinessStatusCount"] > 0
        or audit["allDayParseFailureCount"] > 0
    ):
        raise SystemExit(1)


def command_backfill_google(args):
    root = Path(args.in_root)
    selection = _queue_selection_from_args(args)
    queue_urls = None
    if selection is not None:
        queue_urls = ordered_queue_urls(
            selection["selectedRows"],
            priority_categories=args.priority_categories,
            url_column=args.queue_url_column,
            category_column=args.queue_category_column,
        )
    summary = backfill_google_records(
        root=root,
        queue_urls=queue_urls,
        include_business_status=not args.core_only,
        core_only=args.core_only,
        status_only=args.status_only,
        fetch_missing_tabelog_address=args.fetch_missing_tabelog_address,
        tabelog_sleep_seconds=args.tabelog_sleep_seconds,
        limit=args.limit,
        dry_run=args.dry_run,
    )
    if selection is not None:
        summary["queue"] = _queue_summary(selection)
    _print_json(summary)


def command_refresh_tabelog_hours(args):
    root = Path(args.in_root)
    selection = _queue_selection_from_args(args)
    queue_urls = None
    if selection is not None:
        queue_urls = ordered_queue_urls(
            selection["selectedRows"],
            priority_categories=args.priority_categories,
            url_column=args.queue_url_column,
            category_column=args.queue_category_column,
        )
    summary = refresh_tabelog_hours_records(
        root=root,
        queue_urls=queue_urls,
        structural_only=args.structural_only,
        quality_only=args.quality_only,
        limit=args.limit,
        dry_run=args.dry_run,
        sleep_seconds=args.sleep_seconds,
    )
    if selection is not None:
        summary["queue"] = _queue_summary(selection)
    _print_json(summary)


def command_close_gaps(args):
    input_root = Path(args.in_root)
    output_root = Path(args.out_dir)
    eda_dir = Path(args.eda_dir)

    selected_phases = args.phase or PHASE_ORDER
    invalid = sorted(set(selected_phases) - set(PHASE_ORDER))
    if invalid:
        raise ValueError(f"Unknown phases: {', '.join(invalid)}")

    result = {
        "dryRun": args.dry_run,
        "phases": [],
        "initial": _run_build_and_coverage(
            input_root=input_root,
            output_root=output_root,
            timezone=args.timezone,
            eda_dir=eda_dir,
        ),
    }

    for phase in selected_phases:
        if phase == "google-hard-gaps":
            selection = select_queue_rows(
                queue_csv=eda_dir / "raw_only_missing_from_webapp.csv",
                url_column="url",
                category_column="category",
            )
            queue_urls = ordered_queue_urls(
                selection["selectedRows"],
                priority_categories=GOOGLE_PRIORITY_CATEGORIES,
            )
            phase_run = backfill_google_records(
                root=input_root,
                queue_urls=queue_urls,
                include_business_status=False,
                core_only=True,
                fetch_missing_tabelog_address=True,
                tabelog_sleep_seconds=args.tabelog_sleep_seconds,
                limit=args.google_limit,
                dry_run=args.dry_run,
            )
        elif phase == "google-visible-gaps":
            selection = select_queue_rows(
                queue_csv=eda_dir / "visible_gap_inventory.csv",
                url_column="url",
                category_column="category",
                where=["missing_google_core=true"],
            )
            queue_urls = ordered_queue_urls(selection["selectedRows"])
            phase_run = backfill_google_records(
                root=input_root,
                queue_urls=queue_urls,
                include_business_status=False,
                core_only=True,
                fetch_missing_tabelog_address=True,
                tabelog_sleep_seconds=args.tabelog_sleep_seconds,
                limit=args.google_limit,
                dry_run=args.dry_run,
            )
        elif phase == "google-status":
            selection = None
            phase_run = backfill_google_records(
                root=input_root,
                queue_urls=None,
                include_business_status=True,
                status_only=True,
                fetch_missing_tabelog_address=False,
                tabelog_sleep_seconds=args.tabelog_sleep_seconds,
                limit=args.google_limit,
                dry_run=args.dry_run,
            )
        elif phase == "hours-structural":
            selection = select_queue_rows(
                queue_csv=eda_dir / "visible_gap_inventory.csv",
                url_column="url",
                category_column="category",
                where=["missing_hours_structural=true"],
            )
            queue_urls = ordered_queue_urls(
                selection["selectedRows"],
                priority_categories=HOURS_PRIORITY_CATEGORIES,
            )
            phase_run = refresh_tabelog_hours_records(
                root=input_root,
                queue_urls=queue_urls,
                structural_only=True,
                limit=args.hours_limit,
                dry_run=args.dry_run,
                sleep_seconds=args.sleep_seconds,
            )
        elif phase == "hours-quality":
            selection = select_queue_rows(
                queue_csv=eda_dir / "visible_gap_inventory.csv",
                url_column="url",
                category_column="category",
                where=["hours_need_review=true"],
            )
            queue_urls = ordered_queue_urls(
                selection["selectedRows"],
                priority_categories=HOURS_PRIORITY_CATEGORIES,
            )
            phase_run = refresh_tabelog_hours_records(
                root=input_root,
                queue_urls=queue_urls,
                quality_only=True,
                limit=args.hours_limit,
                dry_run=args.dry_run,
                sleep_seconds=args.sleep_seconds,
            )
        else:
            raise ValueError(f"Unhandled phase: {phase}")

        phase_result = {
            "phase": phase,
            "operation": phase_run,
        }
        if selection is not None:
            phase_result["queue"] = _queue_summary(selection)
        phase_result["verification"] = _run_build_and_coverage(
            input_root=input_root,
            output_root=output_root,
            timezone=args.timezone,
            eda_dir=eda_dir,
        )
        result["phases"].append(phase_result)

        if not args.dry_run and not args.allow_incomplete:
            failures = _phase_stop_condition_failures(phase, phase_result["verification"]["coverage"])
            if failures:
                _print_json(result)
                raise RuntimeError(f"Phase '{phase}' did not meet stop conditions: {', '.join(failures)}")

    _print_json(result)


def add_queue_args(parser):
    parser.add_argument("--queue-csv", help="Optional CSV queue generated by the coverage EDA.")
    parser.add_argument("--queue-url-column", default="url", help="URL column name in the queue CSV.")
    parser.add_argument("--queue-category-column", default="category", help="Category column name in the queue CSV.")
    parser.add_argument(
        "--where",
        action="append",
        default=[],
        help="Queue filter expression in the form column=value. May be repeated.",
    )
    parser.add_argument(
        "--categories",
        action="append",
        default=[],
        help="Optional category filter for queue rows. May be repeated or comma-separated.",
    )
    parser.add_argument(
        "--priority-categories",
        action="append",
        default=[],
        help="Optional priority category ordering for selected queue rows. May be repeated or comma-separated.",
    )


def build_parser():
    parser = argparse.ArgumentParser(description="Shared TabeMap data pipeline")
    subparsers = parser.add_subparsers(dest="command", required=True)

    build_parser_cmd = subparsers.add_parser("build-app-data", help="Build app data JSON artifacts")
    build_parser_cmd.add_argument("--in-root", required=True)
    build_parser_cmd.add_argument("--out-dir", required=True)
    build_parser_cmd.add_argument("--timezone", default="Asia/Tokyo")
    build_parser_cmd.add_argument("--audit-json")
    build_parser_cmd.add_argument("--eda-csv")
    build_parser_cmd.add_argument("--fail-on-audit", action="store_true")
    build_parser_cmd.set_defaults(func=command_build_app_data)

    export_parser = subparsers.add_parser("export-eda", help="Write analysis-ready CSV")
    export_parser.add_argument("--in-root", required=True)
    export_parser.add_argument("--out-csv", required=True)
    export_parser.add_argument("--temp-out-dir", default="static/data")
    export_parser.add_argument("--timezone", default="Asia/Tokyo")
    export_parser.set_defaults(func=command_export_eda)

    coverage_parser = subparsers.add_parser("coverage-eda", help="Generate coverage cross-reference outputs")
    coverage_parser.add_argument("--in-root", default="restaurant_data")
    coverage_parser.add_argument("--summary-json", default="static/data/places-summary.min.json")
    coverage_parser.add_argument("--out-dir", default="reports/eda")
    coverage_parser.set_defaults(func=command_coverage_eda)

    audit_parser = subparsers.add_parser("audit-data", help="Fail when required data gaps remain")
    audit_parser.add_argument("--in-root", required=True)
    audit_parser.add_argument("--out-json")
    audit_parser.add_argument("--temp-out-dir", default="static/data")
    audit_parser.add_argument("--timezone", default="Asia/Tokyo")
    audit_parser.set_defaults(func=command_audit_data)

    backfill_parser = subparsers.add_parser("backfill-google", help="Backfill missing Google fields")
    backfill_parser.add_argument("--in-root", required=True)
    backfill_parser.add_argument("--limit", type=int, help="Max number of records to attempt.")
    backfill_parser.add_argument("--dry-run", action="store_true")
    backfill_parser.add_argument("--core-only", action="store_true", help="Only attempt core Google field gaps.")
    backfill_parser.add_argument("--status-only", action="store_true", help="Only attempt missing business status gaps.")
    backfill_parser.add_argument(
        "--fetch-missing-tabelog-address",
        action="store_true",
        help="Fetch tabelog_address from the Tabelog page before Google matching when it is missing.",
    )
    backfill_parser.add_argument("--tabelog-sleep-seconds", type=float, default=0.0)
    add_queue_args(backfill_parser)
    backfill_parser.set_defaults(func=command_backfill_google)

    refresh_parser = subparsers.add_parser("refresh-tabelog-hours", help="Refresh missing or weak Tabelog hours")
    refresh_parser.add_argument("--in-root", required=True)
    refresh_parser.add_argument("--limit", type=int, help="Max number of records to attempt.")
    refresh_parser.add_argument("--dry-run", action="store_true")
    refresh_parser.add_argument("--structural-only", action="store_true", help="Only refresh records with structural hours gaps.")
    refresh_parser.add_argument("--quality-only", action="store_true", help="Only refresh low-confidence hours records.")
    refresh_parser.add_argument("--sleep-seconds", type=float, default=1.0)
    add_queue_args(refresh_parser)
    refresh_parser.set_defaults(func=command_refresh_tabelog_hours)

    close_gaps_parser = subparsers.add_parser(
        "close-gaps",
        help="Run the planned Google and hours remediation workflow with rebuild and coverage checks after each phase.",
    )
    close_gaps_parser.add_argument("--in-root", default="restaurant_data")
    close_gaps_parser.add_argument("--out-dir", default="static/data")
    close_gaps_parser.add_argument("--eda-dir", default="reports/eda")
    close_gaps_parser.add_argument("--timezone", default="Asia/Tokyo")
    close_gaps_parser.add_argument("--phase", action="append", choices=PHASE_ORDER)
    close_gaps_parser.add_argument("--dry-run", action="store_true")
    close_gaps_parser.add_argument("--allow-incomplete", action="store_true")
    close_gaps_parser.add_argument("--google-limit", type=int, help="Max number of Google records to attempt per phase.")
    close_gaps_parser.add_argument("--hours-limit", type=int, help="Max number of Tabelog hours refreshes to attempt per phase.")
    close_gaps_parser.add_argument("--sleep-seconds", type=float, default=1.0)
    close_gaps_parser.add_argument("--tabelog-sleep-seconds", type=float, default=0.0)
    close_gaps_parser.set_defaults(func=command_close_gaps)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
