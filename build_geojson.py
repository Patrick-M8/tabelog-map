#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import argparse, json, re, sys, math, os
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from collections import defaultdict, OrderedDict

# ---------------------- Category mapping & slugging ----------------------
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
    "立ち飲み": "Standing Bar"
}

def slugify(label: str) -> str:
    import unicodedata, re
    if not label:
        return "unknown"
    txt = unicodedata.normalize("NFKD", label).encode("ascii", "ignore").decode("ascii")
    txt = re.sub(r"[^A-Za-z0-9]+", "_", txt).strip("_").lower()
    return txt or "unknown"

# ---------------------- Hours parser (deterministic) ----------------------
DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DAY_ABBR = {"mon": "Mon", "tue": "Tue", "wed": "Wed", "thu": "Thu", "fri": "Fri", "sat": "Sat", "sun": "Sun"}
DAY_ALIASES = {
    "mon": "mon", "monday": "mon",
    "tue": "tue", "tuesday": "tue",
    "wed": "wed", "wednesday": "wed",
    "thu": "thu", "thursday": "thu",
    "fri": "fri", "friday": "fri",
    "sat": "sat", "saturday": "sat",
    "sun": "sun", "sunday": "sun",
}
SPECIAL_KEYS = {
    "public holiday": "public_holiday",
    "day before public holiday": "day_before_public_holiday",
    "day after public holiday": "day_after_public_holiday",
}

RANGE_RE = re.compile(r'(?P<s>\d{1,2}:\d{2})\s*[-–~]\s*(?P<e>\d{1,2}:\d{2})')
LO_RE = re.compile(r'(?i)L\.?\s*O\.?\s*(?:(Food|Foods?|Drink|Drinks?)\s*)?(?P<t>\d{1,2}:\d{2})')

def _norm(s: str) -> str:
    s = s.replace('〜','-').replace('–','-').replace('—','-').replace('～','-').replace('to','-')
    s = re.sub(r'\s+', ' ', s.strip())
    s = re.sub(r'(?i)L\.?\s*\.?O\.?', 'LO', s)
    return s

def _to_minutes(t: str) -> int:
    h, m = map(int, t.split(':'))
    h = 0 if h == 24 else h
    return h*60 + m

def _crosses_midnight(s: str, e: str) -> bool:
    return _to_minutes(e) <= _to_minutes(s)

def parse_time_ranges(dtl_text: str):
    text = _norm(dtl_text or "")
    ranges = [(m.start(), m.end(), m.group('s'), m.group('e'))
              for m in RANGE_RE.finditer(text)]
    los = [(m.start(), m.group(1).lower() if m.group(1) else None, m.group('t'))
           for m in LO_RE.finditer(text)]
    blocks = []
    for idx, (rs, re_, s, e) in enumerate(ranges):
        block = OrderedDict()
        block["open"], block["close"] = s, e
        block["crosses_midnight"] = _crosses_midnight(s, e)
        block["last_order"] = {}
        next_range_start = ranges[idx + 1][0] if idx + 1 < len(ranges) else float('inf')
        for lo_pos, lo_kind, lo_time in los:
            if rs <= lo_pos < next_range_start:
                if not lo_kind:
                    block["last_order"]["generic"] = lo_time
                elif 'drink' in lo_kind:
                    block["last_order"]["drinks"] = lo_time
                else:
                    block["last_order"]["food"] = lo_time
        if not block["last_order"]:
            block["last_order"] = None
        blocks.append(block)
    return blocks

def _split_and_normalize_days(title: str):
    if not title:
        return [], {}
    chunks = [c.strip() for c in title.split(",")]
    weekday_days = []
    special = {}
    for c in chunks:
        key = c.lower()
        if key in DAY_ALIASES:
            weekday_days.append(DAY_ALIASES[key])
        elif key in SPECIAL_KEYS:
            special[SPECIAL_KEYS[key]] = True
        else:
            key2 = key.replace(" to ", "-").replace("–","-").replace("—","-")
            m = re.match(r'([A-Za-z]{3,9})\s*-\s*([A-Za-z]{3,9})', key2)
            if m:
                a, b = m.group(1).lower(), m.group(2).lower()
                a = DAY_ALIASES.get(a, a[:3])
                b = DAY_ALIASES.get(b, b[:3])
                if a in DAY_ORDER and b in DAY_ORDER:
                    ia, ib = DAY_ORDER.index(a), DAY_ORDER.index(b)
                    if ia <= ib: weekday_days.extend(DAY_ORDER[ia:ib+1])
                    else: weekday_days.extend(DAY_ORDER[ia:] + DAY_ORDER[:ib+1])
            else:
                special.setdefault("raw_titles", set()).add(c)
    return weekday_days, special

