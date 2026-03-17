import json
import os
from pathlib import Path

# === CONFIGURATION ===
OLD_JSON = "Full_Tabelog_List.json"
NEW_FOLDER = "json_exports"
OUTPUT_FOLDER = "merged_exports"

# === CREATE OUTPUT FOLDER ===
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

# === LOAD OLD DATA ===
with open(OLD_JSON, "r", encoding="utf-8") as f:
    old_data = json.load(f)

# Build lookup table from old data
old_lookup = {entry["url"]: entry for entry in old_data if "url" in entry}

print(f"Loaded {len(old_lookup)} old entries from {OLD_JSON}")

# === Fields to recycle ===
GOOGLE_FIELDS = [
    "google_rating",
    "google_reviews",
    "google_maps_url",
    "place_id",
    "g_name",
    "g_address",
    "lat",
    "lng",
    "g_rating",
    "g_reviews",
]

# === PROCESS NEW FILES ===
for file in Path(NEW_FOLDER).glob("*.json"):
    try:
        with open(file, "r", encoding="utf-8") as f:
            new_data = json.load(f)

        enriched = 0
        for entry in new_data:
            url = entry.get("url")
            if not url or url not in old_lookup:
                continue

            old_entry = old_lookup[url]

            for field in GOOGLE_FIELDS:
                if (
                    field in old_entry
                    and (
                        field not in entry
                        or entry[field] in ("", None, 0)
                    )
                ):
                    entry[field] = old_entry[field]
                    enriched += 1

        output_path = Path(OUTPUT_FOLDER) / file.name
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(new_data, f, ensure_ascii=False, indent=2)

        print(f"✅ {file.name}: enriched {enriched} fields → saved to {output_path}")

    except Exception as e:
        print(f"⚠️ Failed processing {file}: {e}")

print("\n🎉 Merge completed. Enriched files are in:", OUTPUT_FOLDER)
