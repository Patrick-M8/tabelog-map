import requests
from bs4 import BeautifulSoup
import json
import time
import traceback
import re
import os
from urllib.parse import urljoin, urlparse
from requests.adapters import HTTPAdapter, Retry


GOOGLE_API_KEY = ""
GOOGLE_PLACES_URL = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"

BASE_URL = "https://award.tabelog.com"


headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0 Safari/537.36"
}

session = requests.Session()
retries = Retry(total=5, backoff_factor=0.6, status_forcelist=(429, 500, 502, 503, 504))
session.mount("https://", HTTPAdapter(max_retries=retries))
session.headers.update(headers)

# 🔹 Category translation map
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
    "パン": "Bakery"
}

def jp_to_en_category(jp: str) -> str:
    return CATEGORY_TRANSLATIONS.get(jp, jp) 

def safe_join(base, href):
    if not href:
        return None
    if bool(urlparse(href).netloc):  # already absolute
        return href
    return urljoin(base, href)

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
            "a.hyakumeiten-nav__item-target",  # fallback
        ]:
            for a in item.select(selector):
                href = a.get("href")
                region_name = a.get_text(strip=True).upper() or "ALL"
                abs_url = safe_join(BASE_URL, href)
                if abs_url:
                    categories.append((category_name_jp, region_name, abs_url))
    return categories

def get_place_info(query: str, lat=None, lng=None, radius_m=50000):
    params = {
        "input": query,
        "inputtype": "textquery",
        "fields": "place_id,name,formatted_address,geometry,rating,user_ratings_total",
        "language": "ja",
        "key": GOOGLE_API_KEY,
    }
    if lat is not None and lng is not None:
        params["locationbias"] = f"circle:{radius_m}@{lat},{lng}"  # bias to Japan if you have a rough location

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
                # Detect headers like [Weekdays], [Sat], etc.
                if re.fullmatch(r"\[.*?\]", line):
                    current = line.strip("[]")
                    other_data["business_hours"].setdefault(current, {})
                    continue
                # Normalize "■Closed on" and variants
                if re.search(r"(■\s*)?Closed on", line, re.I):
                    current = "Closed on"
                    continue
                if current == "Closed on":
                    other_data["closed_on"] = re.sub(r"^\s*•\s*", "", line)
                    continue
                # Try "[Key] value" pairs under the current day
                m = re.match(r"\[(.*?)\]\s*(.*)", line)
                if m and current:
                    key, val = m.groups()
                    other_data["business_hours"][current][key] = val

    return {"business_items": results, "other_section": other_data}


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

        # Fetch pages via session
        res = session.get(url, timeout=10)
        res.raise_for_status()
        soup = BeautifulSoup(res.text, "html.parser")

        res_en = session.get(en_url, timeout=10)
        res_en.raise_for_status()
        soup_en = BeautifulSoup(res_en.text, "html.parser")

        # Names
        name_en_tag = soup.select_one("h2.display-name span")
        name_jp_alias_tag = soup.select_one("span.alias")
        name_en = name_en_tag.get_text(strip=True) if name_en_tag else ""
        name_jp = name_jp_alias_tag.get_text(strip=True).strip("()") if name_jp_alias_tag else ""

        # Rating + reviews
        rating_tag = soup.select_one("span.rdheader-rating__score-val-dtl")
        review_count_tag = soup.select_one("span.rdheader-rating__review-target em.num")
        rating = to_float(rating_tag.get_text(strip=True)) if rating_tag else None
        review_count = to_int(review_count_tag.get_text(strip=True)) if review_count_tag else 0

        # Prices
        price_tags = soup.select("a.rdheader-budget__price-target")
        prices = [p.get_text(strip=True) for p in price_tags]
        price_dinner = prices[0] if len(prices) > 0 else "-"
        price_lunch = prices[1] if len(prices) > 1 else "-"

        # Business hours (EN)
        hours_data = scrape_page(en_url)
        business_items = hours_data.get("business_items", [])
        hours_notes_structured = hours_data.get("other_section", {})

        # Sub-categories (EN page)
        for section in soup_en.select("dl.rdheader-subinfo__item"):
            title_tag = section.select_one("dt.rdheader-subinfo__item-title")
            if title_tag and "Categories" in title_tag.text:
                sub_cat_tags = section.select("span.linktree__parent-target-text")
                sub_categories = [tag.get_text(strip=True) for tag in sub_cat_tags]
                break

        # Google Places
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

    # Always return the 13-tuple
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


def scrape_restaurants(category_name_jp, category_name_en, region_name, url):
    res = session.get(url, timeout=10)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "html.parser")

    restaurants = []
    for item in soup.select("div.hyakumeiten-shop__item"):
        name_tag = item.select_one("div.hyakumeiten-shop__name")
        area_tag = item.select_one("div.hyakumeiten-shop__area span:nth-of-type(2)")
        link_tag = item.select_one("a.hyakumeiten-shop__target")

        if not (name_tag and area_tag and link_tag):
            continue

        r_url = safe_join("https://tabelog.com", link_tag.get("href"))
        if not r_url:
            continue
        area_text = area_tag.get_text(strip=True)

        # 🖼️ Extract image URL (from data-src or src)
        img_tag = item.select_one("div.hyakumeiten-shop__img img")
        img_url = ""
        if img_tag:
            img_url_raw = img_tag.get("data-src") or img_tag.get("src", "")
            if img_url_raw.startswith("//"):
                img_url = "https:" + img_url_raw
            elif img_url_raw:
                img_url = img_url_raw

        # 🧠 Detailed scraping of individual page
        result = get_detail_info(r_url, area_text)
        if not result:
            continue

        (
            rating, price_dinner, price_lunch, hours_raw, hours_notes_structured, name_en, name_jp,
            g_info, sub_categories, review_count, g_rating, g_reviews, google_maps_url
        ) = result

        # 🧾 Assemble restaurant dict
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

    return restaurants

if __name__ == "__main__":
    all_data = []

    category_urls = get_category_urls()
    print(f"Found {len(category_urls)} category-region combinations...")

    for category_name_jp, region_name, url in category_urls:
        try:
            category_name_en = jp_to_en_category(category_name_jp)
            print(f"Scraping [{category_name_jp}/{category_name_en}] - {region_name} => {url}")
            restaurants = scrape_restaurants(category_name_jp, category_name_en, region_name, url)
            all_data.extend(restaurants)
            time.sleep(1)
        except Exception:
            traceback.print_exc()

    with open("tabelog_all_categories_test.json", "w", encoding="utf-8") as f:
        json.dump(all_data, f, ensure_ascii=False, indent=2)
    print(f"Scraped total: {len(all_data)} restaurants! JSON exported.")
