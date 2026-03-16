import requests
from bs4 import BeautifulSoup
import json
import time
import traceback
import re
import os
from urllib.parse import urljoin, urlparse
from requests.adapters import HTTPAdapter, Retry


# ---------------- CONFIG ----------------
GOOGLE_PLACES_URL = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
BASE_URL = "https://award.tabelog.com"
YEAR_START = 2025
YEAR_MIN = 2017  # fallback lower bound
DEBUG = 0  # toggle for verbose output
# ---------------------------------------


# ---------------- SESSION SETUP ----------------
headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0 Safari/537.36"
}
session = requests.Session()
retries = Retry(total=5, backoff_factor=0.6, status_forcelist=(429, 500, 502, 503, 504))
session.mount("https://", HTTPAdapter(max_retries=retries))
session.headers.update(headers)
# ----------------------------------------------


# ---------------- CATEGORY TRANSLATION ----------------
CATEGORY_TRANSLATIONS = {
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
    "アイス・ジェラート": "Ice, Gelato",
    "バー": "Bar",
    "パン": "Bakery",
    "立ち飲み": "Standing Bar",
    "アイス・ジェラート": "Ice Cream & Gelato"
}
# ------------------------------------------------------


def jp_to_en_category(jp: str) -> str:
    return CATEGORY_TRANSLATIONS.get(jp, jp)


def safe_join(base, href):
    if not href:
        return None
    if bool(urlparse(href).netloc):
        return href
    return urljoin(base, href)


def google_api_key():
    value = os.getenv("GOOGLE_MAPS_API_KEY") or os.getenv("GOOGLE_PLACES_API_KEY")
    if value:
        return value
    raise RuntimeError("Set GOOGLE_MAPS_API_KEY or GOOGLE_PLACES_API_KEY before running the legacy Google scraper.")


# ---------------- CATEGORY URL SCRAPER ----------------
def get_category_urls():
    url = f"{BASE_URL}/hyakumeiten"
    try:
        res = session.get(url, timeout=10)
        res.raise_for_status()
        soup = BeautifulSoup(res.text, "html.parser")
    except Exception as e:
        print(f"[ERROR] Failed to fetch category page: {e}")
        return []

    categories = []
    seen = set()
    for item in soup.select("ul.hyakumeiten-nav__list li.hyakumeiten-nav__item"):
        name_tag = item.select_one("div.hyakumeiten-nav__item-name p")
        if not name_tag:
            continue
        category_name_jp = name_tag.get_text(strip=True).replace(" 百名店", "")
        for selector in [
            "a.hyakumeiten-nav__area-target",
            "a.hyakumeiten-nav__twoareas-target",
            "a.hyakumeiten-nav__sixareas-target",
            "a.hyakumeiten-nav__threeareas-kagawa-target",
            "a.hyakumeiten-nav__item-target",
        ]:
            for a in item.select(selector):
                href = a.get("href")
                region_name = a.get_text(strip=True).upper() or "ALL"
                abs_url = safe_join(BASE_URL, href)
                key = (category_name_jp, region_name, abs_url)
                if abs_url and key not in seen:
                    seen.add(key)
                    categories.append((category_name_jp, region_name, abs_url))
    return categories
# -------------------------------------------------------


# ---------------- YEAR RESOLUTION ----------------
def strip_year_suffix(url: str) -> str:
    m = re.search(r"/20\d{2}/?$", url)
    if m:
        return url[:m.start()].rstrip("/")
    return url.rstrip("/")


def page_has_shops(html: str) -> bool:
    soup = BeautifulSoup(html, "html.parser")
    return bool(soup.select_one("div.hyakumeiten-shop__item, div.hyakumeiten-shop__block"))


