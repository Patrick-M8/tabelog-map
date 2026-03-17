#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from scripts.pipeline.geojson import build_geojson_artifacts


def parse_args():
    parser = argparse.ArgumentParser(
        description="Build per-category GeoJSON artifacts from the shared TabeMap pipeline."
    )
    parser.add_argument("--in-root", required=True, help="Root folder containing raw restaurant JSON files.")
    parser.add_argument("--out-dir", required=True, help="Output folder (for example ./docs/geojson).")
    parser.add_argument("--version", default="v2025", help="Version suffix for per-category GeoJSON files.")
    parser.add_argument(
        "--centroid-max",
        type=int,
        default=4000,
        help="Max points per category in the centroid index before downsampling.",
    )
    parser.add_argument(
        "--coord-decimals",
        type=int,
        default=4,
        help="Coordinate precision for the centroid index.",
    )
    parser.add_argument("--timezone", default="Asia/Tokyo", help="Timezone used for hours normalization.")
    return parser.parse_args()


def main():
    args = parse_args()
    result = build_geojson_artifacts(
        input_root=Path(args.in_root),
        output_root=Path(args.out_dir),
        version=args.version,
        centroid_max=args.centroid_max,
        coord_decimals=args.coord_decimals,
        timezone=args.timezone,
    )
    print(
        f"[OK] Wrote {result['categoryCount']} category GeoJSON files and "
        f"{result['featureCount']} total features to {args.out_dir}"
    )


if __name__ == "__main__":
    main()