def group_days(day_blocks):
    if not day_blocks:
        return ""
    days = sorted(set(day_blocks), key=lambda d: DAY_ORDER.index(d))
    ranges = []
    cur = [days[0]]
    for d in days[1:]:
        if DAY_ORDER.index(d) == DAY_ORDER.index(cur[-1]) + 1:
            cur.append(d)
        else:
            ranges.append(cur); cur = [d]
    ranges.append(cur)
    parts = []
    for r in ranges:
        if len(r) == 1: parts.append(DAY_ABBR[r[0]])
        else: parts.append(f"{DAY_ABBR[r[0]]}–{DAY_ABBR[r[-1]]}")
    return ", ".join(parts)

def _range_label_for_display(b):
    seg = f"{b['open']}–{b['close']}"
    lo = b.get("last_order") or {}
    parts = []
    if lo.get("food"): parts.append(f"Food {lo['food']}")
    if lo.get("drinks"): parts.append(f"Drinks {lo['drinks']}")
    if lo.get("generic") and not parts: parts.append(lo["generic"])
    if parts: seg += f" (LO {' / '.join(parts)})"
    return seg

def compact_today(blocks_for_day):
    if blocks_for_day == "closed" or not blocks_for_day:
        return "Closed"
    labels = []
    for i, b in enumerate(blocks_for_day):
        seg = f"{b['open']}–{b['close']}"
        lo = b.get("last_order")
        lo_parts = []
        if lo:
            if lo.get("food"): lo_parts.append(f"Food {lo['food']}")
            if lo.get("drinks"): lo_parts.append(f"Drinks {lo['drinks']}")
            if lo.get("generic") and not (lo.get("food") or lo.get("drinks")):
                lo_parts.append(lo["generic"])
        if lo_parts: seg += f" (LO {' / '.join(lo_parts)})"
        labels.append(seg)
    if len(blocks_for_day) >= 2:
        for a, b in zip(blocks_for_day, blocks_for_day[1:]):
            labels.insert(1, f"Break {a['close']}–{b['open']}"); break
    return " · ".join(labels)

def calc_open_now(blocks_for_day, now_local):
    if blocks_for_day == "closed" or not blocks_for_day:
        return {"status": "closed"}
    now_min = now_local.hour*60 + now_local.minute
    for b in blocks_for_day:
        start = _to_minutes(b["open"]); end = _to_minutes(b["close"]); crosses = b["crosses_midnight"]
        in_window = False; closes_in = None; lo_in = None
        if not crosses:
            in_window = (start <= now_min < end)
            if in_window: closes_in = end - now_min
        else:
            in_window = (now_min >= start) or (now_min < end)
            if in_window: closes_in = (24*60 - now_min) + end if now_min >= start else end - now_min
        if in_window:
            lo = b.get("last_order"); 
            if lo:
                lo_times = []
                for k in ["generic","food","drinks"]:
                    t = lo.get(k)
                    if t: lo_times.append(_to_minutes(t))
                if lo_times:
                    lo_t = min(lo_times)
                    if not crosses:
                        lo_in = max(lo_t - now_min, 0) if now_min <= lo_t <= end else None
                    else:
                        if now_min >= start:
                            lo_in = max(lo_t - now_min, 0) if lo_t >= start else (24*60 - now_min) + lo_t
                        else:
                            lo_in = max(lo_t - now_min, 0) if lo_t >= now_min else None
            return {
                "status": "open",
                "segment": {"start": b["open"], "end": b["close"], "last_order": lo or None},
                "closes_in_min": closes_in, "lo_in_min": lo_in, "crosses_midnight": crosses,
            }
    first_future = None
    for b in blocks_for_day:
        st = _to_minutes(b["open"])
        if b.get("carried_from_prev"):
            continue
        if st > now_min:
            first_future = st - now_min; break
    return {"status": "closed", "opens_in_min": first_future}

