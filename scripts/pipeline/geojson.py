from __future__ import annotations

import json
import math
from collections import OrderedDict, defaultdict
from pathlib import Path

from .builders import collect_entries


def quantize_coord(value: float, decimals: int = 4):
    return float(f"{value:.{decimals}f}")


def bbox_update(bbox, lng, lat):
    minx, miny, maxx, maxy = bbox
    if lng < minx:
        minx = lng
    if lng > maxx:
        maxx = lng
    if lat < miny:
        miny = lat
    if lat > maxy:
        maxy = lat
    return [minx, miny, maxx, maxy]


def entry_to_feature(entry: dict):
    props = OrderedDict()
    props["id"] = entry["placeId"] or entry["id"]
    props["name"] = entry["nameEn"] or entry["nameJp"]
    props["name_local"] = entry["nameJp"]
    props["region"] = entry["region"]
    props["area"] = entry["area"]
    props["station"] = entry["station"]
    props["category"] = {"jp": entry["category"]["labelJp"], "en": entry["category"]["label"]}
    props["sub_categories"] = entry["subCategories"]
    props["image_url"] = entry["imageUrl"]
    props["urls"] = entry["sourceLinks"]
    props["address"] = entry["address"]
    props["ratings"] = {"tabelog": entry["tabelog"], "google": entry["google"]}
    props["price"] = {
        "dinner_raw": entry["priceDinner"],
        "lunch_raw": entry["priceLunch"],
        "bucket": entry["priceBucket"],
        "display_band": entry["priceBand"],
    }
    props["hours"] = {
        "weekly": entry["weeklyTimeline"],
        "today_compact": entry["hoursDisplay"]["today"],
        "week_compact": entry["hoursDisplay"]["week"],
        "special_days": entry["hoursSpecialDays"],
        "policies": entry["hoursPolicies"],
        "confidence": entry["hoursConfidence"],
        "open_now": entry["_openNowMeta"],
    }
    props["closure"] = entry["closure"]
    props["badges"] = entry["badges"]
    props["sort_keys"] = {
        "consensus_score": entry["consensusScore"],
        "consensus_grade": entry["consensusGrade"],
        "price_bucket": entry["priceBucket"],
        "google_rating": entry["google"]["score"],
        "tabelog_rating": entry["tabelog"]["score"],
    }
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [entry["lng"], entry["lat"]]},
        "properties": props,
        "_category_key": entry["category"]["key"],
    }


def build_geojson_artifacts(
    *,
    input_root: Path,
    output_root: Path,
    version: str = "v2025",
    centroid_max: int = 4000,
    coord_decimals: int = 4,
    timezone: str = "Asia/Tokyo",
):
    output_root.mkdir(parents=True, exist_ok=True)
    _, _, entries = collect_entries(input_root=input_root, timezone=timezone)

    categories = defaultdict(list)
    bboxes = {}
    counts = defaultdict(int)

    for entry in entries:
        feature = entry_to_feature(entry)
        key = feature.pop("_category_key", "unknown")
        categories[key].append(feature)
        counts[key] += 1
        lng, lat = feature["geometry"]["coordinates"]
        if key not in bboxes:
            bboxes[key] = [lng, lat, lng, lat]
        else:
            bboxes[key] = bbox_update(bboxes[key], lng, lat)

    manifest_items = []
    centroids = {}
    for key, features in categories.items():
        feature_collection = {"type": "FeatureCollection", "features": features}
        out_name = f"{key}_{version}.min.geojson"
        out_path = output_root / out_name
        out_path.write_text(json.dumps(feature_collection, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

        step = max(1, math.ceil(len(features) / max(1, centroid_max)))
        sampled_features = features[::step] if step > 1 else features
        centroids[key] = [
            [
                quantize_coord(feature["geometry"]["coordinates"][0], coord_decimals),
                quantize_coord(feature["geometry"]["coordinates"][1], coord_decimals),
            ]
            for feature in sampled_features
        ]

        label_guess = features[0]["properties"]["category"]["en"] or key.replace("_", " ").title()
        manifest_items.append(
            {
                "key": key,
                "label": label_guess,
                "url": f"geojson/{out_name}",
                "count": counts[key],
                "bbox": bboxes.get(key),
            }
        )

    (output_root / "category_centroids.min.json").write_text(
        json.dumps(centroids, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (output_root / "manifest.json").write_text(
        json.dumps({"categories": sorted(manifest_items, key=lambda item: item["label"].lower())}, ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )

    return {
        "categoryCount": len(categories),
        "featureCount": len(entries),
        "manifestPath": str(output_root / "manifest.json"),
        "centroidsPath": str(output_root / "category_centroids.min.json"),
    }