def resolve_yeared_url(url: str, start_year: int = YEAR_START, min_year: int = YEAR_MIN) -> str:
    """
    Always prefer the latest year (e.g., 2025) when possible.
    Only fall back to older years if the latest page truly has no restaurant data.
    Keeps regional suffixes (e.g., _east) intact.
    """
    root = strip_year_suffix(url)
    tried = []

    # ✅ Detect if the category slug has a region (e.g., 'izakaya_east')
    match_region = re.search(r"/hyakumeiten/([a-z0-9_]+)/?", root)
    region_slug = match_region.group(1) if match_region else None
    has_region = region_slug and "_" in region_slug

    # Step 1: Always try the latest year first
    latest = f"{root}/{start_year}"
    try:
        r_latest = session.get(latest, timeout=10, allow_redirects=True)
        tried.append(latest)
        if r_latest.status_code == 200 and page_has_shops(r_latest.text):
            print(f"[YEAR] ✅ Using latest available year {start_year} for {root}")
            return latest
        else:
            print(f"[YEAR] ⚠️ {start_year} page found but no listings, falling back...")
    except Exception as e:
        print(f"[YEAR] ⚠️ Failed fetching {latest}: {e}")

    # Step 2: Walk backward year-by-year
    for yr in range(start_year - 1, min_year - 1, -1):
        candidate = f"{root}/{yr}"
        tried.append(candidate)
        try:
            r = session.get(candidate, timeout=10)
            if r.status_code == 200 and page_has_shops(r.text):
                print(f"[YEAR] ✅ Found working year {yr} for {root}")
                return candidate
        except Exception:
            continue

    # Step 3: Fallback to base category only if no regional variant exists
    if not has_region:
        base_url = re.sub(r"_[a-z]+$", "", root)
        for yr in range(start_year, min_year - 1, -1):
            candidate = f"{base_url}/{yr}"
            tried.append(candidate)
            try:
                r = session.get(candidate, timeout=10)
                if r.status_code == 200 and page_has_shops(r.text):
                    print(f"[YEAR] ⚠️ Using non-regional fallback {yr} for {base_url}")
                    return candidate
            except Exception:
                continue

    print(f"[YEAR] ❌ No valid year found for {root}. Tried: {', '.join(tried)}")
    return root

# -------------------------------------------------


# ---------------- GOOGLE PLACE INFO ----------------
def get_place_info(query: str, lat=None, lng=None, radius_m=50000):
    params = {
        "input": query,
        "inputtype": "textquery",
        "fields": "place_id,name,formatted_address,geometry,rating,user_ratings_total",
        "language": "ja",
        "key": google_api_key(),
    }
    if lat is not None and lng is not None:
        params["locationbias"] = f"circle:{radius_m}@{lat},{lng}"

    r = session.get(GOOGLE_PLACES_URL, params=params, timeout=10)
    r.raise_for_status()
    resp = r.json()
    cands = resp.get("candidates", [])
    if resp.get("status") == "OK" and cands:
        c = cands[0]
        loc = c.get("geometry", {}).get("location", {}) or {}
        return {
            "place_id": c.get("place_id", ""),
            "g_name": c.get("name", ""),
            "g_address": c.get("formatted_address", ""),
            "lat": loc.get("lat", None),
            "lng": loc.get("lng", None),
            "g_rating": c.get("rating", None),
            "g_reviews": c.get("user_ratings_total", 0),
        }
    return {"place_id":"", "g_name":"", "g_rating":None, "g_reviews":0, "g_address":"", "lat":None, "lng":None}
# ---------------------------------------------------

FULLWIDTH_PAREN = re.compile(r"（[^）]*）")
BRACKETED_BLOCK = re.compile(r"【[^】]*】")

def clean_jp_official_name(raw: str) -> str:
    if not raw:
        return ""
    # Remove bracketed markers like 【旧店名】… first (inside or outside parens)
    raw = BRACKETED_BLOCK.sub("", raw)
    # Take the part before the first full-width parenthesis (official JP name)
    raw_no_paren = FULLWIDTH_PAREN.split(raw)[0].strip()
    # Collapse excessive spaces
    return re.sub(r"\s+", " ", raw_no_paren)

def extract_english_name_from_en_page(soup_en: BeautifulSoup) -> str:
    # Preferred: h2.display-name > span
    name_tag = soup_en.select_one("h2.display-name span")
    if name_tag:
        return name_tag.get_text(strip=True)

    # Fallback: <title> e.g. "Otsuka Miyaho Reservation - Otsuka/Izakaya (Tavern) | Tabelog"
    title = (soup_en.title.string or "").strip() if soup_en.title else ""
    if title:
        # Take the portion before " - " first; also strip “Reservation” suffix if present
        # e.g. "Otsuka Miyaho Reservation - Otsuka/Izakaya (Tavern) | Tabelog"
        head = title.split(" - ", 1)[0]
        head = head.replace("Reservation", "").strip()
        # Final cleanup
        head = re.sub(r"\s+", " ", head)
        if head:
            return head
    return ""