def format_next_change(open_now):
    if open_now.get("status") == "open":
        mins = open_now.get("closes_in_min"); lo = open_now.get("lo_in_min")
        parts = []
        if lo is not None and lo > 0: parts.append(f"LO in {lo}m")
        if mins is not None: parts.append(f"Closes in {mins}m")
        return " · ".join(parts) if parts else "Open"
    else:
        oi = open_now.get("opens_in_min")
        if oi is None: return "Closed"
        if oi < 60: return f"Opens in {oi}m"
        h, m = oi//60, oi%60
        return f"Opens in {h}h {m}m" if m else f"Opens in {h}h"

def week_compact_pretty(weekly):
    from collections import defaultdict
    by_sig, sig_blocks = defaultdict(list), {}
    for d in DAY_ORDER:
        blocks = weekly.get(d)
        if blocks == "closed" or not blocks:
            sig = "closed"
        else:
            parts = []
            for b in blocks:
                lo = b.get("last_order") or {}
                lo_sig = ";".join([f"{k}:{v}" for k, v in sorted(lo.items())]) if lo else ""
                parts.append(f"{b['open']}-{b['close']}|{lo_sig}")
            sig = "||".join(parts)
        by_sig[sig].append(d); sig_blocks[sig] = blocks
    pieces = []
    for sig, days in by_sig.items():
        label = group_days(days); blocks = sig_blocks[sig]
        if sig == "closed": pieces.append(f"{label} closed")
        else: pieces.append(f"{label} " + " · ".join(_range_label_for_display(b) for b in blocks))
    return "; ".join(pieces)

def build_schedule_fixed(hours_raw, notes_structured=None):
    weekly = {d: [] for d in DAY_ORDER}
    exceptions = {"policies": []}
    if not hours_raw: return weekly, exceptions
    for entry in hours_raw:
        title = entry.get("title") or entry.get("list_title") or ""
        dtl = entry.get("dtl") or entry.get("dtl_text") or entry.get("dtlText") or ""
        days, special = _split_and_normalize_days(title)
        dtl_lower = (dtl or "").strip().lower()
        explicit_closed = (dtl_lower == "closed") or (("closed" in dtl_lower) and not RANGE_RE.search(dtl_lower))
        if explicit_closed:
            for day in days: weekly[day] = "closed"
            continue
        blocks = parse_time_ranges(dtl)
        for day in days:
            if weekly.get(day) != "closed":
                weekly[day].extend(blocks)
        if "raw_titles" in special:
            exceptions["policies"].extend(sorted(list(special["raw_titles"])))
        for sk in SPECIAL_KEYS.values():
            if sk in special: exceptions.setdefault(sk, []).extend(blocks)
    if isinstance(notes_structured, dict):
        closed_on = notes_structured.get("closed_on")
        if closed_on: exceptions["policies"].append(closed_on)
    return weekly, exceptions

def summarize_for_today(weekly, local_now):
    dow = DAY_ORDER[local_now.weekday()]
    blocks_today = weekly.get(dow) or "closed"
    blocks_for_status = [] if blocks_today == "closed" else list(blocks_today)

    prev_dow = DAY_ORDER[(local_now.weekday() - 1) % 7]
    prev_blocks = weekly.get(prev_dow) or []
    if prev_blocks != "closed":
        for b in prev_blocks:
            if b.get("crosses_midnight"):
                carried = dict(b)
                carried["carried_from_prev"] = True
                blocks_for_status.append(carried)

    return compact_today(blocks_today), calc_open_now(blocks_for_status or "closed", local_now)

# ---------------------- Feature conversion ----------------------
YEN_NUM = re.compile(r"\d+")
def parse_price_band(s: str | None):
    if not s or s.strip() == "-": return (None, None)
    s2 = s.replace(",", "")
    nums = list(map(int, YEN_NUM.findall(s2)))
    if "～" in s2 and s2.strip().startswith("～"):
        hi = nums[-1] if nums else None; return (0, hi)
    if "～" in s2 or "-" in s2:
        lo = nums[0] if nums else None
        hi = nums[-1] if len(nums) >= 2 else None
        return (lo, hi)
    v = nums[0] if nums else None
    return (v, v)

def price_bucket(lo, hi):
    v = lo if lo is not None else 0
    if hi is not None:
        v = (v + hi) // 2 if lo is not None else hi
    if v == 0: return 0
    if v <= 999: return 1
    if v <= 1999: return 2
    if v <= 2999: return 3
    if v <= 4999: return 4
    return 5

