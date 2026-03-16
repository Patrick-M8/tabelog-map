#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from scripts.pipeline.builders import build_app_data


def parse_args():
    parser = argparse.ArgumentParser(description="Build summary/detail data artifacts for the TabeMap app.")
    parser.add_argument("--in-root", required=True, help="Input folder with raw restaurant JSON files.")
    parser.add_argument("--out-dir", required=True, help="Output folder for static JSON data.")
    parser.add_argument("--timezone", default="Asia/Tokyo", help="Timezone used for freshness metadata.")
    parser.add_argument("--audit-json", help="Optional path for a detailed JSON audit report.")
    parser.add_argument("--eda-csv", help="Optional path for an analysis-ready CSV export.")
    parser.add_argument("--fail-on-audit", action="store_true", help="Fail when the audit still has blocking data gaps.")
    return parser.parse_args()


def main():
    args = parse_args()
    summary, detail, audit = build_app_data(
        input_root=Path(args.in_root),
        output_root=Path(args.out_dir),
        timezone=args.timezone,
        audit_json_path=Path(args.audit_json) if args.audit_json else None,
        eda_csv_path=Path(args.eda_csv) if args.eda_csv else None,
        fail_on_audit=args.fail_on_audit,
    )
    print(
        f"[OK] Wrote {len(summary)} summaries and {len(detail)} details to {args.out_dir} "
        f"(core gaps={audit['unresolvedGoogleCoreCount']}, closure gaps={audit['missingBusinessStatusCount']}, "
        f"all-day parse failures={audit['allDayParseFailureCount']})"
    )


if __name__ == "__main__":
    main()
