from __future__ import annotations

import argparse
import json
from pathlib import Path

from .builders import build_app_data, export_eda_csv
from .google import GooglePlacesClient, merge_google_fields, resolve_google_place, should_backfill_google
from .records import iter_record_files, load_record_container, write_record_container
from .tabelog import make_session as make_tabelog_session
from .tabelog import refresh_restaurant_record, should_refresh_hours


def command_build_app_data(args):
    _, _, audit = build_app_data(
        input_root=Path(args.in_root),
        output_root=Path(args.out_dir),
        timezone=args.timezone,
        audit_json_path=Path(args.audit_json) if args.audit_json else None,
        eda_csv_path=Path(args.eda_csv) if args.eda_csv else None,
        fail_on_audit=args.fail_on_audit,
    )
    print(json.dumps(audit, ensure_ascii=False, indent=2))


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


def command_audit_data(args):
    _, _, audit = build_app_data(
        input_root=Path(args.in_root),
        output_root=Path(args.temp_out_dir),
        timezone=args.timezone,
        fail_on_audit=False,
    )
    if args.out_json:
        Path(args.out_json).write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(audit, ensure_ascii=False, indent=2))
    if (
        audit["unresolvedGoogleCoreCount"] > 0
        or audit["missingBusinessStatusCount"] > 0
        or audit["allDayParseFailureCount"] > 0
    ):
        raise SystemExit(1)


def command_backfill_google(args):
    root = Path(args.in_root)
    client = GooglePlacesClient(cwd=root)
    updated_count = 0

    for path in iter_record_files(root):
        original_payload, records = load_record_container(path)
        next_records = []
        changed = False
        for record in records:
            if not should_backfill_google(record):
                next_records.append(record)
                continue
            enrichment = resolve_google_place(record, client)
            if enrichment is None:
                next_records.append(record)
                continue
            next_records.append(merge_google_fields(record, enrichment))
            updated_count += 1
            changed = True
            if args.limit and updated_count >= args.limit:
                break

        if changed and not args.dry_run:
            write_record_container(path, original_payload, next_records + records[len(next_records) :])

        if args.limit and updated_count >= args.limit:
            break

    print(f"[OK] Updated {updated_count} records")


def command_refresh_tabelog_hours(args):
    root = Path(args.in_root)
    session = make_tabelog_session()
    refreshed = 0

    for path in iter_record_files(root):
        original_payload, records = load_record_container(path)
        next_records = []
        changed = False
        for record in records:
            if not should_refresh_hours(record):
                next_records.append(record)
                continue
            next_records.append(refresh_restaurant_record(record, session=session, sleep_seconds=args.sleep_seconds))
            refreshed += 1
            changed = True
            if args.limit and refreshed >= args.limit:
                break

        if changed and not args.dry_run:
            write_record_container(path, original_payload, next_records + records[len(next_records) :])

        if args.limit and refreshed >= args.limit:
            break

    print(f"[OK] Refreshed {refreshed} records")


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

    audit_parser = subparsers.add_parser("audit-data", help="Fail when required data gaps remain")
    audit_parser.add_argument("--in-root", required=True)
    audit_parser.add_argument("--out-json")
    audit_parser.add_argument("--temp-out-dir", default="static/data")
    audit_parser.add_argument("--timezone", default="Asia/Tokyo")
    audit_parser.set_defaults(func=command_audit_data)

    backfill_parser = subparsers.add_parser("backfill-google", help="Backfill missing Google fields")
    backfill_parser.add_argument("--in-root", required=True)
    backfill_parser.add_argument("--limit", type=int)
    backfill_parser.add_argument("--dry-run", action="store_true")
    backfill_parser.set_defaults(func=command_backfill_google)

    refresh_parser = subparsers.add_parser("refresh-tabelog-hours", help="Refresh missing or weak Tabelog hours")
    refresh_parser.add_argument("--in-root", required=True)
    refresh_parser.add_argument("--limit", type=int)
    refresh_parser.add_argument("--dry-run", action="store_true")
    refresh_parser.add_argument("--sleep-seconds", type=float, default=1.0)
    refresh_parser.set_defaults(func=command_refresh_tabelog_hours)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