def choose_price(rec):
    dl_lo, dl_hi = parse_price_band(rec.get("price_dinner"))
    ln_lo, ln_hi = parse_price_band(rec.get("price_lunch"))
    pref_lo, pref_hi = (dl_lo, dl_hi) if dl_lo is not None or dl_hi is not None else (ln_lo, ln_hi)
    bkt = price_bucket(pref_lo, pref_hi)
    min_any = min([x for x in [dl_lo, ln_lo] if x is not None], default=None)
    return {
        "dinner_raw": rec.get("price_dinner"),
        "lunch_raw":  rec.get("price_lunch"),
        "dinner_lo":  dl_lo, "dinner_hi": dl_hi,
        "lunch_lo":   ln_lo, "lunch_hi": ln_hi,
        "bucket":     bkt,
        "min_for_sort": min_any
    }

def safe_rating(v):
    try: return float(v) if v is not None else None
    except: return None

def pick_subcats(rec):
    s = rec.get("sub_categories", "")
    return [c.strip() for c in s.split(",")] if s else []

def derive_category(rec):
    jp = rec.get("category_jp")
    en = rec.get("category_en")
    if jp and not en: en = JP_TO_EN.get(jp, None)
    if en and not jp:
        jp = next((k for k,v in JP_TO_EN.items() if v == en), None)
    if not en and not jp:
        return {"jp": None, "en": None, "key": "unknown"}
    label_en = en or JP_TO_EN.get(jp) or "Unknown"
    key = slugify(label_en)
    return {"jp": jp, "en": label_en, "key": key}

def to_feature(rec, tz=ZoneInfo("Asia/Tokyo")):
    lng, lat = rec.get("lng"), rec.get("lat")
    if lng is None or lat is None:
        return None
    hrs_raw, notes_structured = rec.get("hours_raw"), rec.get("hours_notes_structured")
    weekly, exceptions = build_schedule_fixed(hrs_raw, notes_structured)
    now = datetime.now(tz)
    today_str, open_now = summarize_for_today(weekly, now)
    closes_in_min = open_now.get("closes_in_min") if open_now.get("status") == "open" else None
    prices = choose_price(rec)
    policy_chips = []
    for p in (exceptions.get("policies") or []):
        low = p.lower()
        if "open year" in low: policy_chips.append("Open year-round")
        elif "not fixed" in low or "irregular" in low: policy_chips.append("Hours vary")
        elif "new year" in low: policy_chips.append("New Year hours differ")
        else: policy_chips.append(p)
    cat = derive_category(rec)
    props = OrderedDict()
    props["id"] = rec.get("place_id") or rec.get("url")
    props["name"] = rec.get("name_en") or rec.get("name")
    props["name_local"] = rec.get("name")
    props["region"] = rec.get("region")
    props["area"] = rec.get("area")
    props["category"] = {"jp": cat["jp"], "en": cat["en"]}
    props["sub_categories"] = pick_subcats(rec)
    props["image_url"] = rec.get("image_url")
    props["urls"] = {"tabelog": rec.get("url"), "google": rec.get("google_maps_url")}
    props["address"] = rec.get("g_address") or rec.get("area")
    props["ratings"] = {
        "tabelog": {"score": safe_rating(rec.get("rating")), "reviews": rec.get("review_count_tabelog")},
        "google":  {"score": safe_rating(rec.get("google_rating") or rec.get("g_rating")), 
                    "reviews": rec.get("google_reviews") or rec.get("g_reviews")}
    }
    props["has_google"] = props["ratings"]["google"]["score"] is not None
    props["price"] = prices
    props["hours"] = {
        "weekly": weekly,
        "today_compact": today_str,
        "week_compact": week_compact_pretty(weekly),
        "open_now": open_now,
        "policy_chips": policy_chips
    }
    props["sort_keys"] = {
        "open_rank": 2 if open_now.get("status") == "open" else 0,
        "closes_in_min": closes_in_min,
        "price_min": prices["min_for_sort"],
        "rating_tabelog": props["ratings"]["tabelog"]["score"],
        "rating_google": props["ratings"]["google"]["score"]
    }
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lng, lat]},
        "properties": props,
        "_category_key": cat["key"],
    }