# ---------------- SCRAPE PAGE ----------------
def scrape_page(url):
    resp = session.get(url, timeout=10)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    results = []
    for li in soup.find_all("li", class_="rstinfo-table__business-item"):
        entry = {}
        entry["list_context"] = "other" if li.find_parent("div", class_="rstinfo-table__business-other") else "main"
        for child in li.find_all(class_=re.compile(r"^rstinfo-table__business-")):
            classes = child.get("class", [])
            if "rstinfo-table__business-item" in classes:
                continue
            cls = next((c for c in classes if c.startswith("rstinfo-table__business-")), None)
            if not cls:
                continue
            key = cls.replace("rstinfo-table__business-", "").replace("-", "_")
            entry[key] = child.get_text(" ", strip=True)
        results.append(entry)

    notice_tag = soup.find("p", class_="rstinfo-table__open-closed-notice")
    notice = notice_tag.get_text(" ", strip=True) if notice_tag else None
    if notice:
        for rec in results:
            rec["open_closed_notice"] = notice

    other_div = soup.find("div", class_="rstinfo-table__business-other")
    other_data = None
    if other_div:
        li = other_div.select_one("ul.rstinfo-table__business-list > li.rstinfo-table__business-item")
        if li:
            raw = li.get_text(separator="\n")
            lines = [l.strip() for l in raw.split("\n") if l.strip()]
            other_data = {"business_hours": {}, "closed_on": None}
            current = None
            for line in lines:
                if re.fullmatch(r"\[.*?\]", line):
                    current = line.strip("[]")
                    other_data["business_hours"].setdefault(current, {})
                    continue
                if re.search(r"(■\s*)?Closed on", line, re.I):
                    current = "Closed on"
                    continue
                if current == "Closed on":
                    other_data["closed_on"] = re.sub(r"^\s*•\s*", "", line)
                    continue
                m = re.match(r"\[(.*?)\]\s*(.*)", line)
                if m and current:
                    key, val = m.groups()
                    other_data["business_hours"][current][key] = val

    return {"business_items": results, "other_section": other_data}
# --------------------------------------------


# ---------------- DETAIL SCRAPER ----------------
def get_detail_info(url, area_text):
    name_en = name_jp = ""
    rating = None
    price_dinner = price_lunch = "-"
    sub_categories = []
    review_count = 0
    g_rating = None
    g_reviews = 0
    google_maps_url = ""
    g_info = {"place_id": "", "g_name": "", "g_address": "", "lat": None, "lng": None}

    business_items = []
    hours_notes_structured = {}

    def to_float(s):
        try:
            return float(s.replace(",", ""))
        except Exception:
            return None

    def to_int(s):
        try:
            return int(s.replace(",", ""))
        except Exception:
            return 0

    try:
        parts = url.split("tabelog.com/")
        en_url = "https://tabelog.com/en/" + parts[1]

        res = session.get(url, timeout=10)
        res.raise_for_status()
        soup = BeautifulSoup(res.text, "html.parser")

        res_en = session.get(en_url, timeout=10)
        res_en.raise_for_status()
        soup_en = BeautifulSoup(res_en.text, "html.parser")

        # Use JP page to get official Japanese name, then strip any full-width parenthetical (old name, etc.)
        name_jp_tag = soup.select_one("h2.display-name span")
        raw_jp = name_jp_tag.get_text(strip=True) if name_jp_tag else ""
        name_jp = clean_jp_official_name(raw_jp)

        # Use EN page to get the English name, with a robust fallback to <title>
        name_en = extract_english_name_from_en_page(soup_en)

        # If we somehow failed to get a JP name from the JP page, try the alias on EN page as a fallback
        if not name_jp:
            alias_on_en = soup_en.select_one("h2.display-name span.alias")
            if alias_on_en:
                # strip the enclosing full-width parentheses if present
                tmp = alias_on_en.get_text(strip=True)
                tmp = tmp.strip("（）")
                name_jp = clean_jp_official_name(tmp)

        rating_tag = soup.select_one("span.rdheader-rating__score-val-dtl")
        review_count_tag = soup.select_one("span.rdheader-rating__review-target em.num")
        rating = to_float(rating_tag.get_text(strip=True)) if rating_tag else None
        review_count = to_int(review_count_tag.get_text(strip=True)) if review_count_tag else 0

        price_tags = soup.select("a.rdheader-budget__price-target")
        prices = [p.get_text(strip=True) for p in price_tags]
        price_dinner = prices[0] if len(prices) > 0 else "-"
        price_lunch = prices[1] if len(prices) > 1 else "-"

        hours_data = scrape_page(en_url)
        business_items = hours_data.get("business_items", [])
        hours_notes_structured = hours_data.get("other_section", {})

        for section in soup_en.select("dl.rdheader-subinfo__item"):
            title_tag = section.select_one("dt.rdheader-subinfo__item-title")
            if title_tag and "Categories" in title_tag.text:
                sub_cat_tags = section.select("span.linktree__parent-target-text")
                sub_categories = [tag.get_text(strip=True) for tag in sub_cat_tags]
                break

        place_name = name_jp or name_en
        place_query = f"{place_name} {area_text}".strip()
        g_info = get_place_info(place_query)
        g_rating = g_info.get("g_rating")
        g_reviews = g_info.get("g_reviews")
        google_maps_url = (
            f"https://www.google.com/maps/place/?q=place_id:{g_info['place_id']}"
            if g_info.get("place_id") else ""
        )

        time.sleep(1)

    except Exception as e:
        print(f"[ERROR] Failed to fetch detail for {url}: {e}")
        print(traceback.format_exc())

    return (
        rating,
        price_dinner,
        price_lunch,
        business_items,
        hours_notes_structured,
        name_en,
        name_jp,
        g_info,
        sub_categories,
        review_count,
        g_rating,
        g_reviews,
        google_maps_url
    )