# ---------------------- IO helpers ----------------------
def read_json_file(path: Path):
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"[WARN] Failed to read {path}: {e}", file=sys.stderr)
        return []
    if isinstance(data, list): return data
    if isinstance(data, dict):
        for k in ("restaurants","items","results","data"):
            if k in data and isinstance(data[k], list): return data[k]
        return list(data.values())
    return []

def quantize_coord(val: float, decimals: int = 4) -> float:
    return float(f"{val:.{decimals}f}")

def bbox_update(bbox, lng, lat):
    minx, miny, maxx, maxy = bbox
    if lng < minx: minx = lng
    if lng > maxx: maxx = lng
    if lat < miny: miny = lat
    if lat > maxy: maxy = lat
    return [minx, miny, maxx, maxy]

# ---------------------- Main build ----------------------
def build(args):
    in_root = Path(args.in_root).expanduser()
    out_dir = Path(args.out_dir).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)
    tz = ZoneInfo(args.timezone)
    json_files = sorted(in_root.rglob("*.json"))
    print(f"[INFO] Found {len(json_files)} JSON files under {in_root}")
    categories = defaultdict(list)
    bboxes = {}
    counts  = defaultdict(int)
    for jf in json_files:
        records = read_json_file(jf)
        if not records: continue
        for rec in records:
            feat = to_feature(rec, tz=tz)
            if not feat: 
                continue
            key = feat.pop("_category_key", "unknown")
            categories[key].append(feat)
            counts[key] += 1
            lng, lat = feat["geometry"]["coordinates"]
            if key not in bboxes:
                bboxes[key] = [lng, lat, lng, lat]
            else:
                bboxes[key] = bbox_update(bboxes[key], lng, lat)
    # Write per-category GeoJSON
    manifest_items = []
    centroids = {}
    for key, feats in categories.items():
        fc = {"type": "FeatureCollection", "features": feats}
        out_name = f"{key}_{args.version}.min.geojson"
        out_path = out_dir / out_name
        with out_path.open("w", encoding="utf-8") as f:
            json.dump(fc, f, ensure_ascii=False, separators=(",",":"))
        pts = []
        step = max(1, math.ceil(len(feats) / max(1, args.centroid_max)))
        use_feats = feats[::step] if step > 1 else feats
        for feat in use_feats:
            lng, lat = feat["geometry"]["coordinates"]
            pts.append([quantize_coord(lng, args.coord_decimals), quantize_coord(lat, args.coord_decimals)])
        centroids[key] = pts
        label_guess = feats[0]["properties"]["category"]["en"] or key.title().replace("_"," ")
        manifest_items.append({
            "key": key,
            "label": label_guess,
            "url": f"geojson/{out_name}",
            "count": counts[key],
            "bbox": bboxes.get(key, None)
        })
        print(f"[OK] Wrote {out_name}  features={len(feats)}  bbox={bboxes.get(key)}")
    # Write centroids index
    centroids_path = out_dir / "category_centroids.min.json"
    with centroids_path.open("w", encoding="utf-8") as f:
        json.dump(centroids, f, ensure_ascii=False, separators=(",",":"))
    print(f"[OK] Wrote category_centroids.min.json")
    # Write manifest
    manifest = {"categories": sorted(manifest_items, key=lambda x: x["label"].lower())}
    manifest_path = out_dir / "manifest.json"
    with manifest_path.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"[OK] Wrote manifest.json")
def main():
    import argparse
    ap = argparse.ArgumentParser(description="Build per-category GeoJSON, centroids index, and manifest for GitHub Pages.")
    ap.add_argument("--in-root", required=True, help="Root folder containing category_region_year JSON files (scans recursively).")
    ap.add_argument("--out-dir", required=True, help="Output folder (e.g., ./docs/geojson).")
    ap.add_argument("--version", default="v2025", help="Version suffix for per-category files.")
    ap.add_argument("--centroid-max", type=int, default=4000, help="Max points per category in centroid index (downsamples if exceeded).")
    ap.add_argument("--coord-decimals", type=int, default=4, help="Coordinate precision for centroids index.")
    ap.add_argument("--timezone", default="Asia/Tokyo", help="Timezone for 'open now' computation.")
    args = ap.parse_args()
    build(args)
if __name__ == "__main__":
    main()