# -------------------------------------------------------


# ---------------- RESTAURANT SCRAPER ----------------
def scrape_restaurants(category_name_jp, category_name_en, region_name, url):
    resolved_url = resolve_yeared_url(url, YEAR_START, YEAR_MIN)
    if resolved_url != url:
        print(f"[YEAR] Using {resolved_url} (instead of {url})")

    res = session.get(resolved_url, timeout=10)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "html.parser")

    restaurants = []
    shop_items = soup.select("div.hyakumeiten-shop__item")
    print(f"[DEBUG] Found {len(shop_items)} restaurant cards on {resolved_url}")

    for idx, item in enumerate(shop_items, start=1):
        try:
            name_tag = item.select_one("div.hyakumeiten-shop__name")
            area_tag = item.select_one("div.hyakumeiten-shop__area span:nth-of-type(2)")
            link_tag = item.select_one("a.hyakumeiten-shop__target")

            if not (name_tag and area_tag and link_tag):
                print(f"[WARN] Missing essential tag in card #{idx}")
                continue

            r_url = safe_join("https://tabelog.com", link_tag.get("href"))
            area_text = area_tag.get_text(strip=True)
            print(f"[INFO] Scraping #{idx}: {name_tag.get_text(strip=True)} - {r_url}")

            result = get_detail_info(r_url, area_text)
            if not result:
                continue

            (
                rating, price_dinner, price_lunch, hours_raw, hours_notes_structured, name_en, name_jp,
                g_info, sub_categories, review_count, g_rating, g_reviews, google_maps_url
            ) = result

            img_tag = item.select_one("div.hyakumeiten-shop__img img")
            img_url = ""
            if img_tag:
                img_url_raw = img_tag.get("data-src") or img_tag.get("src", "")
                if img_url_raw.startswith("//"):
                    img_url = "https:" + img_url_raw
                elif img_url_raw:
                    img_url = img_url_raw

            restaurants.append({
                "category_jp": category_name_jp,
                "category_en": category_name_en,
                "region": region_name,
                "name": name_jp or name_tag.get_text(strip=True),
                "name_en": name_en,
                "area": area_text,
                "url": r_url,
                "rating": rating,
                "review_count_tabelog": review_count,
                "price_dinner": price_dinner,
                "price_lunch": price_lunch,
                "sub_categories": ", ".join(sub_categories),
                "hours_raw": hours_raw,
                "hours_notes_structured": hours_notes_structured,
                "google_rating": g_rating,
                "google_reviews": g_reviews,
                "google_maps_url": google_maps_url,
                "image_url": img_url,
                **g_info
            })

        except Exception as e:
            print(f"[ERROR] Card #{idx} failed: {e}")
            traceback.print_exc()

    print(f"[SUMMARY] Extracted {len(restaurants)} restaurants from {resolved_url}")
    return restaurants
# -----------------------------------------------------


# # ---------------- MAIN SCRIPT ----------------
if __name__ == "__main__":
    os.makedirs("json_exports", exist_ok=True)
    all_data = []

    category_urls = get_category_urls()
    print(f"Found {len(category_urls)} category-region combinations...")

    for category_name_jp, region_name, url in category_urls:
        try:
            category_name_en = jp_to_en_category(category_name_jp)
            print(f"\nScraping [{category_name_jp}/{category_name_en}] - {region_name} => {url}")

            restaurants = scrape_restaurants(category_name_jp, category_name_en, region_name, url)
            all_data.extend(restaurants)

            safe_cat = re.sub(r"[^\w]+", "_", category_name_en)
            safe_region = re.sub(r"[^\w]+", "_", region_name)
            filename = f"json_exports/tabelog_{safe_cat}_{safe_region}_{YEAR_START}.json"
            with open(filename, "w", encoding="utf-8") as f:
                json.dump(restaurants, f, ensure_ascii=False, indent=2)
            print(f"✅ Saved {len(restaurants)} items → {filename}")

            time.sleep(1)

        except Exception:
            traceback.print_exc()

        with open("json_exports/tabelog_partial_backup.json", "w", encoding="utf-8") as f:
            json.dump(all_data, f, ensure_ascii=False, indent=2)

    timestamp = time.strftime("%Y%m%d_%H%M%S")
    master_file = f"json_exports/tabelog_all_categories_{timestamp}.json"
    with open(master_file, "w", encoding="utf-8") as f:
        json.dump(all_data, f, ensure_ascii=False, indent=2)
    print(f"🎉 Scraped total: {len(all_data)} restaurants! Master JSON → {master_file}")
# # # -------------------------------------------------------
